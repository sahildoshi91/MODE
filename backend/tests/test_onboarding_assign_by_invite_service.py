import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.auth import AuthenticatedUser
from app.modules.onboarding.service import OnboardingService, OnboardingServiceError


class FakeOnboardingRepository:
    def __init__(self):
        self.invite_codes = {
            "mode1234": {
                "id": "invite-1",
                "code": "MODE1234",
                "trainer_id": "trainer-1",
                "tenant_id": "tenant-1",
                "is_active": True,
                "expires_at": None,
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

    def get_invite_code(self, *, code):
        return self.invite_codes.get(code.strip().lower())

    def deactivate_invite_code(self, *, invite_id, trainer_id, tenant_id):
        for row in self.invite_codes.values():
            if (
                row.get("id") == invite_id
                and row.get("trainer_id") == trainer_id
                and row.get("tenant_id") == tenant_id
            ):
                row["is_active"] = False
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

        # Keep tests focused on invite-attach behavior.
        self.service.get_bootstrap = lambda _user: {
            "assigned_trainer_id": "trainer-1",
            "needs_assignment": False,
        }

    def test_assign_by_invite_consumes_code_after_successful_attach(self):
        response = self.service.assign_by_invite(user=self.user, invite_code="MODE1234")

        self.assertEqual(response["assigned_trainer_id"], "trainer-1")
        self.assertFalse(self.repository.invite_codes["mode1234"]["is_active"])
        self.assertEqual(self.repository.deactivation_calls, ["invite-1"])

    def test_assign_by_invite_rejects_second_use_after_code_was_consumed(self):
        self.service.assign_by_invite(user=self.user, invite_code="MODE1234")

        with self.assertRaises(OnboardingServiceError) as raised:
            self.service.assign_by_invite(user=self.user, invite_code="MODE1234")

        self.assertEqual(str(raised.exception), "Invite code is inactive")
        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
