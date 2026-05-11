import hashlib
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.auth import AuthenticatedUser
from app.modules.onboarding.service import OnboardingService, OnboardingServiceError


def _hash_invite(code: str) -> str:
    return hashlib.sha256(code.strip().lower().encode("utf-8")).hexdigest()


class FakeOnboardingRepository:
    def __init__(self):
        self.valid_code = "MODE1234"
        self.invite_codes_by_hash = {
            _hash_invite(self.valid_code): {
                "id": "invite-1",
                "trainer_id": "trainer-1",
                "tenant_id": "tenant-1",
                "is_active": True,
                "expires_at": None,
                "used_at": None,
                "used_by_user_id": None,
                "revoked_at": None,
            },
        }
        self.trainers = {
            "trainer-1": {
                "id": "trainer-1",
                "tenant_id": "tenant-1",
                "display_name": "Coach Maya",
                "is_active": True,
            },
        }
        self.user_accounts = {}
        self.user_roles = {}
        self.clients_by_user = {}
        self.assignment_history = []
        self.onboarding_state_by_account = {}
        self.deactivation_calls = []

    def hash_invite_code(self, code: str) -> str:
        return _hash_invite(code)

    def get_invite_code(self, *, code_hash: str):
        row = self.invite_codes_by_hash.get(str(code_hash or "").strip().lower())
        return dict(row) if row else None

    def deactivate_invite_code(self, *, invite_id, trainer_id, tenant_id, used_by_user_id=None):
        for invite_hash, row in self.invite_codes_by_hash.items():
            if (
                row.get("id") == invite_id
                and row.get("trainer_id") == trainer_id
                and row.get("tenant_id") == tenant_id
                and bool(row.get("is_active")) is True
                and row.get("used_at") is None
                and row.get("revoked_at") is None
            ):
                now = datetime.now(timezone.utc).isoformat()
                row["is_active"] = False
                row["used_at"] = now
                row["used_by_user_id"] = used_by_user_id
                self.invite_codes_by_hash[invite_hash] = row
                self.deactivation_calls.append(invite_id)
                return dict(row)
        return None

    def get_trainer_by_id(self, *, trainer_id):
        return self.trainers.get(trainer_id)

    def ensure_user_account(self, *, user_id, email):
        existing = self.user_accounts.get(user_id)
        if existing:
            return existing
        created = {
            "id": f"account-{user_id}",
            "auth_user_id": user_id,
            "email": email,
        }
        self.user_accounts[user_id] = created
        return created

    def get_user_role(self, *, user_account_id):
        return self.user_roles.get(user_account_id)

    def list_clients_for_user(self, *, user_id):
        return [dict(row) for row in self.clients_by_user.get(user_id, [])]

    def get_client_for_user_and_tenant(self, *, user_id, tenant_id):
        for row in self.clients_by_user.get(user_id, []):
            if row.get("tenant_id") == tenant_id:
                return dict(row)
        return None

    def create_client(self, *, tenant_id, user_id):
        created = {
            "id": f"client-{len(self.clients_by_user.get(user_id, [])) + 1}",
            "tenant_id": tenant_id,
            "user_id": user_id,
            "assigned_trainer_id": None,
        }
        self.clients_by_user.setdefault(user_id, []).append(created)
        return dict(created)

    def update_client(self, *, client_id, fields):
        for user_clients in self.clients_by_user.values():
            for row in user_clients:
                if row.get("id") == client_id:
                    row.update(fields)
                    return dict(row)
        raise AssertionError("Unexpected client update")

    def insert_assignment_history(self, *, client_id, trainer_id):
        self.assignment_history.append({
            "client_id": client_id,
            "trainer_id": trainer_id,
        })

    def ensure_client_profile(self, *, client_id):
        del client_id
        return None

    def get_tenant_slug(self, *, tenant_id):
        del tenant_id
        return None

    def copy_profile_to_client_if_missing(self, *, source_client_id, target_client_id):
        del source_client_id, target_client_id
        return None

    def get_onboarding_state(self, *, user_account_id):
        return self.onboarding_state_by_account.get(user_account_id)

    def upsert_onboarding_state(
        self,
        *,
        user_account_id,
        flow_key,
        status,
        current_step,
        payload,
        completed_at,
    ):
        state = {
            "id": f"state-{user_account_id}",
            "flow_key": flow_key,
            "status": status,
            "current_step": current_step,
            "payload": payload,
            "completed_at": completed_at,
        }
        self.onboarding_state_by_account[user_account_id] = state
        return state


