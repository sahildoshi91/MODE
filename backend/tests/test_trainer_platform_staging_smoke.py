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
from app.db.client import get_supabase_admin_client
from app.main import app


def _staging_env_ready() -> bool:
    return bool(
        os.getenv("MODE_RUN_STAGING_SUPABASE_TESTS") == "1"
        and settings.supabase_url
        and settings.supabase_anon_key
        and settings.supabase_service_role_key
    )


class FakeLLMClient:
    def create_chat_completion(self, prompt):
        del prompt
        return GeminiCompletion(
            text="Trainer platform staging smoke response",
            token_usage=TokenUsage(
                prompt_tokens=21,
                completion_tokens=9,
                total_tokens=30,
                thoughts_tokens=0,
            ),
        )

    def stream_chat_completion(self, prompt):
        del prompt
        yield "Trainer "
        yield "platform "
        yield "staging "
        yield "smoke "
        yield "response"


@unittest.skipUnless(
    _staging_env_ready(),
    "Set MODE_RUN_STAGING_SUPABASE_TESTS=1 with real SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY to run.",
)
class TrainerPlatformStagingSmokeTests(unittest.TestCase):
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
        cls.tenant_ids = []

        cls.trainer_1_user = cls._create_auth_user(f"mode-stage-trainer1+{cls.run_id}@example.com")
        cls.trainer_2_user = cls._create_auth_user(f"mode-stage-trainer2+{cls.run_id}@example.com")
        cls.client_1_user = cls._create_auth_user(f"mode-stage-client1+{cls.run_id}@example.com")
        cls.client_2_user = cls._create_auth_user(f"mode-stage-client2+{cls.run_id}@example.com")
        cls.outsider_user = cls._create_auth_user(f"mode-stage-outsider+{cls.run_id}@example.com")

        cls.tenant_1_id, cls.trainer_1_id = cls._bootstrap_trainer_tenant(
            trainer_user_id=cls.trainer_1_user["id"],
            tenant_name=f"MODE Stage Tenant A {cls.run_id}",
            tenant_slug=f"mode-stage-a-{cls.run_id}",
            trainer_display_name="Coach Stage A",
        )
        cls.tenant_2_id, cls.trainer_2_id = cls._bootstrap_trainer_tenant(
            trainer_user_id=cls.trainer_2_user["id"],
            tenant_name=f"MODE Stage Tenant B {cls.run_id}",
            tenant_slug=f"mode-stage-b-{cls.run_id}",
            trainer_display_name="Coach Stage B",
        )
        cls.tenant_ids.extend([cls.tenant_1_id, cls.tenant_2_id])

        cls.client_1_id = cls._assign_client_to_trainer(
            client_user_id=cls.client_1_user["id"],
            trainer_record_id=cls.trainer_1_id,
        )
        cls.client_2_id = cls._assign_client_to_trainer(
            client_user_id=cls.client_2_user["id"],
            trainer_record_id=cls.trainer_2_id,
        )
        cls.outsider_client_id = cls._assign_client_to_trainer(
            client_user_id=cls.outsider_user["id"],
            trainer_record_id=cls.trainer_2_id,
        )

        cls.trainer_1_access_token = cls._sign_in_and_get_access_token(cls.trainer_1_user["email"])
        cls.trainer_2_access_token = cls._sign_in_and_get_access_token(cls.trainer_2_user["email"])
        cls.client_1_access_token = cls._sign_in_and_get_access_token(cls.client_1_user["email"])
        cls.client_2_access_token = cls._sign_in_and_get_access_token(cls.client_2_user["email"])
        cls.outsider_access_token = cls._sign_in_and_get_access_token(cls.outsider_user["email"])

    @classmethod
    def tearDownClass(cls):
        for tenant_id in cls.tenant_ids:
            try:
                cls.admin.table("tenants").delete().eq("id", tenant_id).execute()
            except Exception:
                pass

        for user_id in cls.user_ids:
            try:
                cls.admin.auth.admin.delete_user(user_id)
            except Exception:
                pass

    @classmethod
    def _create_auth_user(cls, email: str) -> dict[str, str]:
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
    def _bootstrap_trainer_tenant(
        cls,
        *,
        trainer_user_id: str,
        tenant_name: str,
        tenant_slug: str,
        trainer_display_name: str,
    ) -> tuple[str, str]:
        response = cls.admin.rpc(
            "bootstrap_trainer_tenant",
            {
                "trainer_user_id": trainer_user_id,
                "tenant_name": tenant_name,
                "tenant_slug": tenant_slug,
                "trainer_display_name": trainer_display_name,
                "default_persona_name": "Staging Coach",
                "tone_description": "Clear and practical.",
                "coaching_philosophy": "Protect isolation and consistency.",
            },
        ).execute()
        row = response.data[0]
        return row["tenant_id"], row["trainer_id"]

    @classmethod
    def _assign_client_to_trainer(cls, *, client_user_id: str, trainer_record_id: str) -> str:
        response = cls.admin.rpc(
            "assign_client_to_trainer",
            {
                "client_user_id": client_user_id,
                "trainer_record_id": trainer_record_id,
            },
        ).execute()
        row = response.data[0]
        return row["client_id"]

    @classmethod
    def _sign_in_and_get_access_token(cls, email: str) -> str:
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

    def _headers(self, access_token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {access_token}"}

    def _send_chat(self, access_token: str, message: str) -> dict:
        with (
            patch("app.modules.conversation.service.GeminiClient", return_value=FakeLLMClient()),
            patch("app.modules.conversation.service.OpenAIClient", return_value=FakeLLMClient()),
            patch("app.modules.conversation.service.AnthropicClient", return_value=FakeLLMClient()),
        ):
            response = self.client.post(
                "/api/v1/chat",
                json={
                    "message": message,
                    "client_context": {"platform": "trainer-platform-staging-smoke"},
                },
                headers=self._headers(access_token),
            )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_trainer_actor_can_access_own_command_center_and_client_detail(self):
        command_center_response = self.client.get(
            "/api/v1/trainer-home/command-center",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(command_center_response.status_code, 200, command_center_response.text)

        own_client_response = self.client.get(
            f"/api/v1/trainer-clients/{self.client_1_id}/detail",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(own_client_response.status_code, 200, own_client_response.text)
        self.assertEqual(own_client_response.json()["client"]["client_id"], self.client_1_id)

    def test_client_and_outsider_cannot_access_trainer_only_routes(self):
        client_response = self.client.get(
            "/api/v1/trainer-home/command-center",
            headers=self._headers(self.client_1_access_token),
        )
        self.assertEqual(client_response.status_code, 403, client_response.text)

        outsider_response = self.client.get(
            "/api/v1/trainer-home/command-center",
            headers=self._headers(self.outsider_access_token),
        )
        self.assertEqual(outsider_response.status_code, 403, outsider_response.text)

    def test_cross_trainer_client_detail_access_is_blocked(self):
        trainer_1_cross_response = self.client.get(
            f"/api/v1/trainer-clients/{self.client_2_id}/detail",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(trainer_1_cross_response.status_code, 404, trainer_1_cross_response.text)

        trainer_2_cross_response = self.client.get(
            f"/api/v1/trainer-clients/{self.client_1_id}/detail",
            headers=self._headers(self.trainer_2_access_token),
        )
        self.assertEqual(trainer_2_cross_response.status_code, 404, trainer_2_cross_response.text)

    def test_trainer_review_outputs_are_scoped_to_current_trainer(self):
        self._send_chat(self.client_1_access_token, "Give me a quick progression adjustment.")
        self._send_chat(self.client_2_access_token, "Need a check-in summary for tomorrow.")

        trainer_1_outputs = self.client.get(
            "/api/v1/trainer-review/outputs?source_type=chat",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(trainer_1_outputs.status_code, 200, trainer_1_outputs.text)
        trainer_1_items = trainer_1_outputs.json().get("items", [])
        self.assertGreaterEqual(len(trainer_1_items), 1)
        self.assertTrue(all(item.get("trainer_id") == self.trainer_1_id for item in trainer_1_items))
        self.assertTrue(all(item.get("client_id") == self.client_1_id for item in trainer_1_items))

        trainer_2_outputs = self.client.get(
            "/api/v1/trainer-review/outputs?source_type=chat",
            headers=self._headers(self.trainer_2_access_token),
        )
        self.assertEqual(trainer_2_outputs.status_code, 200, trainer_2_outputs.text)
        trainer_2_items = trainer_2_outputs.json().get("items", [])
        self.assertGreaterEqual(len(trainer_2_items), 1)
        self.assertTrue(all(item.get("trainer_id") == self.trainer_2_id for item in trainer_2_items))
        self.assertTrue(all(item.get("client_id") == self.client_2_id for item in trainer_2_items))


if __name__ == "__main__":
    unittest.main()
