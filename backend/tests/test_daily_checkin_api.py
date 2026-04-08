import os
import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_daily_checkin_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.daily_checkins.schemas import DailyCheckinInputs, DailyCheckinResult, DailyCheckinStatusResponse
from app.modules.daily_checkins.service import DailyCheckinService


class FakeDailyCheckinService:
    def __init__(self):
        self.last_submit = None

    def get_status(self, client_id: str, checkin_date: date) -> DailyCheckinStatusResponse:
        if client_id == "client-complete":
            return DailyCheckinStatusResponse(
                date=checkin_date,
                completed=True,
                checkin=DailyCheckinResult(
                    id="checkin-1",
                    date=checkin_date,
                    score=18,
                    mode="BUILD",
                    inputs=DailyCheckinInputs(
                        sleep=4,
                        stress=2,
                        soreness=3,
                        nutrition=4,
                        motivation=5,
                    ),
                    training={
                        "type": "Moderate cardio or controlled strength",
                        "duration": "30-45 min",
                        "intensity": "Moderate",
                    },
                    nutrition={"rule": "Keep meals balanced and steady all day."},
                    mindset={"cue": "Build momentum with disciplined reps."},
                    time_to_complete=11,
                    completion_timestamp=datetime(2026, 3, 27, 16, 0, tzinfo=timezone.utc),
                ),
            )
        return DailyCheckinStatusResponse(date=checkin_date, completed=False)

    def submit_checkin(self, client_id: str, checkin_date: date, inputs: DailyCheckinInputs, time_to_complete=None):
        self.last_submit = {
            "client_id": client_id,
            "date": checkin_date,
            "inputs": inputs.model_dump(),
            "time_to_complete": time_to_complete,
        }
        return DailyCheckinResult(
            id="checkin-new",
            date=checkin_date,
            score=22,
            mode="BEAST",
            inputs=inputs,
            training={
                "type": "Strength or HIIT",
                "duration": "45-60 min",
                "intensity": "High",
            },
            nutrition={"rule": "Fuel hard with protein and performance carbs."},
            mindset={"cue": "Attack the day. You are cleared to push."},
            time_to_complete=time_to_complete,
            completion_timestamp=datetime(2026, 3, 27, 16, 0, tzinfo=timezone.utc),
        )


class DailyCheckinServiceTests(unittest.TestCase):
    def test_mode_boundaries_are_deterministic(self):
        service = DailyCheckinService(repository=None)

        self.assertEqual(
            service._assign_mode(service._calculate_total_score(DailyCheckinInputs(sleep=5, stress=5, soreness=5, nutrition=5, motivation=5))),
            "BEAST",
        )
        self.assertEqual(
            service._assign_mode(service._calculate_total_score(DailyCheckinInputs(sleep=4, stress=4, soreness=3, nutrition=3, motivation=2))),
            "BUILD",
        )
        self.assertEqual(
            service._assign_mode(service._calculate_total_score(DailyCheckinInputs(sleep=3, stress=2, soreness=2, nutrition=2, motivation=2))),
            "RECOVER",
        )
        self.assertEqual(
            service._assign_mode(service._calculate_total_score(DailyCheckinInputs(sleep=1, stress=1, soreness=1, nutrition=1, motivation=1))),
            "REST",
        )


class DailyCheckinApiTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="user-123",
            email="user@example.com",
            access_token="token-123",
        )
        self.fake_service = FakeDailyCheckinService()
        app.dependency_overrides[get_daily_checkin_service] = lambda: self.fake_service
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_today_returns_pending_state_when_no_checkin_exists(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-pending",
        )

        response = self.client.get(
            "/api/v1/checkin/today",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["completed"])
        self.assertIsNone(response.json()["checkin"])

    def test_submit_returns_daily_bundle_and_passes_client_context(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-submit",
        )

        response = self.client.post(
            "/api/v1/checkin",
            json={
                "date": "2026-03-27",
                "inputs": {
                    "sleep": 5,
                    "stress": 4,
                    "soreness": 4,
                    "nutrition": 4,
                    "motivation": 5,
                },
                "time_to_complete": 9,
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "BEAST")
        self.assertEqual(response.json()["score"], 22)
        self.assertEqual(self.fake_service.last_submit["client_id"], "client-submit")
        self.assertEqual(self.fake_service.last_submit["time_to_complete"], 9)

    def test_checkin_rejects_missing_client_context(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id=None,
        )

        response = self.client.get(
            "/api/v1/checkin/today",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "No client assignment found")


if __name__ == "__main__":
    unittest.main()
