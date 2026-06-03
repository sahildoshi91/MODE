import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_internal_onboarding_repository, get_request_scoped_supabase_client, get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.onboarding.repository import SELF_GUIDED_TENANT_SLUG


class FakeAuthResponse:
    def __init__(self, user):
        self.user = user


class FakeAuth:
    def __init__(self, user):
        self.user = user
        self.tokens = []

    def get_user(self, token):
        self.tokens.append(token)
        return FakeAuthResponse(self.user)


class FakeSupabaseClient:
    def __init__(self, auth_user):
        self.auth = FakeAuth(auth_user)


class FakeAccountRepository:
    def __init__(self, tenant_slug=None):
        self.tenant_slug = tenant_slug
        self.synced_accounts = []

    def ensure_user_account(self, *, user_id, email):
        self.synced_accounts.append({"user_id": user_id, "email": email})
        return {
            "id": "account-123",
            "auth_user_id": user_id,
            "email": email,
        }

    def get_tenant_slug(self, *, tenant_id):
        del tenant_id
        return self.tenant_slug


class AccountApiTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="user-123",
            email="stale-token@example.com",
            access_token="token-123",
        )
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_get_account_me_reports_pending_email_from_auth_user_and_syncs_confirmed_email(self):
        fake_repo = FakeAccountRepository()
        app.dependency_overrides[get_internal_onboarding_repository] = lambda: fake_repo
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: FakeSupabaseClient({
            "email": "confirmed@example.com",
            "new_email": "pending@example.com",
            "email_change_sent_at": "2026-06-03T12:00:00Z",
        })
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-123",
        )

        response = self.client.get(
            "/api/v1/account/me",
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["email"], "confirmed@example.com")
        self.assertTrue(payload["pending_email_change"])
        self.assertEqual(payload["pending_email"], "pending@example.com")
        self.assertEqual(payload["user_account_id"], "account-123")
        self.assertEqual(payload["viewer_role"], "client")
        self.assertEqual(payload["client_id"], "client-123")
        self.assertEqual(payload["assigned_trainer_id"], "trainer-1")
        self.assertEqual(payload["assigned_trainer_display_name"], "Coach Maya")
        self.assertEqual(fake_repo.synced_accounts[0]["email"], "confirmed@example.com")

    def test_get_account_me_ignores_matching_new_email(self):
        fake_repo = FakeAccountRepository()
        app.dependency_overrides[get_internal_onboarding_repository] = lambda: fake_repo
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: FakeSupabaseClient({
            "email": "confirmed@example.com",
            "new_email": "confirmed@example.com",
            "email_change_sent_at": "2026-06-03T12:00:00Z",
        })
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id=None,
            trainer_user_id=None,
            trainer_display_name=None,
            client_id="client-123",
        )

        response = self.client.get(
            "/api/v1/account/me",
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["pending_email_change"])
        self.assertIsNone(payload["pending_email"])

    def test_get_account_me_marks_self_guided_unassigned_client(self):
        fake_repo = FakeAccountRepository(tenant_slug=SELF_GUIDED_TENANT_SLUG)
        app.dependency_overrides[get_internal_onboarding_repository] = lambda: fake_repo
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: FakeSupabaseClient({
            "email": "client@example.com",
            "new_email": None,
            "email_change_sent_at": None,
        })
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="self-guided-tenant",
            trainer_id=None,
            trainer_user_id=None,
            trainer_display_name=None,
            client_id="client-self",
        )

        response = self.client.get(
            "/api/v1/account/me",
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["viewer_role"], "client")
        self.assertTrue(payload["is_self_guided"])
        self.assertIsNone(payload["assigned_trainer_id"])


if __name__ == "__main__":
    unittest.main()
