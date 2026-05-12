import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.auth import require_user


class _FakeAuth:
    def __init__(self, user):
        self._user = user

    def get_user(self, _token):
        return SimpleNamespace(user=self._user)


class _FakeSupabase:
    def __init__(self, user):
        self.auth = _FakeAuth(user)


class AuthDisabledUserTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
