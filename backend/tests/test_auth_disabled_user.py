import os
import sys
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
import jwt
from cryptography.hazmat.primitives.asymmetric import ec

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.auth import clear_auth_user_cache, require_user


class _FakeAuth:
    def __init__(self, user):
        self._user = user
        self.calls = 0

    def get_user(self, _token):
        self.calls += 1
        return SimpleNamespace(user=self._user)


class _FakeSupabase:
    def __init__(self, user):
        self.auth = _FakeAuth(user)


class AuthDisabledUserTests(unittest.TestCase):
    def setUp(self):
        clear_auth_user_cache()

    def tearDown(self):
        clear_auth_user_cache()

    def _jwt_token(self, private_key, **overrides):
        now = int(time.time())
        claims = {
            "sub": "user-jwt-1",
            "email": "jwt@example.com",
            "aud": "authenticated",
            "iss": "https://example.supabase.co/auth/v1",
            "exp": now + 300,
            "app_metadata": {},
            "user_metadata": {},
        }
        claims.update(overrides)
        return jwt.encode(claims, private_key, algorithm="ES256", headers={"kid": "test-kid"})

    def test_deleted_user_is_rejected(self):
        user = SimpleNamespace(
            id="user-1",
            email="user@example.com",
            deleted_at=datetime.now(timezone.utc).isoformat(),
            banned_until=None,
            app_metadata={},
            user_metadata={},
        )
        with patch("app.core.auth.get_supabase_user_client", return_value=_FakeSupabase(user)):
            with self.assertRaises(HTTPException) as raised:
                require_user("Bearer token-123")
        self.assertEqual(raised.exception.status_code, 401)

    def test_banned_user_is_rejected(self):
        user = SimpleNamespace(
            id="user-1",
            email="user@example.com",
            deleted_at=None,
            banned_until=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            app_metadata={},
            user_metadata={},
        )
        with patch("app.core.auth.get_supabase_user_client", return_value=_FakeSupabase(user)):
            with self.assertRaises(HTTPException) as raised:
                require_user("Bearer token-123")
        self.assertEqual(raised.exception.status_code, 401)

    def test_disabled_metadata_user_is_rejected(self):
        user = SimpleNamespace(
            id="user-1",
            email="user@example.com",
            deleted_at=None,
            banned_until=None,
            app_metadata={"disabled": True},
            user_metadata={},
        )
        with patch("app.core.auth.get_supabase_user_client", return_value=_FakeSupabase(user)):
            with self.assertRaises(HTTPException) as raised:
                require_user("Bearer token-123")
        self.assertEqual(raised.exception.status_code, 401)

    def test_account_deleted_metadata_user_is_rejected(self):
        user = SimpleNamespace(
            id="user-1",
            email="user@example.com",
            deleted_at=None,
            banned_until=None,
            app_metadata={},
            user_metadata={"account_deleted": True},
        )
        with patch("app.core.auth.get_supabase_user_client", return_value=_FakeSupabase(user)):
            with self.assertRaises(HTTPException) as raised:
                require_user("Bearer token-123")
        self.assertEqual(raised.exception.status_code, 401)

    def test_active_user_is_allowed(self):
        user = SimpleNamespace(
            id="user-1",
            email="user@example.com",
            deleted_at=None,
            banned_until=None,
            app_metadata={},
            user_metadata={},
        )
        with patch("app.core.auth.get_supabase_user_client", return_value=_FakeSupabase(user)):
            resolved = require_user("Bearer token-123")
        self.assertEqual(resolved.id, "user-1")
        self.assertEqual(resolved.access_token, "token-123")

    def test_active_user_is_cached_briefly(self):
        user = SimpleNamespace(
            id="user-1",
            email="user@example.com",
            deleted_at=None,
            banned_until=None,
            app_metadata={},
            user_metadata={},
        )
        fake_supabase = _FakeSupabase(user)
        with patch("app.core.auth.get_supabase_user_client", return_value=fake_supabase):
            first = require_user("Bearer token-123")
            second = require_user("Bearer token-123")

        self.assertEqual(first.id, "user-1")
        self.assertEqual(second.id, "user-1")
        self.assertEqual(fake_supabase.auth.calls, 1)

    def test_es256_jwks_token_verifies_locally_without_remote_get_user(self):
        private_key = ec.generate_private_key(ec.SECP256R1())
        token = self._jwt_token(private_key)

        with (
            patch("app.core.auth._get_jwks_signing_key", return_value=private_key.public_key()),
            patch("app.core.auth.get_supabase_user_client") as get_client,
        ):
            resolved = require_user(f"Bearer {token}")

        self.assertEqual(resolved.id, "user-jwt-1")
        self.assertEqual(resolved.email, "jwt@example.com")
        self.assertEqual(resolved.access_token, token)
        get_client.assert_not_called()

    def test_bad_local_jwt_claims_are_rejected(self):
        private_key = ec.generate_private_key(ec.SECP256R1())
        other_private_key = ec.generate_private_key(ec.SECP256R1())
        expired_at = int(time.time()) - 60
        bad_tokens = [
            self._jwt_token(private_key, aud="anon"),
            self._jwt_token(private_key, iss="https://example.supabase.co/auth/v1/wrong"),
            self._jwt_token(private_key, exp=expired_at),
            self._jwt_token(other_private_key),
        ]

        with patch("app.core.auth._get_jwks_signing_key", return_value=private_key.public_key()):
            for token in bad_tokens:
                clear_auth_user_cache()
                with self.assertRaises(HTTPException) as raised:
                    require_user(f"Bearer {token}")
                self.assertEqual(raised.exception.status_code, 401)

    def test_disabled_metadata_in_local_jwt_is_rejected(self):
        private_key = ec.generate_private_key(ec.SECP256R1())
        token = self._jwt_token(private_key, app_metadata={"disabled": True})

        with patch("app.core.auth._get_jwks_signing_key", return_value=private_key.public_key()):
            with self.assertRaises(HTTPException) as raised:
                require_user(f"Bearer {token}")

        self.assertEqual(raised.exception.status_code, 401)

    def test_concurrent_same_token_require_user_calls_singleflight_local_verify(self):
        calls = 0
        calls_lock = threading.Lock()

        def verify_locally(_token):
            nonlocal calls
            with calls_lock:
                calls += 1
            time.sleep(0.05)
            return {
                "sub": "user-jwt-1",
                "email": "jwt@example.com",
                "aud": "authenticated",
                "iss": "https://example.supabase.co/auth/v1",
                "exp": int(time.time()) + 300,
                "app_metadata": {},
                "user_metadata": {},
            }

        with (
            patch("app.core.auth._verify_jwt_locally", side_effect=verify_locally),
            patch("app.core.auth.get_supabase_user_client") as get_client,
            ThreadPoolExecutor(max_workers=8) as executor,
        ):
            users = list(executor.map(lambda _: require_user("Bearer same-token"), range(8)))

        self.assertEqual({user.id for user in users}, {"user-jwt-1"})
        self.assertEqual(calls, 1)
        get_client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
