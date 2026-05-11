import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.tenancy import TrainerContext
from app.modules.conversation.service import ConversationService


class FakeConversationRepository:
    def __init__(self, rows):
        self.rows = rows

    def get_conversation(self, conversation_id):
        return {
            "id": conversation_id,
            "trainer_id": "trainer-1",
            "client_id": "client-1",
        }

    def find_active_conversation(self, client_id, trainer_id, preferred_types=None, fallback_to_any=False):
        del preferred_types, fallback_to_any
        return {
            "id": "conversation-1",
            "trainer_id": trainer_id,
            "client_id": client_id,
        }

    def list_messages_with_payload(self, conversation_id, limit=80, before_created_at=None):
        del conversation_id, limit, before_created_at
        return list(self.rows)


class FakeProfileService:
    def get_or_create_profile(self, client_id):
        return {"client_id": client_id}


class FakeTrainerReviewService:
    def queue_unanswered_question(self, **kwargs):
        del kwargs


class FakeTrainerPersonaRepository:
    def get_default_by_trainer(self, trainer_id):
        del trainer_id
        return None

    def create(self, payload):
        return payload

    def update(self, persona_id, payload):
        del persona_id
        return payload


class ConversationHistorySecurityTests(unittest.TestCase):
    def setUp(self):
        rows = [
            {
                "id": "msg-system",
                "role": "system",
                "message_text": "system only note",
                "structured_payload": {
                    "kind": "system_note",
                    "visibility": "system",
                    "debug": {"internal": True},
                },
                "created_at": "2026-04-20T10:00:00Z",
            },
            {
                "id": "msg-assistant",
                "role": "assistant",
                "message_text": "Here is your plan",
                "structured_payload": {
                    "kind": "chat_message",
                    "orchestration": {"selected_entries": [{"raw_content": "private note"}]},
                    "memory_suggestions": [{"suggested_text": "Prefers morning workouts"}],
                    "debug": {"route": "default_fast"},
                },
                "created_at": "2026-04-20T10:01:00Z",
            },
            {
                "id": "msg-private",
                "role": "assistant",
                "message_text": "trainer-only note",
                "structured_payload": {
                    "kind": "review_note",
                    "visibility": "trainer_private",
                    "review_reason": "quality_check",
                },
                "created_at": "2026-04-20T10:02:00Z",
            },
            {
                "id": "msg-user",
                "role": "user",
                "message_text": "Thanks coach",
                "structured_payload": {
                    "kind": "client_message_sent",
                    "client_metadata": {"source": "mobile"},
                },
                "created_at": "2026-04-20T10:03:00Z",
            },
        ]
        self.repository = FakeConversationRepository(rows)
        self.service = ConversationService(
            self.repository,
            FakeProfileService(),
            FakeTrainerReviewService(),
            FakeTrainerPersonaRepository(),
        )

    def test_get_history_for_client_filters_and_redacts_structured_payload(self):
        client_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach",
            client_id="client-1",
            client_user_id="client-user-1",
        )

        response = self.service.get_history(
            user_id="client-user-1",
            trainer_context=client_context,
            conversation_id="conversation-1",
        )

        ids = [item.id for item in response.items]
        self.assertEqual(ids, ["msg-assistant", "msg-user"])
        by_id = {item.id: item for item in response.items}
        self.assertEqual(by_id["msg-assistant"].structured_payload, {
            "memory_suggestions": [{"suggested_text": "Prefers morning workouts"}]
        })
        self.assertEqual(by_id["msg-user"].structured_payload, {})

    def test_get_history_for_trainer_preserves_internal_payloads(self):
        trainer_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach",
            client_id=None,
            client_user_id=None,
        )

        response = self.service.get_history(
            user_id="trainer-user-1",
            trainer_context=trainer_context,
            conversation_id="conversation-1",
        )

        ids = [item.id for item in response.items]
        self.assertEqual(ids, ["msg-system", "msg-assistant", "msg-private", "msg-user"])
        by_id = {item.id: item for item in response.items}
        self.assertEqual(by_id["msg-system"].visibility, "system")
        self.assertEqual(by_id["msg-private"].visibility, "trainer_private")
        self.assertIn("orchestration", by_id["msg-assistant"].structured_payload)
        self.assertIn("debug", by_id["msg-assistant"].structured_payload)


if __name__ == "__main__":
    unittest.main()
