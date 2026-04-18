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
from app.core.dependencies import get_trainer_context, get_trainer_settings_service
from app.core.tenancy import TrainerContext
from app.main import app


class FakeTrainerSettingsService:
    def __init__(self):
        self.default_meeting_location = "My Gym"
        self.auto_fill_meeting_location = True

    def get_settings(self, trainer_context):
        del trainer_context
        return {
            "trainer_id": "trainer-123",
            "default_meeting_location": self.default_meeting_location,
            "auto_fill_meeting_location": self.auto_fill_meeting_location,
        }

    def patch_settings(self, trainer_context, request):
        del trainer_context
        provided_fields = set(getattr(request, "model_fields_set", set()))
        if "default_meeting_location" in provided_fields:
            self.default_meeting_location = request.default_meeting_location
        if "auto_fill_meeting_location" in provided_fields:
            self.auto_fill_meeting_location = bool(request.auto_fill_meeting_location)
        return self.get_settings(None)


class TrainerSettingsApiTests(unittest.TestCase):
    def setUp(self):
        self.fake_service = FakeTrainerSettingsService()
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="trainer-user-123",
            email="trainer@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
        )
        app.dependency_overrides[get_trainer_settings_service] = lambda: self.fake_service
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_trainer_settings_get_and_patch(self):
        get_response = self.client.get(
            "/api/v1/trainer-settings/me",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.json()["default_meeting_location"], "My Gym")
        self.assertTrue(get_response.json()["auto_fill_meeting_location"])

        patch_response = self.client.patch(
            "/api/v1/trainer-settings/me",
            json={
                "default_meeting_location": "Downtown HQ",
                "auto_fill_meeting_location": False,
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.json()["default_meeting_location"], "Downtown HQ")
        self.assertFalse(patch_response.json()["auto_fill_meeting_location"])

    def test_trainer_settings_reject_non_trainer_actor(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="not-the-trainer",
            email="trainer@example.com",
            access_token="token-123",
        )
        response = self.client.get(
            "/api/v1/trainer-settings/me",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Trainer-only endpoint")


if __name__ == "__main__":
    unittest.main()

