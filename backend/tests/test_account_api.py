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

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.config import settings
from app.core.dependencies import get_internal_onboarding_repository, get_request_scoped_supabase_client, get_trainer_context
from app.core import rate_limit
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.onboarding.repository import SELF_GUIDED_TENANT_SLUG


class FakeAuthResponse:
    def __init__(self, user):
        self.user = user


class FakeAuth:
    def __init__(self, user, *, update_error=None, session=None):
        self.user = user
        self.update_error = update_error
        self.session = session
        self.tokens = []
        self.update_payloads = []
        self.sign_out_options = []

    def get_user(self, token):
        self.tokens.append(token)
        return FakeAuthResponse(self.user)

    def update_user(self, payload):
        self.update_payloads.append(payload)
        if self.update_error:
            raise self.update_error
        return FakeAuthResponse(self.user)

    def get_session(self):
        return self.session

    def sign_out(self, options=None):
        self.sign_out_options.append(options)


class FakeSupabaseClient:
    def __init__(self, auth_user, *, update_error=None, session=None):
        self.auth = FakeAuth(auth_user, update_error=update_error, session=session)


class FakeAdminAuth:
    def __init__(self):
        self.sign_out_calls = []
        self.update_user_by_id_calls = []

    def sign_out(self, jwt, scope="global"):
        self.sign_out_calls.append((jwt, scope))

    def update_user_by_id(self, user_id, payload):
        self.update_user_by_id_calls.append((user_id, payload))


class FakeAdminClient:
    def __init__(self):
        self.auth = type("FakeAdminNamespace", (), {"admin": FakeAdminAuth()})()


class FakePublicAuth:
    def __init__(self, user, *, sign_in_error=None):
        self.user = user
        self.sign_in_error = sign_in_error
        self.sign_in_payloads = []

    def sign_in_with_password(self, payload):
        self.sign_in_payloads.append(payload)
        if self.sign_in_error:
            raise self.sign_in_error
        return FakeAuthResponse(self.user)


