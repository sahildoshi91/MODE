import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.modules.profile.schemas import (  # noqa: E402
    AlgorithmMemoryCreateRequest,
    AlgorithmMemoryUpdateRequest,
)
from app.modules.profile.service import (  # noqa: E402
    ALGORITHM_LEARNING_FALLBACK,
    PROFILE_ALGORITHM_STORAGE_UNAVAILABLE_DETAIL,
    PROFILE_MEMORY_DELETE_VERIFICATION_FAILED_DETAIL,
    PROFILE_MEMORY_VERIFICATION_FAILED_DETAIL,
    SUMMARY_WORD_LIMIT,
    ProfilePersistenceVerificationError,
    ProfileService,
    ProfileStorageUnavailableError,
)


class FakeProfileRepository:
    def __init__(self):
        self.profiles = {}
        self.memories = []
        self.checkins = []
        self.next_memory_id = 1

    def get_by_client_id(self, client_id):
        return self.profiles.get(client_id)

    def create_empty(self, client_id):
        profile = {
            "client_id": client_id,
            "primary_goal": None,
            "user_why": None,
            "algorithm_summary": None,
            "algorithm_summary_updated_at": None,
        }
        self.profiles[client_id] = profile
        return profile

    def update_fields(self, client_id, fields):
        profile = self.profiles.setdefault("client-1" if client_id is None else client_id, {"client_id": client_id})
        profile.update(fields)
        return dict(profile)

    def list_algorithm_memories(self, *, trainer_id, client_id):
        return [
            memory
            for memory in self.memories
            if memory.get("trainer_id") == trainer_id and memory.get("client_id") == client_id
        ]

    def insert_algorithm_memory(self, payload):
        row = {
            "id": f"memory-{self.next_memory_id}",
            "created_at": "2026-05-04T12:00:00+00:00",
            **payload,
        }
        self.next_memory_id += 1
        self.memories.insert(0, row)
        return row

    def get_algorithm_memory(self, *, trainer_id, client_id, memory_id):
        for memory in self.memories:
            if (
                memory.get("id") == memory_id
                and memory.get("trainer_id") == trainer_id
                and memory.get("client_id") == client_id
            ):
                return memory
        return None

    def update_algorithm_memory(self, *, trainer_id, client_id, memory_id, payload):
        memory = self.get_algorithm_memory(
            trainer_id=trainer_id,
            client_id=client_id,
            memory_id=memory_id,
        )
        if not memory:
            return {}
        memory.update(payload)
        memory["updated_at"] = "2026-05-04T13:00:00+00:00"
        return memory

    def delete_algorithm_memory(self, *, trainer_id, client_id, memory_id):
        memory = self.get_algorithm_memory(
            trainer_id=trainer_id,
            client_id=client_id,
            memory_id=memory_id,
        )
        if not memory:
            return {}
        self.memories.remove(memory)
        return memory

    def list_recent_checkins(self, client_id, *, limit=5):
        del client_id, limit
        return list(self.checkins)


class MissingAlgorithmFieldProfileRepository(FakeProfileRepository):
    def update_fields(self, client_id, fields):
        del client_id, fields
        raise Exception(
            "{'message': \"Could not find the 'algorithm_summary' column of "
            "'user_fitness_profiles' in the schema cache\"}"
        )


class StaleDeleteMemoryRepository(FakeProfileRepository):
    def delete_algorithm_memory(self, *, trainer_id, client_id, memory_id):
        return self.get_algorithm_memory(
            trainer_id=trainer_id,
            client_id=client_id,
            memory_id=memory_id,
        ) or {}


class SoftArchiveDeleteMemoryRepository(FakeProfileRepository):
    def delete_algorithm_memory(self, *, trainer_id, client_id, memory_id):
        memory = self.get_algorithm_memory(
            trainer_id=trainer_id,
            client_id=client_id,
            memory_id=memory_id,
        )
        if not memory:
            return {}
        value_json = memory.get("value_json")
        value = dict(value_json) if isinstance(value_json, dict) else {}
        value["is_archived"] = True
        memory["value_json"] = value
        memory["updated_at"] = "2026-05-04T13:00:00+00:00"
        return memory


