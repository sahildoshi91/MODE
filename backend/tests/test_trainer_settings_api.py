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
    ASSISTANT_NAME_MAX_LENGTH = 30

    def __init__(self):
        self.default_meeting_location = "My Gym"
        self.auto_fill_meeting_location = True
        self.assistant_display_name = None

    def get_settings(self, trainer_context):
        del trainer_context
        return {
            "trainer_id": "trainer-123",
            "default_meeting_location": self.default_meeting_location,
            "auto_fill_meeting_location": self.auto_fill_meeting_location,
            "assistant_display_name": self.assistant_display_name,
        }

    def patch_settings(self, trainer_context, request):
        del trainer_context
        provided_fields = set(getattr(request, "model_fields_set", set()))
        if "default_meeting_location" in provided_fields:
            self.default_meeting_location = request.default_meeting_location
        if "auto_fill_meeting_location" in provided_fields:
            self.auto_fill_meeting_location = bool(request.auto_fill_meeting_location)
        if "assistant_display_name" in provided_fields:
            if request.assistant_display_name is None:
                self.assistant_display_name = None
            else:
                normalized = str(request.assistant_display_name).strip()
                if not normalized:
                    self.assistant_display_name = None
                elif len(normalized) > self.ASSISTANT_NAME_MAX_LENGTH:
                    raise ValueError("Assistant display name must be 30 characters or fewer")
                else:
                    self.assistant_display_name = normalized
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
        self.assertIsNone(get_response.json()["assistant_display_name"])

        patch_response = self.client.patch(
            "/api/v1/trainer-settings/me",
            json={
                "default_meeting_location": "Downtown HQ",
                "auto_fill_meeting_location": False,
                "assistant_display_name": "  Atlas  ",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.json()["default_meeting_location"], "Downtown HQ")
        self.assertFalse(patch_response.json()["auto_fill_meeting_location"])
        self.assertEqual(patch_response.json()["assistant_display_name"], "Atlas")

    def test_trainer_settings_patch_clears_blank_assistant_display_name_to_null(self):
        response = self.client.patch(
            "/api/v1/trainer-settings/me",
            json={
                "assistant_display_name": "   ",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["assistant_display_name"])

    def test_trainer_settings_patch_rejects_long_assistant_display_name(self):
        response = self.client.patch(
            "/api/v1/trainer-settings/me",
            json={
                "assistant_display_name": "x" * 31,
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("30 characters or fewer", response.json()["detail"])

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
