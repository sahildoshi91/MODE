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
from app.core.dependencies import get_trainer_context, get_trainer_home_service
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.trainer_home.service import TrainerHomeService


class FakeTrainerHomeRepository:
    def list_schedule_for_day(self, trainer_id, session_date):
        del trainer_id, session_date
        return [
            {
                "id": "schedule-1",
                "trainer_id": "trainer-1",
                "client_id": "client-1",
                "session_date": "2026-04-10",
                "session_start_at": "2026-04-10T17:00:00+00:00",
                "session_end_at": "2026-04-10T18:00:00+00:00",
                "session_type": "strength",
                "notes": "Focus on lower body mechanics",
                "status": "scheduled",
            },
            {
                "id": "schedule-2",
                "trainer_id": "trainer-1",
                "client_id": "client-2",
                "session_date": "2026-04-10",
                "session_start_at": "2026-04-10T19:00:00+00:00",
                "session_end_at": "2026-04-10T19:45:00+00:00",
                "session_type": "conditioning",
                "notes": "",
                "status": "no_show",
            },
        ]

    def list_clients_for_trainer(self, trainer_id):
        del trainer_id
        return [
            {"id": "client-1", "user_id": "client-user-1", "client_name": "Taylor", "assigned_trainer_id": "trainer-1"},
            {"id": "client-2", "user_id": "client-user-2", "client_name": "Jordan", "assigned_trainer_id": "trainer-1"},
        ]

    def list_checkins_between(self, start_date, end_date):
        del start_date, end_date
        return [
            {"client_id": "client-1", "date": "2026-04-10", "total_score": 18, "assigned_mode": "BUILD"},
            {"client_id": "client-1", "date": "2026-04-09", "total_score": 17, "assigned_mode": "BUILD"},
            {"client_id": "client-1", "date": "2026-04-08", "total_score": 19, "assigned_mode": "BUILD"},
            {"client_id": "client-2", "date": "2026-04-09", "total_score": 12, "assigned_mode": "RECOVER"},
        ]

    def list_completed_workouts_between(self, start_time, end_time):
        del start_time, end_time
        return [
            {"id": "w-1", "user_id": "client-user-1", "completed": True, "created_at": "2026-04-09T11:00:00+00:00"},
            {"id": "w-2", "user_id": "client-user-1", "completed": True, "created_at": "2026-04-08T11:00:00+00:00"},
            {"id": "w-3", "user_id": "client-user-2", "completed": True, "created_at": "2026-04-08T13:00:00+00:00"},
        ]


class TrainerHomeApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def _override_common_auth(self, user_id="trainer-user-1"):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id=user_id,
            email="trainer@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_home_service] = lambda: TrainerHomeService(FakeTrainerHomeRepository())

    def test_today_requires_trainer_actor(self):
        self._override_common_auth(user_id="client-user-1")
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-1",
            client_user_id="client-user-1",
        )

        response = self.client.get(
            "/api/v1/trainer-home/today?date=2026-04-10",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Trainer-only endpoint")

    def test_today_returns_aggregated_schedule_week_summary_and_talking_points(self):
        self._override_common_auth(user_id="trainer-user-1")
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id=None,
            trainer_onboarding_completed=True,
        )

        response = self.client.get(
            "/api/v1/trainer-home/today?date=2026-04-10",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["date"], "2026-04-10")
        self.assertEqual(payload["trainer"]["trainer_id"], "trainer-1")
        self.assertTrue(payload["trainer"]["trainer_onboarding_completed"])
        self.assertEqual(payload["totals"]["scheduled_clients"], 2)
        self.assertEqual(payload["totals"]["checkins_completed_today"], 1)
        self.assertEqual(payload["totals"]["workouts_completed_7d"], 3)
        self.assertEqual(len(payload["clients"]), 2)

        taylor = next(item for item in payload["clients"] if item["client_id"] == "client-1")
        jordan = next(item for item in payload["clients"] if item["client_id"] == "client-2")
        self.assertEqual(taylor["week_summary"]["checkins_completed_7d"], 3)
        self.assertEqual(taylor["week_summary"]["avg_mode_7d"], "BUILD")
        self.assertEqual(taylor["week_summary"]["workouts_completed_7d"], 2)
        self.assertEqual(jordan["week_summary"]["checkins_completed_7d"], 1)
        self.assertEqual(jordan["week_summary"]["workouts_completed_7d"], 1)
        self.assertLessEqual(len(jordan["talking_points"]), 3)
        self.assertTrue(
            any("No check-in logged today" in point for point in jordan["talking_points"]),
            msg=f"Unexpected talking points: {jordan['talking_points']}",
        )


if __name__ == "__main__":
    unittest.main()
