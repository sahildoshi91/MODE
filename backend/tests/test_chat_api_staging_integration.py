import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from supabase import create_client
from supabase.lib.client_options import SyncClientOptions

from app.ai.client import GeminiCompletion, TokenUsage
from app.core.config import settings
from app.db.client import get_supabase_admin_client, get_supabase_user_client
from app.main import app


def _staging_env_ready() -> bool:
    return bool(
        os.getenv("MODE_RUN_STAGING_SUPABASE_TESTS") == "1"
        and settings.supabase_url
        and settings.supabase_anon_key
        and settings.supabase_service_role_key
    )


class FakeGeminiClient:
    def create_chat_completion(self, prompt):
        del prompt
        return GeminiCompletion(
            text="Staging integration response",
            token_usage=TokenUsage(
                prompt_tokens=31,
                completion_tokens=11,
                total_tokens=42,
                thoughts_tokens=0,
            ),
        )

    def stream_chat_completion(self, prompt):
        del prompt
        yield "Staging "
        yield "integration "
        yield "response"


@unittest.skipUnless(
    _staging_env_ready(),
    "Set MODE_RUN_STAGING_SUPABASE_TESTS=1 with real SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY to run.",
)
class ChatApiStagingIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin = get_supabase_admin_client()
        cls.anon = create_client(
            settings.supabase_url,
            settings.supabase_anon_key,
            options=SyncClientOptions(
                auto_refresh_token=False,
                persist_session=False,
            ),
        )
        cls.client = TestClient(app)
        cls.run_id = uuid4().hex
        cls.password = f"ModeStage!{cls.run_id[:12]}"
        cls.user_ids = []
        cls.tenant_id = None
        cls.trainer_id = None
        cls.client_id = None

        cls.trainer_user = cls._create_auth_user(f"mode-staging-trainer+{cls.run_id}@example.com")
        cls.client_user = cls._create_auth_user(f"mode-staging-client+{cls.run_id}@example.com")
        cls.outsider_user = cls._create_auth_user(f"mode-staging-outsider+{cls.run_id}@example.com")

        bootstrap_response = cls.admin.rpc(
            "bootstrap_trainer_tenant",
            {
                "trainer_user_id": cls.trainer_user["id"],
                "tenant_name": f"MODE Staging {cls.run_id}",
                "tenant_slug": f"mode-staging-{cls.run_id}",
                "trainer_display_name": "Coach Staging",
                "default_persona_name": "Staging Coach",
                "tone_description": "Warm, direct, practical.",
                "coaching_philosophy": "Keep the test path deterministic.",
            },
        ).execute()
        bootstrap_row = bootstrap_response.data[0]
        cls.tenant_id = bootstrap_row["tenant_id"]
        cls.trainer_id = bootstrap_row["trainer_id"]

        assignment_response = cls.admin.rpc(
            "assign_client_to_trainer",
            {
                "client_user_id": cls.client_user["id"],
                "trainer_record_id": cls.trainer_id,
            },
        ).execute()
        assignment_row = assignment_response.data[0]
        cls.client_id = assignment_row["client_id"]
        cls._assert_chat_conversation_type_supported()

        cls.client_access_token = cls._sign_in_and_get_access_token(cls.client_user["email"])
        cls.outsider_access_token = cls._sign_in_and_get_access_token(cls.outsider_user["email"])

    @classmethod
    def tearDownClass(cls):
        if cls.tenant_id:
            cls.admin.table("tenants").delete().eq("id", cls.tenant_id).execute()

        for user_id in cls.user_ids:
            try:
                cls.admin.auth.admin.delete_user(user_id)
            except Exception:
                pass

    @classmethod
    def _create_auth_user(cls, email):
        response = cls.admin.auth.admin.create_user(
            {
                "email": email,
                "password": cls.password,
                "email_confirm": True,
            }
        )
        user = response.user
        cls.user_ids.append(user.id)
        return {"id": user.id, "email": email}

    @classmethod
    def _sign_in_and_get_access_token(cls, email):
        response = cls.anon.auth.sign_in_with_password(
            {
                "email": email,
                "password": cls.password,
            }
        )
        session = getattr(response, "session", None)
        if not session or not session.access_token:
            raise RuntimeError(f"Failed to sign in staging test user {email}")
        return session.access_token

    @classmethod
    def _assert_chat_conversation_type_supported(cls):
        probe_conversation_id = None
        try:
            probe_response = (
                cls.admin
                .table("conversations")
                .insert(
                    {
                        "trainer_id": cls.trainer_id,
                        "client_id": cls.client_id,
                        "type": "chat",
                        "current_stage": "schema_preflight",
                    }
                )
                .execute()
            )
            probe_row = probe_response.data[0] if probe_response.data else None
            probe_conversation_id = probe_row.get("id") if probe_row else None
        except Exception as exc:
            raise RuntimeError(
                "Staging schema mismatch: conversations.type does not accept 'chat'. "
                "Run backend/sql/20260408c_repair_conversations_type_check.sql and retry."
            ) from exc
        finally:
            if probe_conversation_id:
                try:
                    cls.admin.table("conversations").delete().eq("id", probe_conversation_id).execute()
                except Exception:
                    pass

    def _chat(self, access_token, payload):
        with patch("app.modules.conversation.service.GeminiClient", return_value=FakeGeminiClient()):
            return self.client.post(
                "/api/v1/chat",
                json=payload,
                headers={"Authorization": f"Bearer {access_token}"},
            )

    def _create_or_continue_conversation(self):
        response = self._chat(
            self.client_access_token,
            {
                "message": "I can train four days this week. What should I focus on?",
                "client_context": {"platform": "staging-test"},
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_chat_persists_usage_with_real_supabase_rls(self):
        payload = self._create_or_continue_conversation()
        conversation_id = payload["conversation_id"]

        self.assertEqual(payload["assistant_message"], "Staging integration response")
        self.assertFalse(payload["fallback_triggered"])
        self.assertEqual(payload["token_usage"]["total_tokens"], 42)
        self.assertIsNotNone(payload["conversation_usage"])
        self.assertEqual(payload["conversation_usage"]["usage_event_count"], 1)
        self.assertEqual(payload["conversation_usage"]["total_tokens"], 42)
        self.assertEqual(payload["conversation_usage"]["last_execution_provider"], "gemini")
        self.assertEqual(payload["conversation_usage"]["last_execution_model"], "gemini-2.5-flash")

        user_client = get_supabase_user_client(self.client_access_token)
        conversation_rows = (
            user_client.table("conversations")
            .select("id, trainer_id, client_id, current_stage")
            .eq("id", conversation_id)
            .limit(1)
            .execute()
            .data
        )
        self.assertEqual(len(conversation_rows), 1)
        self.assertEqual(conversation_rows[0]["trainer_id"], self.trainer_id)
        self.assertEqual(conversation_rows[0]["client_id"], self.client_id)

        message_rows = (
            user_client.table("conversation_messages")
            .select("id, role, message_text")
            .eq("conversation_id", conversation_id)
            .order("created_at", desc=False)
            .execute()
            .data
        )
        self.assertEqual([row["role"] for row in message_rows], ["user", "assistant"])

        usage_rows = (
            user_client.table("conversation_usage_events")
            .select("conversation_id, provider, model, total_tokens")
            .eq("conversation_id", conversation_id)
            .execute()
            .data
        )
        self.assertEqual(len(usage_rows), 1)
        self.assertEqual(usage_rows[0]["provider"], "gemini")
        self.assertEqual(usage_rows[0]["model"], "gemini-2.5-flash")
        self.assertEqual(usage_rows[0]["total_tokens"], 42)

        summary_rows = (
            user_client.table("conversation_usage_summary")
            .select("*")
            .eq("conversation_id", conversation_id)
            .limit(1)
            .execute()
            .data
        )
        self.assertEqual(len(summary_rows), 1)
        self.assertEqual(summary_rows[0]["usage_event_count"], 1)
        self.assertEqual(summary_rows[0]["total_tokens"], 42)

    def test_chat_rejects_existing_conversation_for_unrelated_user(self):
        conversation_id = self._create_or_continue_conversation()["conversation_id"]

        response = self._chat(
            self.outsider_access_token,
            {
                "conversation_id": conversation_id,
                "message": "Can I read this conversation?",
                "client_context": {"platform": "staging-test"},
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Conversation not found")

        outsider_client = get_supabase_user_client(self.outsider_access_token)
        self.assertEqual(
            outsider_client.table("conversations")
            .select("id")
            .eq("id", conversation_id)
            .execute()
            .data,
            [],
        )
        self.assertEqual(
            outsider_client.table("conversation_usage_events")
            .select("id")
            .eq("conversation_id", conversation_id)
            .execute()
            .data,
            [],
        )
        self.assertEqual(
            outsider_client.table("conversation_usage_summary")
            .select("conversation_id")
            .eq("conversation_id", conversation_id)
            .execute()
            .data,
            [],
        )


if __name__ == "__main__":
    unittest.main()
