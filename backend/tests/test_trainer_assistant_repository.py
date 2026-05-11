import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.modules.trainer_assistant.repository import TrainerAssistantRepository


class _FakeQuery:
    def __init__(self, table_name, errors_by_table, data_by_table):
        self.table_name = table_name
        self.errors_by_table = errors_by_table
        self.data_by_table = data_by_table

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def update(self, *_args, **_kwargs):
        return self

    def insert(self, *_args, **_kwargs):
        return self

    def execute(self):
        error = self.errors_by_table.get(self.table_name)
        if error is not None:
            raise error
        return type("FakeResponse", (), {"data": self.data_by_table.get(self.table_name, [])})()


class _FakeSupabase:
    def __init__(self, errors_by_table=None, data_by_table=None):
        self.errors_by_table = errors_by_table or {}
        self.data_by_table = data_by_table or {}

    def table(self, table_name):
        return _FakeQuery(table_name, self.errors_by_table, self.data_by_table)


class TrainerAssistantRepositoryTests(unittest.TestCase):
    def test_get_last_selected_client_id_returns_none_when_column_missing(self):
        repository = TrainerAssistantRepository(
            _FakeSupabase(
                errors_by_table={
                    "trainers": RuntimeError(
                        {
                            "code": "42703",
                            "message": "column trainers.assistant_last_client_id does not exist",
                        }
                    )
                }
            )
        )
        self.assertIsNone(repository.get_last_selected_client_id("trainer-1"))

    def test_set_last_selected_client_id_noops_when_column_missing(self):
        repository = TrainerAssistantRepository(
            _FakeSupabase(
                errors_by_table={
                    "trainers": RuntimeError(
                        {
                            "code": "42703",
                            "message": "column trainers.assistant_last_client_id does not exist",
                        }
                    )
                }
            )
        )
        repository.set_last_selected_client_id("trainer-1", "client-1")

    def test_set_last_selected_client_id_noops_when_trainers_table_missing(self):
        repository = TrainerAssistantRepository(
            _FakeSupabase(
                errors_by_table={
                    "trainers": RuntimeError(
                        {
                            "code": "42P01",
                            "message": "relation public.trainers does not exist",
                        }
                    )
                }
            )
        )
        repository.set_last_selected_client_id("trainer-1", "client-1")

    def test_insert_router_event_returns_none_when_router_table_missing(self):
        repository = TrainerAssistantRepository(
            _FakeSupabase(
                errors_by_table={
                    "trainer_assistant_router_events": RuntimeError(
                        {
                            "code": "PGRST205",
                            "message": (
                                "Could not find the table "
                                "'public.trainer_assistant_router_events' in the schema cache"
                            ),
                        }
                    )
                }
            )
        )
        result = repository.insert_router_event({"trainer_id": "trainer-1"})
        self.assertIsNone(result)

    def test_insert_router_event_returns_none_when_router_event_columns_missing(self):
        repository = TrainerAssistantRepository(
            _FakeSupabase(
                errors_by_table={
                    "trainer_assistant_router_events": RuntimeError(
                        {
                            "code": "42703",
                            "message": "column trainer_assistant_router_events.route_reason does not exist",
                        }
                    )
                }
            )
        )
        result = repository.insert_router_event({"trainer_id": "trainer-1"})
        self.assertIsNone(result)

    def test_storage_preflight_reports_missing_assistant_primitives(self):
        repository = TrainerAssistantRepository(
            _FakeSupabase(
                errors_by_table={
                    "trainers": RuntimeError(
                        {
                            "code": "42703",
                            "message": "column trainers.assistant_last_client_id does not exist",
                        }
                    ),
                    "trainer_assistant_router_events": RuntimeError(
                        {
                            "code": "PGRST205",
                            "message": (
                                "Could not find the table "
                                "'public.trainer_assistant_router_events' in the schema cache"
                            ),
                        }
                    ),
                }
            )
        )
        result = repository.storage_preflight()
        self.assertFalse(result["healthy"])
        self.assertEqual(
            sorted(result["missing"]),
            ["trainer_assistant_router_events", "trainers.assistant_last_client_id"],
        )
        self.assertEqual(result["errors"], {})

    def test_get_last_selected_client_id_raises_non_schema_errors(self):
        repository = TrainerAssistantRepository(
            _FakeSupabase(
                errors_by_table={
                    "trainers": RuntimeError("network timeout")
                }
            )
        )
        with self.assertRaises(RuntimeError):
            repository.get_last_selected_client_id("trainer-1")


if __name__ == "__main__":
    unittest.main()
