import os
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_progress_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.progress.repository import ProgressRepository
from app.modules.progress.schemas import ProgressMetricsResponse
from app.modules.progress.service import ProgressService


def _make_row(d: date, sleep: int, stress: int, soreness: int, nutrition: int, motivation: int) -> dict:
    total = sleep + stress + soreness + nutrition + motivation
    return {
        "date": d.isoformat(),
        "total_score": total,
        "assigned_mode": "BUILD",
        "inputs": {
            "sleep": sleep,
            "stress": stress,
            "soreness": soreness,
            "nutrition": nutrition,
            "motivation": motivation,
        },
    }


def _all_fives_row(d: date) -> dict:
    return _make_row(d, 5, 5, 5, 5, 5)


def _ones_row(d: date) -> dict:
    return _make_row(d, 1, 1, 1, 1, 1)


AS_OF = date(2026, 6, 2)


class FakeProgressRepository:
    def __init__(self, current_rows=None, prior_rows=None, all_dates=None):
        self._current = current_rows or []
        self._prior = prior_rows or []
        self._all_dates = all_dates or []

    def list_checkins_with_inputs(self, client_id: str, start_date: date, end_date: date) -> list[dict]:
        result = []
        for row in self._current + self._prior:
            d = date.fromisoformat(row["date"]) if isinstance(row["date"], str) else row["date"]
            if start_date <= d <= end_date:
                result.append(row)
        return sorted(result, key=lambda r: r["date"])

    def list_all_checkin_dates(self, client_id: str, on_or_before: date) -> list[date]:
        return [d for d in self._all_dates if d <= on_or_before]


def _make_client(user_id="user-1", client_id="client-1", trainer_id=None):
    return AuthenticatedUser(id=user_id, access_token="tok", email="test@example.com")


def _make_trainer_context(client_id="client-1", trainer_id=None):
    return TrainerContext(
        client_id=client_id,
        client_user_id="user-1",
        trainer_id=trainer_id,
        tenant_id="tenant-1",
        role="client",
    )


class TestProgressServiceNoCheckins(unittest.TestCase):
    def setUp(self):
        repo = FakeProgressRepository()
        self.service = ProgressService(repo)

    def test_returns_six_dimensions(self):
        result = self.service.get_metrics("client-1", AS_OF, 7)
        self.assertEqual(set(result.metrics.keys()), {"readiness", "sleep", "recovery", "energy_mood", "stress", "nutrition"})

    def test_sparklines_all_none(self):
        result = self.service.get_metrics("client-1", AS_OF, 7)
        for dim in result.metrics.values():
            self.assertEqual(len(dim.sparkline), 7)
            self.assertTrue(all(v is None for v in dim.sparkline))

    def test_status_is_watch_when_no_data(self):
        result = self.service.get_metrics("client-1", AS_OF, 7)
        for dim in result.metrics.values():
            self.assertEqual(dim.status, "watch")

    def test_no_coach_insights_triggered(self):
        result = self.service.get_metrics("client-1", AS_OF, 7)
        for dim in result.metrics.values():
            self.assertFalse(dim.coach_insight_triggered)
            self.assertIsNone(dim.coach_insight_reason)

    def test_streak_block_all_zeros(self):
        result = self.service.get_metrics("client-1", AS_OF, 7)
        self.assertEqual(result.streak.current_weeks, 0)
        self.assertEqual(result.streak.days_this_week, 0)
        self.assertEqual(result.streak.personal_best_weeks, 0)
        self.assertEqual(result.streak.days_target, 7)
        self.assertEqual(result.streak.milestone_next, 2)


class TestProgressServiceAllFives(unittest.TestCase):
    def setUp(self):
        rows = [_all_fives_row(AS_OF - timedelta(days=i)) for i in range(7)]
        all_dates = [AS_OF - timedelta(days=i) for i in range(7)]
        repo = FakeProgressRepository(current_rows=rows, all_dates=all_dates)
        self.service = ProgressService(repo)

    def test_status_all_good(self):
        result = self.service.get_metrics("client-1", AS_OF, 7)
        for key, dim in result.metrics.items():
            if key == "readiness":
                self.assertEqual(dim.status, "good", f"readiness status should be good, got {dim.status}")
            else:
                self.assertEqual(dim.status, "good", f"{key} status should be good, got {dim.status}")

    def test_sparklines_length_seven(self):
        result = self.service.get_metrics("client-1", AS_OF, 7)
        for dim in result.metrics.values():
            self.assertEqual(len(dim.sparkline), 7)

    def test_surface_values_not_empty(self):
        result = self.service.get_metrics("client-1", AS_OF, 7)
        for dim in result.metrics.values():
            self.assertNotEqual(dim.surface_value, "—")

    def test_readiness_surface_value_format(self):
        result = self.service.get_metrics("client-1", AS_OF, 7)
        readiness = result.metrics["readiness"]
        self.assertIn("/25", readiness.surface_value)

    def test_stress_dimension_key_present(self):
        result = self.service.get_metrics("client-1", AS_OF, 7)
        self.assertIn("stress", result.metrics)
        stress = result.metrics["stress"]
        self.assertIsNotNone(stress.surface_value_raw)

    def test_no_coach_insights_when_all_good(self):
        result = self.service.get_metrics("client-1", AS_OF, 7)
        for dim in result.metrics.values():
            self.assertFalse(dim.coach_insight_triggered)


