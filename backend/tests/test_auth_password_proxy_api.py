import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.rate_limit import _rate_limiter
from app.main import app


class _FakeAuthClient:
    def __init__(self):
        self._sign_in_error = None
        self._sign_up_error = None
        self._reset_error = None

    def sign_in_with_password(self, _payload):
        if self._sign_in_error:
            raise self._sign_in_error
        return SimpleNamespace(
            session=SimpleNamespace(
                access_token="access-token-123",
                refresh_token="refresh-token-123",
                token_type="bearer",
                expires_in=3600,
            ),
            user=SimpleNamespace(id="user-123", email="user@example.com"),
        )

    def sign_up(self, _payload):
        if self._sign_up_error:
            raise self._sign_up_error
        return SimpleNamespace(
            session=SimpleNamespace(
                access_token="signup-access-token",
                refresh_token="signup-refresh-token",
                token_type="bearer",
                expires_in=3600,
            ),
            user=SimpleNamespace(id="user-456", email="new@example.com"),
        )

    def reset_password_email(self, _email, _options=None):
        if self._reset_error:
            raise self._reset_error
        return None

    def reset_password_for_email(self, _email, _options=None):
        if self._reset_error:
            raise self._reset_error
        return None


class _FakePublicClient:
    def __init__(self, auth_client: _FakeAuthClient):
        self.auth = auth_client


class AuthPasswordProxyApiTests(unittest.TestCase):
    def setUp(self):
        self._orig_enabled = settings.auth_password_proxy_enabled
        self._orig_rate_limit_enabled = settings.rate_limit_enabled
        self._orig_rate_limit_backend = settings.rate_limit_backend
        self._orig_login_limit = settings.rate_limit_login_per_window
        self._orig_signup_limit = settings.rate_limit_signup_per_window
        self._orig_reset_limit = settings.rate_limit_password_reset_per_window
        self._orig_window = settings.rate_limit_window_seconds

        settings.auth_password_proxy_enabled = True
        settings.rate_limit_enabled = True
        settings.rate_limit_backend = "memory"
        settings.rate_limit_window_seconds = 60
        settings.rate_limit_login_per_window = 1
        settings.rate_limit_signup_per_window = 5
        settings.rate_limit_password_reset_per_window = 5
        _rate_limiter._windows.clear()
        self.client = TestClient(app)

    def tearDown(self):
        settings.auth_password_proxy_enabled = self._orig_enabled
        settings.rate_limit_enabled = self._orig_rate_limit_enabled
        settings.rate_limit_backend = self._orig_rate_limit_backend
        settings.rate_limit_login_per_window = self._orig_login_limit
        settings.rate_limit_signup_per_window = self._orig_signup_limit
        settings.rate_limit_password_reset_per_window = self._orig_reset_limit
        settings.rate_limit_window_seconds = self._orig_window
        _rate_limiter._windows.clear()

    def test_sign_in_with_password_returns_session(self):
        fake_auth = _FakeAuthClient()
        with patch(
            "app.api.v1.auth_password.get_supabase_public_client",
            return_value=_FakePublicClient(fake_auth),
        ):
            response = self.client.post(
                "/api/v1/auth/password/sign-in",
                json={"email": "user@example.com", "password": "Password123!"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["access_token"], "access-token-123")
        self.assertEqual(payload["refresh_token"], "refresh-token-123")
        self.assertEqual(payload["user_id"], "user-123")

    def test_sign_in_invalid_credentials_returns_generic_401(self):
        fake_auth = _FakeAuthClient()
        fake_auth._sign_in_error = RuntimeError("bad credentials")
        with patch(
            "app.api.v1.auth_password.get_supabase_public_client",
            return_value=_FakePublicClient(fake_auth),
        ):
            response = self.client.post(
                "/api/v1/auth/password/sign-in",
                json={"email": "user@example.com", "password": "Password123!"},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Invalid credentials")

    def test_sign_in_endpoint_is_rate_limited(self):
        fake_auth = _FakeAuthClient()
        with patch(
            "app.api.v1.auth_password.get_supabase_public_client",
            return_value=_FakePublicClient(fake_auth),
        ):
            first = self.client.post(
                "/api/v1/auth/password/sign-in",
                json={"email": "user@example.com", "password": "Password123!"},
            )
            second = self.client.post(
                "/api/v1/auth/password/sign-in",
                json={"email": "user@example.com", "password": "Password123!"},
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)

    def test_sign_up_with_password_returns_session_envelope(self):
        fake_auth = _FakeAuthClient()
        with patch(
            "app.api.v1.auth_password.get_supabase_public_client",
            return_value=_FakePublicClient(fake_auth),
        ):
            response = self.client.post(
                "/api/v1/auth/password/sign-up",
                json={"email": "new@example.com", "password": "Password123!"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user_id"], "user-456")

    def test_password_reset_returns_success_even_when_provider_errors(self):
        fake_auth = _FakeAuthClient()
        fake_auth._reset_error = RuntimeError("user not found")
        with patch(
            "app.api.v1.auth_password.get_supabase_public_client",
            return_value=_FakePublicClient(fake_auth),
        ):
            response = self.client.post(
                "/api/v1/auth/password/reset",
                json={"email": "missing@example.com", "redirect_to": "mode://auth/callback"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])


if __name__ == "__main__":
    unittest.main()