class FakePublicClient:
    def __init__(self, auth_user, *, sign_in_error=None):
        self.auth = FakePublicAuth(auth_user, sign_in_error=sign_in_error)


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
        self.original_auth_password_proxy_enabled = settings.auth_password_proxy_enabled
        self.original_rate_limit_enabled = settings.rate_limit_enabled
        self.original_rate_limit_backend = settings.rate_limit_backend
        self.original_password_limit = settings.rate_limit_credential_password_change_per_window
        self.original_password_window = settings.rate_limit_credential_password_change_window_seconds
        self.original_email_limit = settings.rate_limit_credential_email_change_per_window
        self.original_email_window = settings.rate_limit_credential_email_change_window_seconds
        settings.auth_password_proxy_enabled = True
        settings.rate_limit_enabled = False
        settings.rate_limit_backend = "memory"
        rate_limit._rate_limiter._windows.clear()
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="user-123",
            email="stale-token@example.com",
            access_token="token-123",
        )
        self.client = TestClient(app)

    def tearDown(self):
        settings.auth_password_proxy_enabled = self.original_auth_password_proxy_enabled
        settings.rate_limit_enabled = self.original_rate_limit_enabled
        settings.rate_limit_backend = self.original_rate_limit_backend
        settings.rate_limit_credential_password_change_per_window = self.original_password_limit
        settings.rate_limit_credential_password_change_window_seconds = self.original_password_window
        settings.rate_limit_credential_email_change_per_window = self.original_email_limit
        settings.rate_limit_credential_email_change_window_seconds = self.original_email_window
        rate_limit._rate_limiter._windows.clear()
        app.dependency_overrides.clear()

    def test_00_credential_routes_are_disabled_when_password_proxy_flag_is_off(self):
        settings.auth_password_proxy_enabled = False
        fake_supabase = FakeSupabaseClient({"id": "user-123", "email": "confirmed@example.com"})
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: fake_supabase

        password_response = self.client.patch(
            "/api/v1/account/password",
            json={
                "current_password": "currentpassword123",
                "new_password": "newpassword1234",
            },
            headers={"Authorization": "Bearer ignored"},
        )
        email_response = self.client.patch(
            "/api/v1/account/email",
            json={"email": "next@example.com"},
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(password_response.status_code, 503)
        self.assertEqual(email_response.status_code, 503)
        self.assertEqual(fake_supabase.auth.update_payloads, [])

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

    def test_change_password_requires_authentication(self):
        app.dependency_overrides.clear()

        response = self.client.patch(
            "/api/v1/account/password",
            json={
                "current_password": "currentpassword123",
                "new_password": "newpassword1234",
            },
        )

        self.assertEqual(response.status_code, 401)

    def test_change_password_rejects_short_or_matching_new_password_before_provider_call(self):
        fake_supabase = FakeSupabaseClient({"id": "user-123", "email": "confirmed@example.com"})
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: fake_supabase

        short_response = self.client.patch(
            "/api/v1/account/password",
            json={
                "current_password": "currentpassword123",
                "new_password": "short",
            },
            headers={"Authorization": "Bearer ignored"},
        )
        matching_response = self.client.patch(
            "/api/v1/account/password",
            json={
                "current_password": "samepassword123",
                "new_password": "samepassword123",
            },
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(short_response.status_code, 400)
        self.assertEqual(short_response.json(), {"detail": "Unable to update password"})
        self.assertEqual(matching_response.status_code, 400)
        self.assertEqual(fake_supabase.auth.update_payloads, [])

    def test_change_password_provider_failures_are_generic(self):
        fake_supabase = FakeSupabaseClient(
            {"id": "user-123", "email": "confirmed@example.com"},
            update_error=RuntimeError("wrong password"),
        )
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: fake_supabase

        response = self.client.patch(
            "/api/v1/account/password",
            json={
                "current_password": "currentpassword123",
                "new_password": "newpassword1234",
            },
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Unable to update password"})

    def test_change_password_updates_with_current_password_and_revokes_other_sessions(self):
        fake_session = type("FakeSession", (), {"access_token": "token-123"})()
        fake_supabase = FakeSupabaseClient(
            {"id": "user-123", "email": "confirmed@example.com"},
            session=fake_session,
        )
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: fake_supabase

        response = self.client.patch(
            "/api/v1/account/password",
            json={
                "current_password": "currentpassword123",
                "new_password": "newpassword1234",
            },
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.assertEqual(fake_supabase.auth.update_payloads[0], {
            "password": "newpassword1234",
            "current_password": "currentpassword123",
        })
        self.assertEqual(fake_supabase.auth.sign_out_options, [{"scope": "others"}])

    def test_change_password_admin_fallback_uses_validated_current_user_token_only(self):
        fake_supabase = FakeSupabaseClient({"id": "user-123", "email": "confirmed@example.com"})
        fake_admin = FakeAdminClient()
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: fake_supabase

        with patch("app.api.v1.account.get_supabase_admin_client", return_value=fake_admin):
            response = self.client.patch(
                "/api/v1/account/password",
                json={
                    "current_password": "currentpassword123",
                    "new_password": "newpassword1234",
                },
                headers={"Authorization": "Bearer ignored"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fake_supabase.auth.tokens, ["token-123"])
        self.assertEqual(fake_admin.auth.admin.sign_out_calls, [("token-123", "others")])

    def test_change_password_falls_back_to_verified_admin_update_when_user_update_fails(self):
        fake_supabase = FakeSupabaseClient(
            {"id": "user-123", "email": "confirmed@example.com"},
            update_error=RuntimeError("current_password_update_unsupported"),
        )
        fake_public = FakePublicClient({"id": "user-123", "email": "confirmed@example.com"})
        fake_admin = FakeAdminClient()
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: fake_supabase

        with (
            patch("app.api.v1.account.get_supabase_public_client", return_value=fake_public),
            patch("app.api.v1.account.get_supabase_admin_client", return_value=fake_admin),
        ):
            response = self.client.patch(
                "/api/v1/account/password",
                json={
                    "current_password": "currentpassword123",
                    "new_password": "newpassword1234",
                },
                headers={"Authorization": "Bearer ignored"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fake_public.auth.sign_in_payloads, [{
            "email": "confirmed@example.com",
            "password": "currentpassword123",
        }])
        self.assertEqual(fake_admin.auth.admin.update_user_by_id_calls, [(
            "user-123",
            {"password": "newpassword1234"},
        )])

    def test_change_password_succeeds_even_when_session_revocation_fails(self):
        fake_supabase = FakeSupabaseClient({"id": "user-123", "email": "confirmed@example.com"})
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: fake_supabase
        emitted_events = []

        def capture_audit(event, *, user, request, **extra):
            emitted_events.append(event)

        with (
            patch("app.api.v1.account._revoke_other_sessions", side_effect=RuntimeError("revoke_failed")),
            patch("app.api.v1.account._emit_credential_audit", side_effect=capture_audit),
        ):
            response = self.client.patch(
                "/api/v1/account/password",
                json={
                    "current_password": "currentpassword123",
                    "new_password": "newpassword1234",
                },
                headers={"Authorization": "Bearer ignored"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("credential.password_changed", emitted_events)
        self.assertIn("credential.session_revocation_failed", emitted_events)
        self.assertNotIn("credential.password_change_failed", emitted_events)

    def test_change_email_normalizes_address_and_rejects_identity_fields(self):
        fake_supabase = FakeSupabaseClient({"id": "user-123", "email": "confirmed@example.com"})
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: fake_supabase

        response = self.client.patch(
            "/api/v1/account/email",
            json={"email": "  Next@Example.COM  "},
            headers={"Authorization": "Bearer ignored"},
        )
        extra_response = self.client.patch(
            "/api/v1/account/email",
            json={"email": "other@example.com", "user_id": "user-999"},
            headers={"Authorization": "Bearer ignored"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.assertEqual(fake_supabase.auth.update_payloads[0], {"email": "next@example.com"})
        self.assertEqual(extra_response.status_code, 422)

    def test_change_password_rate_limit_is_user_scoped(self):
        settings.rate_limit_enabled = True
        settings.rate_limit_credential_password_change_per_window = 5
        settings.rate_limit_credential_password_change_window_seconds = 900
        fake_session = type("FakeSession", (), {"access_token": "token-123"})()
        fake_supabase = FakeSupabaseClient(
            {"id": "user-123", "email": "confirmed@example.com"},
            session=fake_session,
        )
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: fake_supabase

        responses = [
            self.client.patch(
                "/api/v1/account/password",
                json={
                    "current_password": "currentpassword123",
                    "new_password": f"newpassword123{i}",
                },
                headers={"Authorization": "Bearer ignored"},
            )
            for i in range(6)
        ]

        self.assertEqual([response.status_code for response in responses[:5]], [200, 200, 200, 200, 200])
        self.assertEqual(responses[5].status_code, 429)


if __name__ == "__main__":
    unittest.main()
