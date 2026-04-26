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
from app.core.config import settings
from app.core.dependencies import get_mobile_analytics_service, get_onboarding_service
from app.core.rate_limit import _rate_limiter
from app.main import app
from app.modules.onboarding.service import OnboardingServiceError


class FakeOnboardingService:
    def __init__(self):
        self.last_role = None
        self.last_state = None
        self.last_complete = None

    def get_bootstrap(self, _user):
        return {
            "role": None,
            "onboarding_status": "not_started",
            "onboarding_step": None,
            "onboarding_payload": {},
            "onboarding_complete": False,
            "user_account_id": "account-1",
            "client_id": None,
            "has_client_profile": False,
            "trainer_attached": False,
            "assigned_trainer_id": None,
            "assigned_trainer_display_name": None,
            "is_legacy_trainer": False,
            "is_self_guided": False,
        }

    def set_role(self, *, user, request):
        self.last_role = {
            "user_id": user.id,
            "role": request.role,
        }
        if request.role == "trainer":
            raise OnboardingServiceError("trainer disabled", status_code=409)
        return {
            **self.get_bootstrap(user),
            "role": request.role,
            "onboarding_step": "trainer_attach",
        }

    def patch_state(self, *, user, request):
        self.last_state = {
            "user_id": user.id,
            "status": request.status,
            "current_step": request.current_step,
            "payload": request.payload,
        }
        return {
            **self.get_bootstrap(user),
            "role": "client",
            "onboarding_status": request.status or "in_progress",
            "onboarding_step": request.current_step,
            "onboarding_payload": request.payload,
        }

    def complete_onboarding(self, *, user, request):
        self.last_complete = {
            "user_id": user.id,
            "current_step": request.current_step,
            "payload": request.payload,
        }
        return {
            **self.get_bootstrap(user),
            "role": "client",
            "onboarding_status": "completed",
            "onboarding_step": request.current_step,
            "onboarding_payload": request.payload,
            "onboarding_complete": True,
        }


class FakeMobileAnalyticsService:
    def __init__(self):
        self.last_request = None

    def ingest_events(self, *, user, request):
        self.last_request = {
            "user_id": user.id,
            "events": [event.model_dump() for event in request.events],
        }
        return {
            "accepted": len(request.events),
        }


class OnboardingApiTests(unittest.TestCase):
    def setUp(self):
        self.fake_onboarding = FakeOnboardingService()
        self.fake_analytics = FakeMobileAnalyticsService()
        self._original_rate_limit_enabled = settings.rate_limit_enabled
        self._original_rate_limit_window_seconds = settings.rate_limit_window_seconds
        self._original_rate_limit_onboarding_per_window = settings.rate_limit_onboarding_per_window
        settings.rate_limit_enabled = True
        settings.rate_limit_window_seconds = 60
        settings.rate_limit_onboarding_per_window = 20
        _rate_limiter._windows.clear()
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="user-123",
            email="user@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_onboarding_service] = lambda: self.fake_onboarding
        app.dependency_overrides[get_mobile_analytics_service] = lambda: self.fake_analytics
        self.client = TestClient(app)

    def tearDown(self):
        settings.rate_limit_enabled = self._original_rate_limit_enabled
        settings.rate_limit_window_seconds = self._original_rate_limit_window_seconds
        settings.rate_limit_onboarding_per_window = self._original_rate_limit_onboarding_per_window
        _rate_limiter._windows.clear()
        app.dependency_overrides.clear()

    def test_bootstrap_returns_initial_payload(self):
        response = self.client.get("/api/v1/onboarding/bootstrap", headers={"Authorization": "Bearer token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["onboarding_status"], "not_started")
        self.assertIsNone(response.json()["role"])

    def test_role_selection_persists_client_role(self):
        response = self.client.post(
            "/api/v1/onboarding/role",
            json={"role": "client"},
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "client")
        self.assertEqual(self.fake_onboarding.last_role["role"], "client")

    def test_role_selection_maps_service_error(self):
        response = self.client.post(
            "/api/v1/onboarding/role",
            json={"role": "trainer"},
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "trainer disabled")

    def test_role_selection_enforces_rate_limit(self):
        settings.rate_limit_onboarding_per_window = 1

        first = self.client.post(
            "/api/v1/onboarding/role",
            json={"role": "client"},
            headers={"Authorization": "Bearer token"},
        )
        second = self.client.post(
            "/api/v1/onboarding/role",
            json={"role": "client"},
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.json()["detail"]["detail"], "Rate limit exceeded")
        self.assertEqual(second.json()["detail"]["group"], "onboarding")
        self.assertGreaterEqual(second.json()["detail"]["retry_after_seconds"], 1)

    def test_state_patch_updates_resume_payload(self):
        response = self.client.patch(
            "/api/v1/onboarding/state",
            json={
                "status": "in_progress",
                "current_step": "quick_win",
                "payload": {"quick_win_feeling": "okay"},
            },
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["onboarding_step"], "quick_win")
        self.assertEqual(response.json()["onboarding_payload"]["quick_win_feeling"], "okay")

    def test_complete_marks_onboarding_complete(self):
        response = self.client.post(
            "/api/v1/onboarding/complete",
            json={
                "current_step": "system_ready",
                "payload": {"goal": "strength"},
            },
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["onboarding_complete"])
        self.assertEqual(response.json()["onboarding_status"], "completed")

    def test_mobile_analytics_ingest_accepts_batch(self):
        response = self.client.post(
            "/api/v1/analytics/mobile-events",
            json={
                "events": [
                    {"name": "welcome_viewed", "properties": {}},
                    {"name": "auth_started", "properties": {"provider": "google"}},
                ]
            },
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["accepted"], 2)
        self.assertEqual(len(self.fake_analytics.last_request["events"]), 2)


if __name__ == "__main__":
    unittest.main()