class SelectHidesArchivedMemoryRepository(SoftArchiveDeleteMemoryRepository):
    def get_algorithm_memory(self, *, trainer_id, client_id, memory_id):
        memory = super().get_algorithm_memory(
            trainer_id=trainer_id,
            client_id=client_id,
            memory_id=memory_id,
        )
        if not memory:
            return None
        value_json = memory.get("value_json")
        value = value_json if isinstance(value_json, dict) else {}
        if bool(value.get("is_archived")):
            return None
        return memory

    def delete_algorithm_memory(self, *, trainer_id, client_id, memory_id):
        for memory in self.memories:
            if (
                memory.get("id") == memory_id
                and memory.get("trainer_id") == trainer_id
                and memory.get("client_id") == client_id
            ):
                value_json = memory.get("value_json")
                value = dict(value_json) if isinstance(value_json, dict) else {}
                value["is_archived"] = True
                memory["value_json"] = value
                memory["updated_at"] = "2026-05-04T13:00:00+00:00"
                return memory
        return {}


class RecordingDeleteMemoryRepository(FakeProfileRepository):
    def __init__(self, shared_memories):
        super().__init__()
        self.memories = shared_memories
        self.delete_calls = []

    def delete_algorithm_memory(self, *, trainer_id, client_id, memory_id):
        self.delete_calls.append(
            {
                "trainer_id": trainer_id,
                "client_id": client_id,
                "memory_id": memory_id,
            }
        )
        return super().delete_algorithm_memory(
            trainer_id=trainer_id,
            client_id=client_id,
            memory_id=memory_id,
        )


class MissingWhyFieldProfileRepository(FakeProfileRepository):
    def update_fields(self, client_id, fields):
        del client_id, fields
        raise Exception(
            "{'message': \"Could not find the 'user_why' column of "
            "'user_fitness_profiles' in the schema cache\"}"
        )


class StaleWhyProfileRepository(FakeProfileRepository):
    def update_fields(self, client_id, fields):
        profile = self.profiles.setdefault(client_id, {"client_id": client_id})
        stale_fields = {key: value for key, value in fields.items() if key != "user_why"}
        profile.update(stale_fields)
        return dict(profile)


class InvisibleInsertedMemoryRepository(FakeProfileRepository):
    def list_algorithm_memories(self, *, trainer_id, client_id):
        del trainer_id, client_id
        return []


def memory_row(
    memory_id,
    *,
    source="user",
    created_by="user",
    client_visible=True,
    ai_usable=True,
    is_archived=False,
    text="Prefers morning workouts",
    memory_type="note",
):
    return {
        "id": memory_id,
        "trainer_id": "trainer-1",
        "client_id": "client-1",
        "memory_type": memory_type,
        "memory_key": memory_id,
        "value_json": {
            "source": source,
            "created_by": created_by,
            "client_visible": client_visible,
            "ai_usable": ai_usable,
            "is_archived": is_archived,
            "text": text,
            "category": "schedule",
            "tags": ["morning", "family"],
        },
        "created_at": "2026-05-04T10:00:00+00:00",
        "updated_at": "2026-05-04T11:00:00+00:00",
    }


