import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from starlette.requests import Request

from app.core.auth import AuthenticatedUser
from app.core.dependencies import clear_trainer_context_cache, get_trainer_context
from app.core.tenancy import TrainerContext, resolve_trainer_context, resolve_trainer_context_bootstrap
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


class FakeRpcCall:
    def __init__(self, response):
        self.response = response

    def execute(self):
        return self.response


class FakeRpcSupabase:
    def __init__(self, row):
        self.row = row
        self.rpc_calls = 0

    def rpc(self, name, params):
        self.rpc_calls += 1
        self.last_rpc = (name, params)
        return FakeRpcCall(FakeResponse([self.row]))


class TrainerContextResolutionTests(unittest.TestCase):
    def tearDown(self):
        clear_trainer_context_cache()

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

    def test_resolve_trainer_context_prefers_assigned_client_when_multiple_client_rows_exist(self):
        supabase = FakeSupabase(
            {
                "clients": [
                    {
                        "id": "client-self-guided",
                        "tenant_id": "tenant-self-guided",
                        "user_id": "client-user-777",
                        "assigned_trainer_id": None,
                        "created_at": "2026-04-01T00:00:00+00:00",
                    },
                    {
                        "id": "client-attached",
                        "tenant_id": "tenant-777",
                        "user_id": "client-user-777",
                        "assigned_trainer_id": "trainer-777",
                        "created_at": "2026-03-01T00:00:00+00:00",
                    },
                ],
                "trainers": [
                    {
                        "id": "trainer-777",
                        "tenant_id": "tenant-777",
                        "user_id": "trainer-user-777",
                        "display_name": "Coach Jordan",
                    }
                ],
                "trainer_personas": [
                    {
                        "id": "persona-777",
                        "trainer_id": "trainer-777",
                        "persona_name": "Performance Coach",
                        "is_default": True,
                    }
                ],
            }
        )

        trainer_context = resolve_trainer_context(supabase, "client-user-777")

        self.assertEqual(trainer_context.client_id, "client-attached")
        self.assertEqual(trainer_context.trainer_id, "trainer-777")

    def test_bootstrap_rpc_resolves_context_in_one_call(self):
        supabase = FakeRpcSupabase(
            {
                "tenant_id": "tenant-rpc",
                "trainer_id": "trainer-rpc",
                "trainer_user_id": "trainer-user-rpc",
                "trainer_display_name": "Coach RPC",
                "client_id": "client-rpc",
                "client_user_id": "client-user-rpc",
                "persona_id": "persona-rpc",
                "persona_name": "Launch Coach",
                "trainer_onboarding_completed": True,
                "trainer_onboarding_status": "completed",
                "trainer_onboarding_completed_steps": 8,
                "trainer_onboarding_total_steps": 8,
                "trainer_onboarding_last_step": "launch",
            }
        )

        trainer_context, rpc_used = resolve_trainer_context_bootstrap(supabase, "client-user-rpc")

        self.assertTrue(rpc_used)
        self.assertEqual(supabase.rpc_calls, 1)
        self.assertEqual(supabase.last_rpc, ("chat_bootstrap_context", {}))
        self.assertEqual(trainer_context.tenant_id, "tenant-rpc")
        self.assertEqual(trainer_context.trainer_id, "trainer-rpc")
        self.assertEqual(trainer_context.client_id, "client-rpc")
        self.assertEqual(trainer_context.persona_id, "persona-rpc")
        self.assertTrue(trainer_context.trainer_onboarding_completed)

    def test_trainer_context_cache_avoids_repeated_bootstrap_resolution(self):
        clear_trainer_context_cache()
        request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
        second_request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
        user = AuthenticatedUser(id="user-cache", email="cache@example.com", access_token="token-cache")
        context = TrainerContext(
            tenant_id="tenant-cache",
            trainer_id="trainer-cache",
            trainer_user_id="trainer-user-cache",
            trainer_display_name="Coach Cache",
            client_id="client-cache",
            client_user_id="user-cache",
        )

        with patch("app.core.dependencies.resolve_trainer_context_bootstrap_token", return_value=(context, True)) as resolver:
            first = get_trainer_context(request, user=user)
            second = get_trainer_context(second_request, user=user)

        self.assertEqual(first, context)
        self.assertEqual(second, context)
        self.assertEqual(resolver.call_count, 1)
        self.assertFalse(request.state.tenant_context_cache_hit)
        self.assertTrue(second_request.state.tenant_context_cache_hit)

    def test_trainer_context_uses_direct_bootstrap_without_supabase_sdk_client(self):
        clear_trainer_context_cache()
        request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
        user = AuthenticatedUser(id="user-direct", email="direct@example.com", access_token="token-direct")
        context = TrainerContext(
            tenant_id="tenant-direct",
            trainer_id="trainer-direct",
            trainer_user_id="trainer-user-direct",
            trainer_display_name="Coach Direct",
            client_id="client-direct",
            client_user_id="user-direct",
        )

        with (
            patch("app.core.dependencies.resolve_trainer_context_bootstrap_token", return_value=(context, True)),
            patch(
                "app.core.dependencies.get_request_scoped_supabase_client",
                side_effect=AssertionError("direct bootstrap should not build a Supabase SDK client"),
            ),
        ):
            resolved = get_trainer_context(request, user=user)

        self.assertEqual(resolved, context)
        self.assertFalse(request.state.tenant_context_cache_hit)
        self.assertTrue(request.state.tenant_context_rpc_used)


class ChatRequestValidationTests(unittest.TestCase):
    def test_chat_request_strips_whitespace(self):
        request = ChatRequest(message="  Ready for today?  ")
        self.assertEqual(request.message, "Ready for today?")

    def test_chat_request_rejects_blank_message(self):
        with self.assertRaisesRegex(ValueError, "message must not be empty"):
            ChatRequest(message="   ")


if __name__ == "__main__":
    unittest.main()
