import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, call

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_trainer_client_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.trainer_clients.repository import TrainerClientRepository
from app.modules.trainer_clients.schemas import TrainerClientInviteCodeListResponse


def _make_trainer_service_stub():
    svc = MagicMock()
    svc.list_invite_codes.return_value = TrainerClientInviteCodeListResponse(
        items=[], count=0, limit=50, offset=0
    )
    return svc


class InviteCodeSecurityApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_anonymous_invite_code_enumeration_is_denied(self):
        response = self.client.get("/api/v1/trainer-clients/invite-codes")
        self.assertEqual(response.status_code, 401)

    def test_client_invite_code_enumeration_is_denied(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="client-user-1",
            email="client@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-owner-1",
            trainer_display_name="Coach Maya",
            client_id="client-1",
            client_user_id="client-user-1",
        )

        response = self.client.get(
            "/api/v1/trainer-clients/invite-codes",
            headers={"Authorization": "Bearer ignored"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Trainer-only endpoint")

    def test_trainer_can_list_own_invite_codes(self):
        """Trainer owner sees an empty list via the real (stubbed) service."""
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="trainer-owner-1",
            email="trainer@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-owner-1",
            trainer_display_name="Coach Maya",
            client_id=None,
            client_user_id=None,
        )
        app.dependency_overrides[get_trainer_client_service] = _make_trainer_service_stub

        response = self.client.get(
            "/api/v1/trainer-clients/invite-codes",
            headers={"Authorization": "Bearer ignored"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("items", body)
        self.assertEqual(body["items"], [])

    def test_trainer_cannot_list_another_trainers_invites(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="trainer-owner-2",
            email="trainer2@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-owner-1",
            trainer_display_name="Coach Maya",
            client_id=None,
            client_user_id=None,
        )

        response = self.client.get(
            "/api/v1/trainer-clients/invite-codes",
            headers={"Authorization": "Bearer ignored"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Trainer-only endpoint")


class TrainerClientRepositoryClientRoutingTests(unittest.TestCase):
    """Verify invite-code methods use the admin (service-role) client, not the user client."""

    def _make_client_mock(self):
        m = MagicMock()
        result = MagicMock()
        result.data = []
        result.count = 0
        # Make the entire query-builder chain return m so any sequence of
        # .table().select().eq()... resolves without TypeError.
        m.table.return_value = m
        m.select.return_value = m
        m.eq.return_value = m
        m.not_ = m          # attribute access, not a call
        m.is_.return_value = m
        m.order.return_value = m
        m.range.return_value = m
        m.limit.return_value = m
        m.update.return_value = m
        m.insert.return_value = m
        m.in_.return_value = m
        m.ilike.return_value = m
        m.or_.return_value = m
        m.execute.return_value = result
        return m

    def test_list_invite_codes_uses_admin_client(self):
        user_client = self._make_client_mock()
        admin_client = self._make_client_mock()
        repo = TrainerClientRepository(user_client, admin_supabase=admin_client)

        repo.list_invite_codes_for_trainer("trainer-1", "tenant-1")

        admin_client.table.assert_called_with("trainer_invite_codes")
        self.assertNotIn(call("trainer_invite_codes"), user_client.table.call_args_list)

    def test_get_invite_code_for_trainer_uses_admin_client(self):
        user_client = self._make_client_mock()
        admin_client = self._make_client_mock()
        repo = TrainerClientRepository(user_client, admin_supabase=admin_client)

        repo.get_invite_code_for_trainer("trainer-1", "tenant-1", "invite-1")

        admin_client.table.assert_called_with("trainer_invite_codes")
        self.assertNotIn(call("trainer_invite_codes"), user_client.table.call_args_list)

    def test_get_invite_code_by_hash_uses_admin_client(self):
        user_client = self._make_client_mock()
        admin_client = self._make_client_mock()
        repo = TrainerClientRepository(user_client, admin_supabase=admin_client)

        repo.get_invite_code_by_hash(code_hash="abc123")

        admin_client.table.assert_called_with("trainer_invite_codes")
        self.assertNotIn(call("trainer_invite_codes"), user_client.table.call_args_list)

    def test_create_invite_code_uses_admin_client(self):
        user_client = self._make_client_mock()
        admin_client = self._make_client_mock()
        repo = TrainerClientRepository(user_client, admin_supabase=admin_client)

        repo.create_invite_code({"trainer_id": "t1", "tenant_id": "tn1", "code_hash": "h"})

        admin_client.table.assert_called_with("trainer_invite_codes")
        self.assertNotIn(call("trainer_invite_codes"), user_client.table.call_args_list)

    def test_revoke_invite_code_uses_admin_client(self):
        user_client = self._make_client_mock()
        admin_client = self._make_client_mock()
        repo = TrainerClientRepository(user_client, admin_supabase=admin_client)

        repo.revoke_invite_code_for_trainer("trainer-1", "tenant-1", "invite-1")

        admin_client.table.assert_called_with("trainer_invite_codes")
        self.assertNotIn(call("trainer_invite_codes"), user_client.table.call_args_list)

    def test_list_clients_uses_user_client_not_admin(self):
        user_client = self._make_client_mock()
        admin_client = self._make_client_mock()
        repo = TrainerClientRepository(user_client, admin_supabase=admin_client)

        repo.list_clients_for_trainer_page("trainer-1", "tenant-1")

        user_client.table.assert_called_with("clients")
        self.assertNotIn(call("clients"), admin_client.table.call_args_list)

    def test_get_client_for_trainer_uses_user_client_not_admin(self):
        user_client = self._make_client_mock()
        admin_client = self._make_client_mock()
        repo = TrainerClientRepository(user_client, admin_supabase=admin_client)

        repo.get_client_for_trainer("trainer-1", "client-1")

        user_client.table.assert_called_with("clients")
        self.assertNotIn(call("clients"), admin_client.table.call_args_list)


if __name__ == "__main__":
    unittest.main()
