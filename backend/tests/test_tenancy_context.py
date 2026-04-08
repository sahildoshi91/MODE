import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.tenancy import resolve_trainer_context
from app.modules.conversation.schemas import ChatRequest


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, table_name, tables):
        self.table_name = table_name
        self.tables = tables
        self.filters = {}
        self.limit_value = None

    def select(self, _fields):
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def execute(self):
        rows = list(self.tables.get(self.table_name, []))
        for key, value in self.filters.items():
            rows = [row for row in rows if row.get(key) == value]
        if self.limit_value is not None:
            rows = rows[:self.limit_value]
        return FakeResponse(rows)


class FakeSupabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, table_name):
        return FakeQuery(table_name, self.tables)


class TrainerContextResolutionTests(unittest.TestCase):
    def test_resolve_trainer_context_for_trainer_user(self):
        supabase = FakeSupabase(
            {
                "clients": [],
                "trainers": [
                    {
                        "id": "trainer-123",
                        "tenant_id": "tenant-123",
                        "user_id": "trainer-user-123",
                        "display_name": "Coach Alex",
                    }
                ],
                "trainer_personas": [
                    {
                        "id": "persona-123",
                        "trainer_id": "trainer-123",
                        "persona_name": "Strength Coach",
                        "is_default": True,
                    }
                ],
            }
        )

        trainer_context = resolve_trainer_context(supabase, "trainer-user-123")

        self.assertEqual(trainer_context.tenant_id, "tenant-123")
        self.assertEqual(trainer_context.trainer_id, "trainer-123")
        self.assertEqual(trainer_context.trainer_user_id, "trainer-user-123")
        self.assertEqual(trainer_context.trainer_display_name, "Coach Alex")
        self.assertIsNone(trainer_context.client_id)
        self.assertEqual(trainer_context.persona_id, "persona-123")
        self.assertEqual(trainer_context.persona_name, "Strength Coach")

    def test_resolve_trainer_context_prioritizes_trainer_role_when_user_has_both_records(self):
        supabase = FakeSupabase(
            {
                "clients": [
                    {
                        "id": "client-123",
                        "tenant_id": "tenant-123",
                        "user_id": "trainer-user-123",
                        "assigned_trainer_id": None,
                    }
                ],
                "trainers": [
                    {
                        "id": "trainer-123",
                        "tenant_id": "tenant-123",
                        "user_id": "trainer-user-123",
                        "display_name": "Coach Alex",
                    }
                ],
                "trainer_personas": [
                    {
                        "id": "persona-123",
                        "trainer_id": "trainer-123",
                        "persona_name": "Strength Coach",
                        "is_default": True,
                    }
                ],
            }
        )

        trainer_context = resolve_trainer_context(supabase, "trainer-user-123")

        self.assertEqual(trainer_context.trainer_id, "trainer-123")
        self.assertEqual(trainer_context.trainer_user_id, "trainer-user-123")
        self.assertEqual(trainer_context.trainer_display_name, "Coach Alex")
        self.assertIsNone(trainer_context.client_id)
        self.assertEqual(trainer_context.persona_id, "persona-123")
        self.assertEqual(trainer_context.persona_name, "Strength Coach")

    def test_resolve_trainer_context_for_client_user_includes_owner_user_id(self):
        supabase = FakeSupabase(
            {
                "clients": [
                    {
                        "id": "client-321",
                        "tenant_id": "tenant-321",
                        "user_id": "client-user-321",
                        "assigned_trainer_id": "trainer-321",
                    }
                ],
                "trainers": [
                    {
                        "id": "trainer-321",
                        "tenant_id": "tenant-321",
                        "user_id": "trainer-user-321",
                        "display_name": "Coach Riley",
                    }
                ],
                "trainer_personas": [
                    {
                        "id": "persona-321",
                        "trainer_id": "trainer-321",
                        "persona_name": "Performance Coach",
                        "is_default": True,
                    }
                ],
            }
        )

        trainer_context = resolve_trainer_context(supabase, "client-user-321")

        self.assertEqual(trainer_context.client_id, "client-321")
        self.assertEqual(trainer_context.client_user_id, "client-user-321")
        self.assertEqual(trainer_context.trainer_id, "trainer-321")


class ChatRequestValidationTests(unittest.TestCase):
    def test_chat_request_strips_whitespace(self):
        request = ChatRequest(message="  Ready for today?  ")
        self.assertEqual(request.message, "Ready for today?")

    def test_chat_request_rejects_blank_message(self):
        with self.assertRaisesRegex(ValueError, "message must not be empty"):
            ChatRequest(message="   ")


if __name__ == "__main__":
    unittest.main()
