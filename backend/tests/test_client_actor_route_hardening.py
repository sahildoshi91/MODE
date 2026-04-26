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
from app.core.dependencies import get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app


class ClientActorRouteHardeningTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="attacker-user",
            email="attacker@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-owner-1",
            trainer_display_name="Coach Maya",
            client_id="client-1",
            client_user_id="real-client-user",
        )
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_profiles_me_rejects_non_owner_client_actor(self):
        response = self.client.get(
            "/api/v1/profiles/me",
            headers={"Authorization": "Bearer ignored"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Client-only endpoint")

    def test_plans_active_rejects_non_owner_client_actor(self):
        response = self.client.get(
            "/api/v1/plans/active",
            headers={"Authorization": "Bearer ignored"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Client-only endpoint")

    def test_chat_history_rejects_non_owner_client_actor(self):
        response = self.client.get(
            "/api/v1/chat/history",
            headers={"Authorization": "Bearer ignored"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Client-only endpoint")

    def test_checkin_today_rejects_non_owner_client_actor(self):
        response = self.client.get(
            "/api/v1/checkin/today",
            headers={"Authorization": "Bearer ignored"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json()["detail"],
            "Authenticated user does not own the resolved client record for this check-in",
        )


if __name__ == "__main__":
    unittest.main()