class ProfileAlgorithmServiceTests(unittest.TestCase):
    def test_empty_profile_returns_learning_fallback_and_persists_summary(self):
        repository = FakeProfileRepository()
        service = ProfileService(repository)

        result = service.get_algorithm_home(client_id="client-1", trainer_id="trainer-1")

        self.assertEqual(result.summary_text, ALGORITHM_LEARNING_FALLBACK)
        self.assertLessEqual(len(result.summary_text.split()), SUMMARY_WORD_LIMIT)
        self.assertEqual(repository.profiles["client-1"]["algorithm_summary"], ALGORITHM_LEARNING_FALLBACK)
        self.assertIsNotNone(repository.profiles["client-1"]["algorithm_summary_updated_at"])

    def test_algorithm_home_degrades_when_profile_algorithm_columns_are_pending_migration(self):
        repository = MissingAlgorithmFieldProfileRepository()
        service = ProfileService(repository)

        result = service.get_algorithm_home(client_id="client-1", trainer_id="trainer-1")

        self.assertEqual(result.summary_text, ALGORITHM_LEARNING_FALLBACK)
        self.assertIsNone(result.algorithm_summary_updated_at)

    def test_why_update_persists_first_class_field_and_summary_finishes_short_message(self):
        repository = FakeProfileRepository()
        service = ProfileService(repository)

        result = service.update_user_why(
            client_id="client-1",
            trainer_id="trainer-1",
            user_why="Never be too tired to play with my kid after work every day.",
        )

        self.assertEqual(
            repository.profiles["client-1"]["user_why"],
            "Never be too tired to play with my kid after work every day.",
        )
        self.assertLessEqual(len(result.summary_text.split()), SUMMARY_WORD_LIMIT)
        self.assertIn("after work every day.", result.summary_text)
        self.assertIn("kid", result.summary_text)

        cleared = service.update_user_why(
            client_id="client-1",
            trainer_id="trainer-1",
            user_why="   ",
        )
        self.assertIsNone(repository.profiles["client-1"]["user_why"])
        self.assertIsNone(cleared.user_why)

    def test_long_why_summary_stays_short_and_marks_continuation(self):
        repository = FakeProfileRepository()
        service = ProfileService(repository)

        result = service.update_user_why(
            client_id="client-1",
            trainer_id="trainer-1",
            user_why=(
                "Have enough energy for school pickup, dinner, homework, weekend hikes, "
                "soccer practice, dance recitals, work travel, and the long summer trip "
                "without feeling like training has swallowed the whole calendar."
            ),
        )

        self.assertLessEqual(len(result.summary_text.split()), SUMMARY_WORD_LIMIT)
        self.assertTrue(result.summary_text.endswith("..."))

    def test_why_update_raises_clear_error_when_storage_column_is_missing(self):
        repository = MissingWhyFieldProfileRepository()
        service = ProfileService(repository)

        with self.assertRaisesRegex(ProfileStorageUnavailableError, "Your Why storage is not available") as context:
            service.update_user_why(
                client_id="client-1",
                trainer_id="trainer-1",
                user_why="Dance until I am 100.",
            )

        self.assertEqual(str(context.exception), PROFILE_ALGORITHM_STORAGE_UNAVAILABLE_DETAIL)
        self.assertIn("20260504b_your_mode_algorithm_home.sql", str(context.exception))

    def test_why_update_fails_when_persisted_value_does_not_roundtrip(self):
        repository = StaleWhyProfileRepository()
        service = ProfileService(repository)

        with self.assertRaisesRegex(ProfilePersistenceVerificationError, "could not be verified"):
            service.update_user_why(
                client_id="client-1",
                trainer_id="trainer-1",
                user_why="Dance until I am 100.",
            )

    def test_algorithm_home_filters_hidden_memory_and_marks_client_editability(self):
        repository = FakeProfileRepository()
        repository.memories = [
            memory_row("user-visible", text="Motivated by family."),
            memory_row(
                "trainer-visible",
                source="trainer",
                created_by="trainer",
                client_visible=False,
                text="Low-back sensitive.",
                memory_type="constraint",
            ),
            memory_row(
                "trainer-hidden",
                source="trainer",
                created_by="trainer",
                client_visible=False,
                ai_usable=False,
                text="Trainer-only note should not leak.",
            ),
            memory_row("archived", is_archived=True, text="Archived note should not leak."),
        ]
        service = ProfileService(repository)

        result = service.get_algorithm_home(client_id="client-1", trainer_id="trainer-1")
        by_id = {memory.id: memory for memory in result.memories}

        self.assertEqual(set(by_id.keys()), {"user-visible", "trainer-visible"})
        self.assertTrue(by_id["user-visible"].can_edit)
        self.assertFalse(by_id["trainer-visible"].can_edit)
        self.assertTrue(by_id["trainer-visible"].ai_usable)

    def test_client_memory_create_update_and_delete_uses_coach_memory_metadata(self):
        repository = FakeProfileRepository()
        delete_repository = RecordingDeleteMemoryRepository(repository.memories)
        service = ProfileService(repository, delete_repository=delete_repository)

        created_result = service.create_algorithm_memory(
            client_id="client-1",
            trainer_id="trainer-1",
            request=AlgorithmMemoryCreateRequest(
                text="Prefers simple nutrition",
                category="nutrition",
                ai_usable=False,
                tags=["Nutrition", "nutrition", "Simple"],
            ),
        )
        created = repository.memories[0]
        self.assertEqual(created["value_json"]["source"], "user")
        self.assertTrue(created["value_json"]["client_visible"])
        self.assertFalse(created["value_json"]["ai_usable"])
        self.assertEqual(created["value_json"]["visibility"], "client_visible")
        self.assertEqual(created["value_json"]["tags"], ["nutrition", "simple"])
        self.assertEqual([memory.id for memory in created_result.memories], [created["id"]])
        self.assertEqual(created_result.memories[0].text, "Prefers simple nutrition")

        service.update_algorithm_memory(
            client_id="client-1",
            trainer_id="trainer-1",
            memory_id=created["id"],
            request=AlgorithmMemoryUpdateRequest(text="Needs simple nutrition", ai_usable=True),
        )
        self.assertEqual(created["value_json"]["text"], "Needs simple nutrition")
        self.assertTrue(created["value_json"]["ai_usable"])
        self.assertEqual(created["value_json"]["visibility"], "ai_usable")

        result = service.delete_algorithm_memory(
            client_id="client-1",
            trainer_id="trainer-1",
            memory_id=created["id"],
        )
        self.assertEqual(
            delete_repository.delete_calls,
            [
                {
                    "trainer_id": "trainer-1",
                    "client_id": "client-1",
                    "memory_id": created["id"],
                }
            ],
        )
        self.assertEqual(repository.memories, [])
        self.assertEqual(result.memories, [])

    def test_client_memory_delete_verifies_row_is_removed(self):
        repository = StaleDeleteMemoryRepository()
        repository.memories = [memory_row("user-visible", text="Motivated by family.")]
        service = ProfileService(repository)

        with self.assertRaisesRegex(ProfilePersistenceVerificationError, "Memory could not be verified") as context:
            service.delete_algorithm_memory(
                client_id="client-1",
                trainer_id="trainer-1",
                memory_id="user-visible",
            )

        self.assertEqual(str(context.exception), PROFILE_MEMORY_DELETE_VERIFICATION_FAILED_DETAIL)

    def test_client_memory_delete_verifies_soft_archive_is_hidden(self):
        repository = SoftArchiveDeleteMemoryRepository()
        repository.memories = [memory_row("user-visible", text="Motivated by family.")]
        service = ProfileService(repository)

        result = service.delete_algorithm_memory(
            client_id="client-1",
            trainer_id="trainer-1",
            memory_id="user-visible",
        )

        self.assertTrue(repository.memories[0]["value_json"]["is_archived"])
        self.assertEqual(result.memories, [])

    def test_client_memory_delete_accepts_archived_row_hidden_by_select_policy(self):
        repository = SelectHidesArchivedMemoryRepository()
        repository.memories = [memory_row("user-visible", text="Motivated by family.")]
        service = ProfileService(repository)

        result = service.delete_algorithm_memory(
            client_id="client-1",
            trainer_id="trainer-1",
            memory_id="user-visible",
        )

        self.assertTrue(repository.memories[0]["value_json"]["is_archived"])
        self.assertEqual(result.memories, [])
        self.assertIsNone(
            repository.get_algorithm_memory(
                trainer_id="trainer-1",
                client_id="client-1",
                memory_id="user-visible",
            )
        )

    def test_client_cannot_edit_trainer_owned_memory(self):
        repository = FakeProfileRepository()
        repository.memories = [
            memory_row(
                "trainer-visible",
                source="trainer",
                created_by="trainer",
                text="Client-visible but trainer-owned.",
            )
        ]
        service = ProfileService(repository)

        with self.assertRaisesRegex(ValueError, "Memory not found"):
            service.update_algorithm_memory(
                client_id="client-1",
                trainer_id="trainer-1",
                memory_id="trainer-visible",
                request=AlgorithmMemoryUpdateRequest(text="Edited by client"),
            )

    def test_client_memory_create_fails_when_created_memory_is_not_visible(self):
        repository = InvisibleInsertedMemoryRepository()
        service = ProfileService(repository)

        with self.assertRaisesRegex(ProfilePersistenceVerificationError, "Memory could not be verified") as context:
            service.create_algorithm_memory(
                client_id="client-1",
                trainer_id="trainer-1",
                request=AlgorithmMemoryCreateRequest(
                    text="Trying to get a six pack",
                    ai_usable=True,
                    tags=["coach-chat", "note"],
                ),
            )

        self.assertEqual(str(context.exception), PROFILE_MEMORY_VERIFICATION_FAILED_DETAIL)


if __name__ == "__main__":
    unittest.main()