class TestProgressServicePartialData(unittest.TestCase):
    def test_three_checkins_sparkline_partial(self):
        rows = [_all_fives_row(AS_OF - timedelta(days=i)) for i in range(3)]
        all_dates = [AS_OF - timedelta(days=i) for i in range(3)]
        repo = FakeProgressRepository(current_rows=rows, all_dates=all_dates)
        service = ProgressService(repo)
        result = service.get_metrics("client-1", AS_OF, 7)

        for dim in result.metrics.values():
            self.assertEqual(len(dim.sparkline), 7)
            non_none = [v for v in dim.sparkline if v is not None]
            self.assertEqual(len(non_none), 3)

    def test_trend_stable_with_no_prior_window(self):
        rows = [_all_fives_row(AS_OF - timedelta(days=i)) for i in range(3)]
        repo = FakeProgressRepository(current_rows=rows)
        service = ProgressService(repo)
        result = service.get_metrics("client-1", AS_OF, 7)
        for dim in result.metrics.values():
            self.assertEqual(dim.trend_direction, "stable")


class TestProgressServiceCoachInsights(unittest.TestCase):
    def test_low_sleep_three_days_triggers_insight(self):
        rows = [
            _make_row(AS_OF, sleep=1, stress=4, soreness=4, nutrition=4, motivation=4),
            _make_row(AS_OF - timedelta(days=1), sleep=2, stress=4, soreness=4, nutrition=4, motivation=4),
            _make_row(AS_OF - timedelta(days=2), sleep=1, stress=4, soreness=4, nutrition=4, motivation=4),
            _make_row(AS_OF - timedelta(days=3), sleep=5, stress=5, soreness=5, nutrition=5, motivation=5),
        ]
        repo = FakeProgressRepository(current_rows=rows)
        service = ProgressService(repo)
        result = service.get_metrics("client-1", AS_OF, 7)

        sleep_dim = result.metrics["sleep"]
        self.assertTrue(sleep_dim.coach_insight_triggered)
        self.assertEqual(sleep_dim.coach_insight_reason, "low_sleep_3_days")

    def test_low_calm_three_days_triggers_insight(self):
        rows = [
            _make_row(AS_OF, sleep=4, stress=2, soreness=4, nutrition=4, motivation=4),
            _make_row(AS_OF - timedelta(days=1), sleep=4, stress=1, soreness=4, nutrition=4, motivation=4),
            _make_row(AS_OF - timedelta(days=2), sleep=4, stress=2, soreness=4, nutrition=4, motivation=4),
        ]
        repo = FakeProgressRepository(current_rows=rows)
        service = ProgressService(repo)
        result = service.get_metrics("client-1", AS_OF, 7)

        stress_dim = result.metrics["stress"]
        self.assertTrue(stress_dim.coach_insight_triggered)
        self.assertEqual(stress_dim.coach_insight_reason, "low_calm_3_days")

    def test_nutrition_below_target_7d(self):
        rows = [_make_row(AS_OF - timedelta(days=i), sleep=4, stress=4, soreness=4, nutrition=2, motivation=4) for i in range(7)]
        repo = FakeProgressRepository(current_rows=rows)
        service = ProgressService(repo)
        result = service.get_metrics("client-1", AS_OF, 7)

        nutrition_dim = result.metrics["nutrition"]
        self.assertTrue(nutrition_dim.coach_insight_triggered)
        self.assertEqual(nutrition_dim.coach_insight_reason, "nutrition_below_target_7d")

    def test_readiness_sharp_drop_triggers_insight(self):
        recent_rows = [
            _make_row(AS_OF, sleep=1, stress=1, soreness=1, nutrition=1, motivation=1),
            _make_row(AS_OF - timedelta(days=1), sleep=1, stress=1, soreness=1, nutrition=1, motivation=1),
            _make_row(AS_OF - timedelta(days=2), sleep=1, stress=1, soreness=1, nutrition=1, motivation=1),
        ]
        baseline_rows = [_all_fives_row(AS_OF - timedelta(days=i)) for i in range(3, 7)]
        repo = FakeProgressRepository(current_rows=recent_rows + baseline_rows)
        service = ProgressService(repo)
        result = service.get_metrics("client-1", AS_OF, 7)

        readiness = result.metrics["readiness"]
        self.assertTrue(readiness.coach_insight_triggered)
        self.assertEqual(readiness.coach_insight_reason, "readiness_sharp_drop")


