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
from app.core.dependencies import get_trainer_context, get_trainer_persona_service
from app.core.tenancy import TrainerContext
from app.main import app


class FakeTrainerPersonaService:
    def __init__(self):
        self.list_calls = 0
        self.create_calls = 0

    def list_personas(self, trainer_id):
        del trainer_id
        self.list_calls += 1
        return []

    def create_persona(self, trainer_id, request):
        del trainer_id, request
        self.create_calls += 1
        return {}


class TrainerPersonasApiTests(unittest.TestCase):
    def setUp(self):
        self.fake_service = FakeTrainerPersonaService()
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="client-user-123",
            email="client@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id="client-123",
            client_user_id="client-user-123",
        )
        app.dependency_overrides[get_trainer_persona_service] = lambda: self.fake_service
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_non_trainer_actor_is_denied_for_list_and_create(self):
        list_response = self.client.get(
            "/api/v1/trainer-personas",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(list_response.status_code, 403)
        self.assertEqual(list_response.json()["detail"], "Trainer-only endpoint")

        create_response = self.client.post(
            "/api/v1/trainer-personas",
            json={
                "trainer_id": "trainer-123",
                "persona_name": "Strength Coach",
                "tone_description": "Clear and supportive",
                "coaching_philosophy": "Progress over perfection.",
                "communication_rules": {},
                "onboarding_preferences": {},
                "fallback_behavior": {},
                "is_default": True,
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(create_response.status_code, 403)
        self.assertEqual(create_response.json()["detail"], "Trainer-only endpoint")

        self.assertEqual(self.fake_service.list_calls, 0)
        self.assertEqual(self.fake_service.create_calls, 0)


if __name__ == "__main__":
    unittest.main()
