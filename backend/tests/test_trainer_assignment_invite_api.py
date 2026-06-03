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
from app.core.dependencies import get_internal_onboarding_service, get_request_scoped_supabase_client, get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.onboarding.service import OnboardingServiceError


class FakeOnboardingService:
    def __init__(self):
        self.last_invite_code = None
        self._last_assignment_mutation_rows = [
            {
                "client_id": "client-123",
                "trainer_id": "trainer-1",
                "event_type": "assigned_by_invite",
                "target_client_id": "client-123",
                "target_trainer_id": "trainer-1",
            }
        ]

    def assign_by_invite(self, *, user, invite_code):
        self.last_invite_code = {
            "user_id": user.id,
            "invite_code": invite_code,
        }


class FailingOnboardingService(FakeOnboardingService):
    def assign_by_invite(self, *, user, invite_code):
        raise OnboardingServiceError("Invite code is invalid", status_code=404)


class MatrixFailingOnboardingService(FakeOnboardingService):
    def __init__(self, failure_reason: str, status_code: int):
        super().__init__()
        self.failure_reason = failure_reason
        self.status_code = status_code

    def assign_by_invite(self, *, user, invite_code):
        del user, invite_code
        raise OnboardingServiceError(self.failure_reason, status_code=self.status_code)


class DetachOnboardingService(FakeOnboardingService):
    def __init__(self):
        super().__init__()
        self.detached_user_id = None

    def self_detach_current_assignment(self, *, user):
        self.detached_user_id = user.id
        return [
            {
                "client_id": "client-123",
                "trainer_id": "trainer-1",
                "event_type": "client_self_detach",
                "previous_trainer_id": "trainer-1",
            }
        ]


class TrainerAssignmentInviteApiTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="user-123",
            email="user@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id=None,
            trainer_user_id=None,
            trainer_display_name=None,
            client_id="client-123",
        )
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_assign_by_invite_returns_updated_assignment_status(self):
        fake_service = FakeOnboardingService()
        app.dependency_overrides[get_internal_onboarding_service] = lambda: fake_service

        resolved_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-123",
        )

        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: object()
        with patch("app.api.v1.trainer_assignment.resolve_trainer_context", return_value=resolved_context):
            response = self.client.post(
                "/api/v1/trainer-assignment/assign-by-invite",
                json={"invite_code": "MAYA2026"},
                headers={"Authorization": "Bearer ignored"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["assigned_trainer_id"], "trainer-1")
        self.assertFalse(response.json()["needs_assignment"])
        self.assertEqual(fake_service.last_invite_code["invite_code"], "MAYA2026")
        self.assertNotIn("invite_code", response.json())
        self.assertNotIn("invite_id", response.json())
        self.assertNotIn("tenant_id", response.json())
        self.assertNotIn("used_by_user_id", response.json())

    def test_assign_by_invite_maps_service_error(self):
        app.dependency_overrides[get_internal_onboarding_service] = lambda: FailingOnboardingService()
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: object()

        with patch("app.api.v1.trainer_assignment.resolve_trainer_context", return_value=TrainerContext(None, None, None, None, None)):
            response = self.client.post(
                "/api/v1/trainer-assignment/assign-by-invite",
                json={"invite_code": "BAD"},
                headers={"Authorization": "Bearer ignored"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Unable to attach trainer with invite code")

    def test_delete_current_self_detaches_and_returns_updated_assignment_status(self):
        fake_service = DetachOnboardingService()
        app.dependency_overrides[get_internal_onboarding_service] = lambda: fake_service
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-123",
        )
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: object()

        resolved_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id=None,
            trainer_user_id=None,
            trainer_display_name=None,
            client_id="client-123",
        )

        with (
            patch("app.api.v1.trainer_assignment.resolve_trainer_context", return_value=resolved_context),
            patch("app.api.v1.trainer_assignment.invalidate_chat_context") as invalidate_chat_context,
        ):
            response = self.client.delete(
                "/api/v1/trainer-assignment/current",
                headers={"Authorization": "Bearer ignored"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["needs_assignment"])
        self.assertIsNone(response.json()["assigned_trainer_id"])
        self.assertEqual(fake_service.detached_user_id, "user-123")
        invalidate_chat_context.assert_called_with(
            "trainer-1",
            "client-123",
            reason="client_self_detach",
        )

    def test_assign_by_invite_returns_generic_failures_for_expired_revoked_used_and_malformed_codes(self):
        failure_modes = [
            ("Invite code has expired", 409, "MODEEXPIRED"),
            ("Invite code is inactive", 409, "MODEREVOKED"),
            ("Invite code is inactive", 409, "MODEUSED"),
            ("Invite code is invalid", 404, "DROP TABLE"),
        ]
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id=None,
            trainer_user_id=None,
            trainer_display_name=None,
            client_id="client-123",
        )

        for reason, status_code, code in failure_modes:
            with self.subTest(reason=reason, status_code=status_code, code=code):
                app.dependency_overrides[get_internal_onboarding_service] = (
                    lambda reason=reason, status_code=status_code: MatrixFailingOnboardingService(
                        reason,
                        status_code,
                    )
                )
                app.dependency_overrides[get_request_scoped_supabase_client] = lambda: object()
                with patch("app.api.v1.trainer_assignment.resolve_trainer_context", return_value=TrainerContext(None, None, None, None, None)):
                    response = self.client.post(
                        "/api/v1/trainer-assignment/assign-by-invite",
                        json={"invite_code": code},
                        headers={"Authorization": "Bearer ignored"},
                    )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["detail"], "Unable to attach trainer with invite code")


if __name__ == "__main__":
    unittest.main()
