import os
import sys
import unittest
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from supabase import create_client
from supabase.lib.client_options import SyncClientOptions

from app.core.config import settings
from app.db.client import get_supabase_admin_client, get_supabase_user_client


def _staging_env_ready() -> bool:
    return bool(
        os.getenv("MODE_RUN_STAGING_SUPABASE_TESTS") == "1"
        and settings.supabase_url
        and settings.supabase_anon_key
        and settings.supabase_service_role_key
    )


@unittest.skipUnless(
    _staging_env_ready(),
    "Set MODE_RUN_STAGING_SUPABASE_TESTS=1 with real SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY to run.",
)
class StagingDbSecurityIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin = get_supabase_admin_client()
        cls.anon = create_client(
            settings.supabase_url,
            settings.supabase_anon_key,
            options=SyncClientOptions(auto_refresh_token=False, persist_session=False),
        )
        cls.run_id = uuid4().hex
        cls.password = f"ModeStage!{cls.run_id[:12]}"
        cls.user_ids: list[str] = []
        cls.tenant_ids: list[str] = []

        cls.trainer_1_user = cls._create_auth_user(f"mode-security-trainer1+{cls.run_id}@example.com")
        cls.trainer_1_peer_user = cls._create_auth_user(f"mode-security-trainer1-peer+{cls.run_id}@example.com")
        cls.trainer_2_user = cls._create_auth_user(f"mode-security-trainer2+{cls.run_id}@example.com")
        cls.client_1_user = cls._create_auth_user(f"mode-security-client1+{cls.run_id}@example.com")
        cls.client_1_peer_user = cls._create_auth_user(f"mode-security-client1-peer+{cls.run_id}@example.com")
        cls.client_2_user = cls._create_auth_user(f"mode-security-client2+{cls.run_id}@example.com")

        cls.tenant_1_id, cls.trainer_1_id = cls._bootstrap_trainer_tenant(
            trainer_user_id=cls.trainer_1_user["id"],
            tenant_name=f"MODE Security Tenant A {cls.run_id}",
            tenant_slug=f"mode-security-a-{cls.run_id}",
            trainer_display_name="Security Coach A",
        )
        cls.tenant_2_id, cls.trainer_2_id = cls._bootstrap_trainer_tenant(
            trainer_user_id=cls.trainer_2_user["id"],
            tenant_name=f"MODE Security Tenant B {cls.run_id}",
            tenant_slug=f"mode-security-b-{cls.run_id}",
            trainer_display_name="Security Coach B",
        )
        cls.tenant_ids.extend([cls.tenant_1_id, cls.tenant_2_id])

        cls.trainer_1_peer_id = (
            cls.admin.table("trainers")
            .insert(
                {
                    "tenant_id": cls.tenant_1_id,
                    "user_id": cls.trainer_1_peer_user["id"],
                    "display_name": "Security Coach A Peer",
                }
            )
            .execute()
            .data[0]["id"]
        )

        cls.client_1_id = cls._assign_client_to_trainer(
            client_user_id=cls.client_1_user["id"],
            trainer_record_id=cls.trainer_1_id,
        )
        cls.client_1_peer_id = cls._assign_client_to_trainer(
            client_user_id=cls.client_1_peer_user["id"],
            trainer_record_id=cls.trainer_1_peer_id,
        )
        cls.client_2_id = cls._assign_client_to_trainer(
            client_user_id=cls.client_2_user["id"],
            trainer_record_id=cls.trainer_2_id,
        )

        cls.trainer_1_token = cls._sign_in_and_get_access_token(cls.trainer_1_user["email"])
        cls.client_1_token = cls._sign_in_and_get_access_token(cls.client_1_user["email"])

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
                "default_persona_name": "Security Coach",
                "tone_description": "Secure and direct.",
                "coaching_philosophy": "Never leak cross-tenant data.",
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

    def test_trainer_cannot_read_cross_tenant_client_rows(self):
        trainer_client = get_supabase_user_client(self.trainer_1_token)
        rows = (
            trainer_client.table("clients")
            .select("id")
            .eq("id", self.client_2_id)
            .execute()
            .data
        )
        self.assertEqual(rows or [], [])

    def test_client_cannot_read_cross_tenant_trainer_rows(self):
        client_user = get_supabase_user_client(self.client_1_token)
        rows = (
            client_user.table("trainers")
            .select("id")
            .eq("id", self.trainer_2_id)
            .execute()
            .data
        )
        self.assertEqual(rows or [], [])

    def test_trainer_assets_are_not_client_visible_cross_tenant(self):
        client_user = get_supabase_user_client(self.client_1_token)
        rows = (
            client_user.table("trainer_personas")
            .select("id, trainer_id")
            .eq("trainer_id", self.trainer_2_id)
            .execute()
            .data
        )
        self.assertEqual(rows or [], [])

    def test_trainer_cannot_read_unassigned_client_rows_within_same_tenant(self):
        trainer_client = get_supabase_user_client(self.trainer_1_token)
        rows = (
            trainer_client.table("clients")
            .select("id")
            .eq("id", self.client_1_peer_id)
            .execute()
            .data
        )
        self.assertEqual(rows or [], [])


if __name__ == "__main__":
    unittest.main()
