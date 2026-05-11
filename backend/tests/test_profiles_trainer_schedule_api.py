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
from app.core.dependencies import get_trainer_client_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app


class FakeTrainerClientService:
    def get_client_visible_schedule(self, trainer_context):
        if not trainer_context.client_id:
            raise ValueError("No client context found")
        return {
            "client_id": trainer_context.client_id,
            "trainer_id": trainer_context.trainer_id,
            "trainer_display_name": trainer_context.trainer_display_name,
            "recurring_weekdays": [1, 3, 5],
            "upcoming_exceptions": [
                {
                    "id": "ex-1",
                    "trainer_id": trainer_context.trainer_id,
                    "client_id": trainer_context.client_id,
                    "session_date": "2026-04-20",
                    "exception_type": "skip",
                    "meeting_location_override": None,
                }
            ],
            "resolved_default_meeting_location": "My Gym",
        }


class ProfilesTrainerScheduleApiTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="client-user-1",
            email="client@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id="client-1",
            client_user_id="client-user-1",
        )
        app.dependency_overrides[get_trainer_client_service] = lambda: FakeTrainerClientService()
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_get_my_trainer_schedule_returns_read_only_payload(self):
        response = self.client.get(
            "/api/v1/profiles/me/trainer-schedule",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["client_id"], "client-1")
        self.assertEqual(payload["trainer_id"], "trainer-123")
        self.assertEqual(payload["recurring_weekdays"], [1, 3, 5])
        self.assertEqual(payload["resolved_default_meeting_location"], "My Gym")
        self.assertEqual(payload["upcoming_exceptions"][0]["exception_type"], "skip")


if __name__ == "__main__":
    unittest.main()
