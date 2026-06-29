import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

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


if __name__ == "__main__":
    unittest.main()