class TestProgressService30Day(unittest.TestCase):
    def test_sparkline_length_thirty(self):
        rows = [_all_fives_row(AS_OF - timedelta(days=i)) for i in range(30)]
        all_dates = [AS_OF - timedelta(days=i) for i in range(30)]
        repo = FakeProgressRepository(current_rows=rows, all_dates=all_dates)
        service = ProgressService(repo)
        result = service.get_metrics("client-1", AS_OF, 30)

        for dim in result.metrics.values():
            self.assertEqual(len(dim.sparkline), 30)

    def test_period_days_in_response(self):
        repo = FakeProgressRepository()
        service = ProgressService(repo)
        result = service.get_metrics("client-1", AS_OF, 30)
        self.assertEqual(result.period_days, 30)


class TestProgressServiceStreakWeeks(unittest.TestCase):
    def test_fourteen_consecutive_days_gives_two_weeks(self):
        all_dates = [AS_OF - timedelta(days=i) for i in range(14)]
        rows = [_all_fives_row(d) for d in all_dates]
        repo = FakeProgressRepository(current_rows=rows, all_dates=all_dates)
        service = ProgressService(repo)
        result = service.get_metrics("client-1", AS_OF, 7)

        self.assertEqual(result.streak.current_weeks, 2)
        self.assertEqual(result.streak.milestone_next, 4)

    def test_milestone_next_none_when_all_passed(self):
        all_dates = [AS_OF - timedelta(days=i) for i in range(90)]
        rows = [_all_fives_row(d) for d in all_dates[:7]]
        repo = FakeProgressRepository(current_rows=rows, all_dates=all_dates)
        service = ProgressService(repo)
        result = service.get_metrics("client-1", AS_OF, 7)

        self.assertIsNone(result.streak.milestone_next)

    def test_personal_best_from_history(self):
        all_dates = [AS_OF - timedelta(days=i) for i in range(21)]
        rows = [_all_fives_row(d) for d in all_dates[:7]]
        repo = FakeProgressRepository(current_rows=rows, all_dates=all_dates)
        service = ProgressService(repo)
        result = service.get_metrics("client-1", AS_OF, 7)

        self.assertEqual(result.streak.personal_best_weeks, 3)


class TestProgressAPIEndpoint(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

        rows = [_all_fives_row(AS_OF - timedelta(days=i)) for i in range(7)]
        all_dates = [AS_OF - timedelta(days=i) for i in range(7)]
        fake_repo = FakeProgressRepository(current_rows=rows, all_dates=all_dates)
        fake_service = ProgressService(fake_repo)

        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="user-1", access_token="tok", email="test@example.com"
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id=None,
            trainer_user_id=None,
            trainer_display_name=None,
            client_id="client-1",
            client_user_id="user-1",
        )
        app.dependency_overrides[get_progress_service] = lambda: fake_service

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_returns_200(self):
        resp = self.client.get("/api/v1/progress/metrics", params={"as_of_date": AS_OF.isoformat()})
        self.assertEqual(resp.status_code, 200)

    def test_response_has_six_metric_keys(self):
        resp = self.client.get("/api/v1/progress/metrics", params={"as_of_date": AS_OF.isoformat()})
        data = resp.json()
        self.assertIn("metrics", data)
        self.assertEqual(
            set(data["metrics"].keys()),
            {"readiness", "sleep", "recovery", "energy_mood", "stress", "nutrition"},
        )

    def test_each_dimension_has_required_fields(self):
        resp = self.client.get("/api/v1/progress/metrics", params={"as_of_date": AS_OF.isoformat()})
        data = resp.json()
        required = {
            "surface_value", "surface_value_raw", "trend_direction", "trend_label",
            "status", "signals", "sparkline", "coach_insight_triggered", "coach_insight_reason",
        }
        for key, dim in data["metrics"].items():
            self.assertEqual(required, required & set(dim.keys()), f"missing fields in {key}")

    def test_streak_block_present(self):
        resp = self.client.get("/api/v1/progress/metrics", params={"as_of_date": AS_OF.isoformat()})
        data = resp.json()
        self.assertIn("streak", data)
        streak = data["streak"]
        for field in ["current_weeks", "days_this_week", "days_target", "personal_best_weeks"]:
            self.assertIn(field, streak, f"streak missing {field}")

    def test_period_days_default_seven(self):
        resp = self.client.get("/api/v1/progress/metrics", params={"as_of_date": AS_OF.isoformat()})
        data = resp.json()
        self.assertEqual(data["period_days"], 7)

    def test_period_days_thirty(self):
        resp = self.client.get("/api/v1/progress/metrics", params={"as_of_date": AS_OF.isoformat(), "period_days": "30"})
        data = resp.json()
        self.assertEqual(data["period_days"], 30)

    def test_no_client_returns_400(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id=None,
            trainer_user_id=None,
            trainer_display_name=None,
            client_id=None,
            client_user_id=None,
        )
        resp = self.client.get("/api/v1/progress/metrics", params={"as_of_date": AS_OF.isoformat()})
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()