class OnboardingAssignByInviteServiceTests(unittest.TestCase):
    def setUp(self):
        self.repository = FakeOnboardingRepository()
        self.service = OnboardingService(self.repository)
        self.user = AuthenticatedUser(
            id="user-123",
            email="client@example.com",
            access_token="token-123",
        )

        # Keep tests focused on invite attach behavior.
        self.service.get_bootstrap = lambda _user: {
            "assigned_trainer_id": "trainer-1",
            "needs_assignment": False,
        }

    def test_assign_by_invite_consumes_code_after_successful_attach(self):
        response = self.service.assign_by_invite(user=self.user, invite_code="mode1234")

        self.assertEqual(response["assigned_trainer_id"], "trainer-1")
        row = self.repository.invite_codes_by_hash[_hash_invite("MODE1234")]
        self.assertFalse(row["is_active"])
        self.assertIsNotNone(row["used_at"])
        self.assertEqual(row["used_by_user_id"], "user-123")
        self.assertEqual(self.repository.deactivation_calls, ["invite-1"])
        self.assertNotIn("invite_code", response)
        self.assertNotIn("trainer_id", response)

    def test_assign_by_invite_rejects_second_use_after_code_was_consumed(self):
        self.service.assign_by_invite(user=self.user, invite_code="MODE1234")

        with self.assertRaises(OnboardingServiceError) as raised:
            self.service.assign_by_invite(user=self.user, invite_code="MODE1234")

        self.assertEqual(str(raised.exception), "Invite code is inactive")
        self.assertEqual(raised.exception.status_code, 409)

    def test_assign_by_invite_rejects_when_atomic_consume_fails(self):
        class NonAtomicDeactivationRepository(FakeOnboardingRepository):
            def deactivate_invite_code(self, *, invite_id, trainer_id, tenant_id, used_by_user_id=None):
                del invite_id, trainer_id, tenant_id, used_by_user_id
                return None

        service = OnboardingService(NonAtomicDeactivationRepository())
        service.get_bootstrap = self.service.get_bootstrap

        with self.assertRaises(OnboardingServiceError) as raised:
            service.assign_by_invite(user=self.user, invite_code="MODE1234")

        self.assertEqual(str(raised.exception), "Invite code is inactive")
        self.assertEqual(raised.exception.status_code, 409)

    def test_assign_by_invite_rejects_expired_code(self):
        row = self.repository.invite_codes_by_hash[_hash_invite("MODE1234")]
        row["expires_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()

        with self.assertRaises(OnboardingServiceError) as raised:
            self.service.assign_by_invite(user=self.user, invite_code="MODE1234")

        self.assertEqual(str(raised.exception), "Invite code has expired")
        self.assertEqual(raised.exception.status_code, 409)

    def test_assign_by_invite_rejects_revoked_code(self):
        row = self.repository.invite_codes_by_hash[_hash_invite("MODE1234")]
        row["revoked_at"] = datetime.now(timezone.utc).isoformat()

        with self.assertRaises(OnboardingServiceError) as raised:
            self.service.assign_by_invite(user=self.user, invite_code="MODE1234")

        self.assertEqual(str(raised.exception), "Invite code is inactive")
        self.assertEqual(raised.exception.status_code, 409)

    def test_assign_by_invite_rejects_previously_used_code(self):
        row = self.repository.invite_codes_by_hash[_hash_invite("MODE1234")]
        row["used_at"] = datetime.now(timezone.utc).isoformat()
        row["is_active"] = False

        with self.assertRaises(OnboardingServiceError) as raised:
            self.service.assign_by_invite(user=self.user, invite_code="MODE1234")

        self.assertEqual(str(raised.exception), "Invite code is inactive")
        self.assertEqual(raised.exception.status_code, 409)

    def test_assign_by_invite_rejects_malformed_code_safely(self):
        with self.assertRaises(OnboardingServiceError) as raised:
            self.service.assign_by_invite(user=self.user, invite_code="DROP TABLE")

        self.assertEqual(str(raised.exception), "Invite code is invalid")
        self.assertEqual(raised.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
