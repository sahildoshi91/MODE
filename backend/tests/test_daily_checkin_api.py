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
from app.modules.daily_checkins.repository import DailyCheckinRepository, DailyCheckinRepositoryError
from app.modules.daily_checkins.schemas import (
    DailyCheckinInputs,
    DailyCheckinResult,
    DailyCheckinStatusResponse,
    Environment,
    GenerateCheckinPlanRequest,
    PlanType,
    YesterdayCheckinSummary,
)
from app.modules.daily_checkins.service import DailyCheckinService


class FakeDailyCheckinService:
    def __init__(self):
        self.last_submit = None
        self.last_generate = None
        self.last_log = None
        self.last_progress = None

    def get_status(self, client_id: str, checkin_date: date) -> DailyCheckinStatusResponse:
        if client_id == "client-complete":
            return DailyCheckinStatusResponse(
                date=checkin_date,
                completed=True,
                current_streak=4,
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
        return DailyCheckinStatusResponse(date=checkin_date, completed=False, current_streak=0)

    def get_previous_checkin_summary(self, client_id: str, before_date: date):
        if client_id == "client-generate":
            return YesterdayCheckinSummary(
                date=date(2026, 3, 26),
                score=19,
                mode="BUILD",
                inputs=DailyCheckinInputs(
                    sleep=4,
                    stress=4,
                    soreness=3,
                    nutrition=4,
                    motivation=4,
                ),
            )
        return None

    def get_progress_analytics(self, client_id: str, as_of_date: date):
        self.last_progress = {
            "client_id": client_id,
            "as_of_date": as_of_date,
        }
        return {
            "as_of_date": as_of_date,
            "current_streak_days": 5,
            "checkins_last_7_days": 6,
            "avg_score_last_7_days": 18.33,
            "avg_mode_last_7_days": "BUILD",
            "avg_score_last_30_days": 17.8,
            "avg_mode_last_30_days": "BUILD",
            "score_change_7d": {
                "value": 1.5,
                "previous_average": 16.83,
                "has_previous_window_data": True,
            },
            "score_change_30d": {
                "value": None,
                "previous_average": None,
                "has_previous_window_data": False,
            },
            "has_enough_for_30d": False,
            "insufficient_data_reason": "Not enough data yet for 30-day analytics. Log at least 30 check-ins.",
            "recent_checkins": [
                {"date": date(2026, 4, 8), "score": 19, "mode": "BUILD"},
                {"date": date(2026, 4, 7), "score": 18, "mode": "BUILD"},
            ],
        }

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

    def generate_plan(self, client_id: str, user_id: str, request):
        self.last_generate = {
            "client_id": client_id,
            "user_id": user_id,
            "request": request.model_dump(),
        }
        return {
            "plan_id": "generated-plan-1",
            "plan_type": request.plan_type,
            "content": "{\"title\":\"Builder\"}",
            "structured": {"title": "Builder"},
        }

    def log_generated_workout(self, user_id: str, request):
        self.last_log = {
            "user_id": user_id,
            "request": request.model_dump(),
        }
        return {
            "workout_id": "workout-1",
            "completed": True,
        }


class FailingDailyCheckinService(FakeDailyCheckinService):
    def submit_checkin(self, client_id: str, checkin_date: date, inputs: DailyCheckinInputs, time_to_complete=None):
        raise RuntimeError("database unavailable")


class FailingGenerateDailyCheckinService(FakeDailyCheckinService):
    def generate_plan(self, client_id: str, user_id: str, request):
        raise DailyCheckinRepositoryError(
            "Could not find the table 'public.generated_checkin_plans' in the schema cache",
            status_code=404,
            code="PGRST205",
            hint="Run backend/sql/20260407_create_generated_checkin_plans.sql",
        )


class StubResponse:
    def __init__(self, data):
        self.data = data


class FailingResponse:
    def __init__(self, status_code=403, payload=None):
        self.status_code = status_code
        self._payload = payload or {
            "message": "new row violates row-level security policy",
            "code": "42501",
            "hint": "Check auth.uid() against clients.user_id",
            "details": "RLS insert policy rejected the row.",
        }

    def json(self):
        return self._payload


class FakeSupabaseFailure(Exception):
    def __init__(self, response):
        super().__init__("supabase failure")
        self.response = response


class FakePostgrestApiError(Exception):
    def __init__(self):
        super().__init__(
            {
                "message": 'new row for relation "daily_checkins" violates check constraint "daily_checkins_assigned_mode_check"',
                "code": "23514",
                "hint": None,
                "details": "Failing row contains (...)",
            }
        )


class StubTable:
    def __init__(self, execute_result=None, execute_error=None, lookup_data=None):
        self.execute_result = execute_result
        self.execute_error = execute_error
        self.lookup_data = lookup_data or []
        self.last_upsert_payload = None
        self.last_insert_payload = None
        self._pending_upsert = False
        self._pending_insert = False

    def upsert(self, payload, on_conflict=None):
        self.last_upsert_payload = payload
        self._pending_upsert = True
        return self

    def insert(self, payload):
        self.last_insert_payload = payload
        self._pending_insert = True
        return self

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def neq(self, *_args, **_kwargs):
        return self

    def lte(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        if self.execute_error:
            raise self.execute_error
        if self._pending_upsert:
            self._pending_upsert = False
            if self.execute_result is not None:
                return self.execute_result
        if self._pending_insert:
            self._pending_insert = False
            if self.execute_result is not None:
                return self.execute_result
        if self.lookup_data is not None:
            return StubResponse(self.lookup_data)
        if self.execute_result is not None:
            return self.execute_result
        return StubResponse([])


class StubSupabase:
    def __init__(self, table_impl):
        self.table_impl = table_impl

    def table(self, _name):
        return self.table_impl


class DailyCheckinServiceTests(unittest.TestCase):
    def _build_record(self):
        return {
            "id": "checkin-1",
            "client_id": "client-1",
            "date": "2026-03-27",
            "inputs": {
                "sleep": 4,
                "stress": 3,
                "soreness": 4,
                "nutrition": 2,
                "motivation": 5,
            },
            "total_score": 18,
            "assigned_mode": "BUILD",
            "time_to_complete": 12,
            "completion_timestamp": "2026-03-27T16:00:00+00:00",
        }

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

    def test_build_result_normalizes_legacy_mode_values(self):
        class FakeRepository:
            def get_previous_checkin(self, _client_id, _parsed_date):
                return None

        service = DailyCheckinService(repository=FakeRepository(), profile_service=None)
        record = self._build_record()
        record["assigned_mode"] = "YELLOW"

        result = service._build_result(record)

        self.assertEqual(result.mode, "BUILD")
        self.assertEqual(result.training.type, "Moderate cardio or controlled strength")

    def test_submit_checkin_retries_with_legacy_mode_when_constraint_rejects_new_mode(self):
        class ConstraintFallbackRepository:
            def __init__(self):
                self.calls = []

            def upsert_checkin(self, payload):
                self.calls.append(dict(payload))
                if len(self.calls) == 1:
                    raise DailyCheckinRepositoryError(
                        "new row violates check constraint daily_checkins_assigned_mode_check",
                        code="23514",
                        details='new row for relation "daily_checkins" violates check constraint "daily_checkins_assigned_mode_check"',
                    )
                return {
                    "id": "checkin-fallback",
                    "client_id": payload["client_id"],
                    "date": payload["date"],
                    "inputs": payload["inputs"],
                    "total_score": payload["total_score"],
                    "assigned_mode": payload["assigned_mode"],
                    "time_to_complete": payload["time_to_complete"],
                    "completion_timestamp": payload["completion_timestamp"],
                }

            def get_previous_checkin(self, _client_id, _parsed_date):
                return None

        repository = ConstraintFallbackRepository()
        service = DailyCheckinService(repository=repository, profile_service=None)
        inputs = DailyCheckinInputs(sleep=4, stress=4, soreness=4, nutrition=4, motivation=4)

        result = service.submit_checkin(
            client_id="client-1",
            checkin_date=date(2026, 4, 7),
            inputs=inputs,
            time_to_complete=10,
        )

        self.assertEqual(len(repository.calls), 2)
        self.assertEqual(repository.calls[0]["assigned_mode"], "BUILD")
        self.assertEqual(repository.calls[1]["assigned_mode"], "YELLOW")
        self.assertEqual(result.mode, "BUILD")
        self.assertEqual(result.score, 20)

    def test_get_status_returns_zero_streak_when_no_checkin_exists(self):
        class FakeRepository:
            def get_by_client_and_date(self, _client_id, _checkin_date):
                return None

        service = DailyCheckinService(repository=FakeRepository(), profile_service=None)

        result = service.get_status("client-1", date(2026, 4, 7))

        self.assertFalse(result.completed)
        self.assertEqual(result.current_streak, 0)
        self.assertIsNone(result.checkin)

    def test_get_status_returns_consecutive_streak_for_completed_checkin(self):
        class FakeRepository:
            def get_by_client_and_date(self, _client_id, _checkin_date):
                return {
                    "id": "checkin-1",
                    "client_id": "client-1",
                    "date": "2026-04-07",
                    "inputs": {
                        "sleep": 4,
                        "stress": 4,
                        "soreness": 4,
                        "nutrition": 4,
                        "motivation": 4,
                    },
                    "total_score": 20,
                    "assigned_mode": "BUILD",
                    "time_to_complete": 10,
                    "completion_timestamp": "2026-04-07T16:00:00+00:00",
                }

            def list_checkin_dates_on_or_before(self, _client_id, _checkin_date):
                return [
                    date(2026, 4, 7),
                    date(2026, 4, 6),
                    date(2026, 4, 5),
                    date(2026, 4, 3),
                ]

            def get_previous_checkin(self, _client_id, _parsed_date):
                return None

        service = DailyCheckinService(repository=FakeRepository(), profile_service=None)

        result = service.get_status("client-1", date(2026, 4, 7))

        self.assertTrue(result.completed)
        self.assertEqual(result.current_streak, 3)
        self.assertEqual(result.checkin.id, "checkin-1")

    def test_get_status_returns_zero_streak_when_streak_lookup_fails(self):
        class FakeRepository:
            def get_by_client_and_date(self, _client_id, _checkin_date):
                return {
                    "id": "checkin-1",
                    "client_id": "client-1",
                    "date": "2026-04-07",
                    "inputs": {
                        "sleep": 4,
                        "stress": 4,
                        "soreness": 4,
                        "nutrition": 4,
                        "motivation": 4,
                    },
                    "total_score": 20,
                    "assigned_mode": "BUILD",
                    "time_to_complete": 10,
                    "completion_timestamp": "2026-04-07T16:00:00+00:00",
                }

            def list_checkin_dates_on_or_before(self, _client_id, _checkin_date):
                raise RuntimeError("streak lookup failed")

            def get_previous_checkin(self, _client_id, _parsed_date):
                return None

        service = DailyCheckinService(repository=FakeRepository(), profile_service=None)

        result = service.get_status("client-1", date(2026, 4, 7))

        self.assertTrue(result.completed)
        self.assertEqual(result.current_streak, 0)

    def test_progress_analytics_streak_and_last_7_count_are_correct(self):
        class FakeRepository:
            def list_checkins_on_or_before(self, _client_id, _as_of_date):
                return [
                    {"date": "2026-04-10", "total_score": 20, "assigned_mode": "BUILD"},
                    {"date": "2026-04-09", "total_score": 19, "assigned_mode": "BUILD"},
                    {"date": "2026-04-08", "total_score": 18, "assigned_mode": "BUILD"},
                    {"date": "2026-04-06", "total_score": 17, "assigned_mode": "BUILD"},
                ]

        service = DailyCheckinService(repository=FakeRepository(), profile_service=None)
        result = service.get_progress_analytics("client-1", date(2026, 4, 10))

        self.assertEqual(result.current_streak_days, 3)
        self.assertEqual(result.checkins_last_7_days, 4)

    def test_progress_analytics_average_score_and_mode_mapping_are_correct(self):
        class FakeRepository:
            def list_checkins_on_or_before(self, _client_id, _as_of_date):
                return [
                    {"date": "2026-04-10", "total_score": 21, "assigned_mode": "BEAST"},
                    {"date": "2026-04-09", "total_score": 20, "assigned_mode": "BUILD"},
                    {"date": "2026-04-08", "total_score": 19, "assigned_mode": "BUILD"},
                    {"date": "2026-04-07", "total_score": 18, "assigned_mode": "BUILD"},
                ]

        service = DailyCheckinService(repository=FakeRepository(), profile_service=None)
        result = service.get_progress_analytics("client-1", date(2026, 4, 10))

        self.assertEqual(result.avg_score_last_7_days, 19.5)
        self.assertEqual(result.avg_mode_last_7_days, "BUILD")

    def test_progress_analytics_7d_delta_compares_previous_7_day_window(self):
        class FakeRepository:
            def list_checkins_on_or_before(self, _client_id, _as_of_date):
                return [
                    {"date": "2026-04-10", "total_score": 20, "assigned_mode": "BUILD"},
                    {"date": "2026-04-09", "total_score": 19, "assigned_mode": "BUILD"},
                    {"date": "2026-04-08", "total_score": 18, "assigned_mode": "BUILD"},
                    {"date": "2026-04-07", "total_score": 17, "assigned_mode": "BUILD"},
                    {"date": "2026-04-04", "total_score": 15, "assigned_mode": "RECOVER"},
                    {"date": "2026-04-03", "total_score": 14, "assigned_mode": "RECOVER"},
                    {"date": "2026-04-02", "total_score": 13, "assigned_mode": "RECOVER"},
                ]

        service = DailyCheckinService(repository=FakeRepository(), profile_service=None)
        result = service.get_progress_analytics("client-1", date(2026, 4, 10))

        self.assertEqual(result.score_change_7d.previous_average, 14.0)
        self.assertEqual(result.score_change_7d.value, 4.0)
        self.assertTrue(result.score_change_7d.has_previous_window_data)

    def test_progress_analytics_hides_30d_metrics_until_threshold_met(self):
        class FakeRepository:
            def list_checkins_on_or_before(self, _client_id, _as_of_date):
                return [
                    {"date": f"2026-04-{day:02d}", "total_score": 18, "assigned_mode": "BUILD"}
                    for day in range(1, 30)
                ]

        service = DailyCheckinService(repository=FakeRepository(), profile_service=None)
        result = service.get_progress_analytics("client-1", date(2026, 4, 29))

        self.assertFalse(result.has_enough_for_30d)
        self.assertIsNone(result.avg_score_last_30_days)
        self.assertIsNotNone(result.insufficient_data_reason)

    def test_progress_analytics_30d_delta_requires_previous_30_day_window_data(self):
        class FakeRepository:
            def list_checkins_on_or_before(self, _client_id, _as_of_date):
                rows = []
                for day in range(0, 30):
                    target = date(2026, 4, 10).fromordinal(date(2026, 4, 10).toordinal() - day)
                    rows.append({
                        "date": target.isoformat(),
                        "total_score": 18,
                        "assigned_mode": "BUILD",
                    })
                return rows

        service = DailyCheckinService(repository=FakeRepository(), profile_service=None)
        result = service.get_progress_analytics("client-1", date(2026, 4, 10))

        self.assertTrue(result.has_enough_for_30d)
        self.assertEqual(result.avg_score_last_30_days, 18.0)
        self.assertIsNone(result.score_change_30d.value)
        self.assertFalse(result.score_change_30d.has_previous_window_data)

    def test_progress_analytics_returns_safe_defaults_for_empty_history(self):
        class FakeRepository:
            def list_checkins_on_or_before(self, _client_id, _as_of_date):
                return []

        service = DailyCheckinService(repository=FakeRepository(), profile_service=None)
        result = service.get_progress_analytics("client-1", date(2026, 4, 10))

        self.assertEqual(result.current_streak_days, 0)
        self.assertEqual(result.checkins_last_7_days, 0)
        self.assertIsNone(result.avg_score_last_7_days)
        self.assertEqual(result.recent_checkins, [])

    def test_build_result_succeeds_when_profile_lookup_raises(self):
        class FakeProfileService:
            def get_or_create_profile(self, _client_id):
                raise RuntimeError("profile lookup failed")

        class FakeRepository:
            def get_previous_checkin(self, _client_id, _parsed_date):
                return None

        service = DailyCheckinService(repository=FakeRepository(), profile_service=FakeProfileService())

        result = service._build_result(self._build_record())

        self.assertEqual(result.mode, "BUILD")
        self.assertEqual(result.score, 18)
        self.assertEqual(result.primary_goal, None)
        self.assertEqual(result.yesterday_checkin_summary, None)
        self.assertEqual(result.training.type, "Moderate cardio or controlled strength")

    def test_build_result_succeeds_when_previous_checkin_lookup_raises(self):
        class FakeProfileService:
            def get_or_create_profile(self, _client_id):
                return {"primary_goal": "strength"}

        class FakeRepository:
            def get_previous_checkin(self, _client_id, _parsed_date):
                raise RuntimeError("history lookup failed")

        service = DailyCheckinService(repository=FakeRepository(), profile_service=FakeProfileService())

        result = service._build_result(self._build_record())

        self.assertEqual(result.mode, "BUILD")
        self.assertEqual(result.score, 18)
        self.assertEqual(result.primary_goal, "strength")
        self.assertEqual(result.yesterday_checkin_summary, None)
        self.assertIsNotNone(result.nutrition_tip)

    def test_build_result_keeps_core_fields_when_enrichment_fails(self):
        class FakeProfileService:
            def get_or_create_profile(self, _client_id):
                raise RuntimeError("profile lookup failed")

        class FakeRepository:
            def get_previous_checkin(self, _client_id, _parsed_date):
                raise RuntimeError("history lookup failed")

        service = DailyCheckinService(repository=FakeRepository(), profile_service=FakeProfileService())

        result = service._build_result(self._build_record())

        self.assertEqual(result.id, "checkin-1")
        self.assertEqual(str(result.date), "2026-03-27")
        self.assertEqual(result.inputs.nutrition, 2)
        self.assertEqual(result.mindset.cue, "Build momentum with disciplined reps.")
        self.assertEqual(result.primary_goal, None)
        self.assertEqual(result.yesterday_checkin_summary, None)

    def test_adaptive_note_reduces_intensity_when_last_workout_felt_hard(self):
        service = DailyCheckinService(repository=None)
        note = service._build_adaptive_note("BUILD", {"feel_rating": 2})
        self.assertIn("felt Hard", note)
        self.assertIn("dialed intensity down", note)

    def test_adaptive_note_increases_intensity_when_last_workout_felt_easy(self):
        service = DailyCheckinService(repository=None)
        note = service._build_adaptive_note("BEAST", {"feel_rating": 5})
        self.assertIn("felt Easy", note)
        self.assertIn("nudges intensity up", note)

    def test_generate_plan_succeeds_when_profile_lookup_raises(self):
        class GeneratePlanRepository:
            def __init__(self):
                self.saved_payload = None

            def get_by_client_and_id(self, _client_id, checkin_id):
                return {
                    "id": checkin_id,
                    "client_id": "client-1",
                    "date": "2026-04-08",
                    "inputs": {
                        "sleep": 4,
                        "stress": 4,
                        "soreness": 4,
                        "nutrition": 4,
                        "motivation": 4,
                    },
                    "total_score": 20,
                    "assigned_mode": "BUILD",
                }

            def get_previous_checkin(self, _client_id, _before_date):
                return None

            def get_latest_workout_session(self, _user_id):
                return None

            def upsert_generated_plan(self, payload):
                self.saved_payload = payload
                return {"id": "generated-plan-ok"}

        class FailingProfileService:
            def get_or_create_profile(self, _client_id):
                raise RuntimeError("profile lookup failed")

        class FallbackLlm:
            def create_chat_completion(self, **_kwargs):
                raise RuntimeError("llm unavailable")

        repository = GeneratePlanRepository()
        service = DailyCheckinService(
            repository=repository,
            profile_service=FailingProfileService(),
            llm_client=FallbackLlm(),
        )

        request = GenerateCheckinPlanRequest(
            checkin_id="checkin-1",
            plan_type=PlanType.TRAINING,
            environment=Environment.HOME_GYM,
            time_available=30,
            include_yesterday_context=True,
        )

        result = service.generate_plan(client_id="client-1", user_id="user-1", request=request)

        self.assertEqual(result.plan_id, "generated-plan-ok")
        self.assertEqual(result.plan_type, PlanType.TRAINING)
        self.assertEqual(repository.saved_payload["plan_type"], "training")
        self.assertFalse(repository.saved_payload["used_yesterday_context"])

    def test_generate_plan_uses_ai_structured_response_when_json_valid(self):
        class GeneratePlanRepository:
            def __init__(self):
                self.saved_payload = None

            def get_by_client_and_id(self, _client_id, checkin_id):
                return {
                    "id": checkin_id,
                    "client_id": "client-1",
                    "date": "2026-04-08",
                    "inputs": {
                        "sleep": 4,
                        "stress": 4,
                        "soreness": 3,
                        "nutrition": 4,
                        "motivation": 3,
                    },
                    "total_score": 18,
                    "assigned_mode": "BUILD",
                }

            def get_previous_checkin(self, _client_id, _before_date):
                return None

            def get_latest_workout_session(self, _user_id):
                return {"title": "Tempo Builder", "feel_rating": 4}

            def upsert_generated_plan(self, payload):
                self.saved_payload = payload
                return {"id": "generated-plan-ai"}

        class SuccessfulLlm:
            def create_chat_completion(self, **_kwargs):
                return (
                    '{"title":"Fresh Builder","type":"strength","difficulty":"intermediate","durationMinutes":30,'
                    '"description":"A varied home gym strength session.","warmup":[{"name":"Prep","duration":"4 min",'
                    '"description":"Prime shoulders and hips."}],"exercises":[{"name":"Split squat","sets":3,'
                    '"reps":"8 / side","rest":"45 sec","muscleGroup":"legs","description":"Controlled unilateral work.",'
                    '"coachTip":"Stay tall and smooth."}],"cooldown":[{"name":"Reset","duration":"2 min",'
                    '"description":"Bring breathing down."}],"coachNote":"Today builds on your last manageable effort."}'
                )

        repository = GeneratePlanRepository()
        service = DailyCheckinService(repository=repository, llm_client=SuccessfulLlm())

        result = service.generate_plan(
            client_id="client-1",
            user_id="user-1",
            request=GenerateCheckinPlanRequest(
                checkin_id="checkin-1",
                plan_type=PlanType.TRAINING,
                environment=Environment.HOME_GYM,
                time_available=30,
            ),
        )

        self.assertEqual(result.plan_id, "generated-plan-ai")
        self.assertEqual(result.structured["title"], "Fresh Builder")
        self.assertEqual(result.structured["exercises"][0]["name"], "Split squat")
        self.assertEqual(repository.saved_payload["structured_content"]["title"], "Fresh Builder")

    def test_generate_plan_logs_provider_failure_before_falling_back(self):
        class GeneratePlanRepository:
            def __init__(self):
                self.saved_payload = None

            def get_by_client_and_id(self, _client_id, checkin_id):
                return {
                    "id": checkin_id,
                    "client_id": "client-1",
                    "date": "2026-04-08",
                    "inputs": {
                        "sleep": 4,
                        "stress": 4,
                        "soreness": 4,
                        "nutrition": 4,
                        "motivation": 4,
                    },
                    "total_score": 20,
                    "assigned_mode": "BUILD",
                }

            def get_previous_checkin(self, _client_id, _before_date):
                return None

            def get_latest_workout_session(self, _user_id):
                return None

            def upsert_generated_plan(self, payload):
                self.saved_payload = payload
                return {"id": "generated-plan-fallback"}

        class FailingLlm:
            def create_chat_completion(self, **_kwargs):
                raise RuntimeError("llm unavailable")

        repository = GeneratePlanRepository()
        service = DailyCheckinService(repository=repository, llm_client=FailingLlm())

        with self.assertLogs("app.modules.daily_checkins.service", level="WARNING") as captured:
            result = service.generate_plan(
                client_id="client-1",
                user_id="user-1",
                request=GenerateCheckinPlanRequest(
                    checkin_id="checkin-1",
                    plan_type=PlanType.TRAINING,
                    environment=Environment.HOME_GYM,
                    time_available=30,
                ),
            )

        self.assertEqual(result.plan_id, "generated-plan-fallback")
        self.assertEqual(result.structured["exercises"][0]["name"], "Goblet squat")
        self.assertTrue(any("fell back to local template" in message for message in captured.output))

    def test_generate_plan_logs_parse_failure_before_falling_back(self):
        class GeneratePlanRepository:
            def __init__(self):
                self.saved_payload = None

            def get_by_client_and_id(self, _client_id, checkin_id):
                return {
                    "id": checkin_id,
                    "client_id": "client-1",
                    "date": "2026-04-08",
                    "inputs": {
                        "sleep": 4,
                        "stress": 4,
                        "soreness": 4,
                        "nutrition": 4,
                        "motivation": 4,
                    },
                    "total_score": 20,
                    "assigned_mode": "BUILD",
                }

            def get_previous_checkin(self, _client_id, _before_date):
                return None

            def get_latest_workout_session(self, _user_id):
                return None

            def upsert_generated_plan(self, payload):
                self.saved_payload = payload
                return {"id": "generated-plan-parse-fallback"}

        class InvalidJsonLlm:
            def create_chat_completion(self, **_kwargs):
                return '{"title":"Almost there","type":"strength"}'

        repository = GeneratePlanRepository()
        service = DailyCheckinService(repository=repository, llm_client=InvalidJsonLlm())

        with self.assertLogs("app.modules.daily_checkins.service", level="WARNING") as captured:
            result = service.generate_plan(
                client_id="client-1",
                user_id="user-1",
                request=GenerateCheckinPlanRequest(
                    checkin_id="checkin-1",
                    plan_type=PlanType.TRAINING,
                    environment=Environment.HOME_GYM,
                    time_available=30,
                ),
            )

        self.assertEqual(result.plan_id, "generated-plan-parse-fallback")
        self.assertEqual(result.structured["exercises"][0]["name"], "Goblet squat")
        self.assertTrue(any("invalid structured JSON" in message for message in captured.output))

    def test_fallback_training_plan_changes_with_environment_and_duration(self):
        service = DailyCheckinService(repository=None)
        inputs = DailyCheckinInputs(sleep=4, stress=3, soreness=3, nutrition=4, motivation=4)

        home_plan = service._build_fallback_plan(
            plan_type=PlanType.TRAINING,
            mode="BUILD",
            inputs=inputs,
            request=GenerateCheckinPlanRequest(
                checkin_id="checkin-1",
                plan_type=PlanType.TRAINING,
                environment=Environment.HOME_GYM,
                time_available=30,
            ),
            profile={},
            last_workout=None,
        )
        outdoor_plan = service._build_fallback_plan(
            plan_type=PlanType.TRAINING,
            mode="BUILD",
            inputs=inputs,
            request=GenerateCheckinPlanRequest(
                checkin_id="checkin-1",
                plan_type=PlanType.TRAINING,
                environment=Environment.OUTDOORS,
                time_available=10,
            ),
            profile={},
            last_workout=None,
        )

        self.assertNotEqual(home_plan.title, outdoor_plan.title)
        self.assertNotEqual(home_plan.type, outdoor_plan.type)
        self.assertNotEqual(home_plan.exercises[0].name, outdoor_plan.exercises[0].name)
        self.assertIn("key positions", home_plan.warmup[1].description.lower())
        self.assertIn("stride", outdoor_plan.warmup[1].description.lower())

    def test_training_generation_prompt_demands_specific_warmup_descriptions(self):
        service = DailyCheckinService(repository=None)
        prompt = service._build_generation_prompt(
            checkin={
                "date": "2026-04-08",
                "assigned_mode": "BUILD",
                "total_score": 18,
            },
            profile={"primary_goal": "strength", "experience_level": "intermediate", "equipment_access": "gym"},
            request=GenerateCheckinPlanRequest(
                checkin_id="checkin-1",
                plan_type=PlanType.TRAINING,
                environment=Environment.HOME_GYM,
                time_available=30,
            ),
            yesterday=None,
            last_workout=None,
            inputs=DailyCheckinInputs(sleep=4, stress=4, soreness=3, nutrition=4, motivation=3),
        )

        self.assertIn("warmup descriptions", prompt[0]["content"].lower())
        self.assertIn("selected environment and exact time available", prompt[0]["content"].lower())
        self.assertIn("make the warmup specific and descriptive", prompt[1]["content"].lower())

    def test_generate_plan_requires_time_available_for_training(self):
        class GeneratePlanRepository:
            def get_by_client_and_id(self, _client_id, checkin_id):
                return {
                    "id": checkin_id,
                    "client_id": "client-1",
                    "date": "2026-04-08",
                    "inputs": {
                        "sleep": 4,
                        "stress": 4,
                        "soreness": 4,
                        "nutrition": 4,
                        "motivation": 4,
                    },
                    "total_score": 20,
                    "assigned_mode": "BUILD",
                }

            def get_previous_checkin(self, _client_id, _before_date):
                return None

            def get_latest_workout_session(self, _user_id):
                return None

        service = DailyCheckinService(repository=GeneratePlanRepository())

        with self.assertRaises(ValueError) as captured:
            service.generate_plan(
                client_id="client-1",
                user_id="user-1",
                request=GenerateCheckinPlanRequest(
                    checkin_id="checkin-1",
                    plan_type=PlanType.TRAINING,
                    environment=Environment.HOME_GYM,
                ),
            )

        self.assertIn("time available", str(captured.exception))

    def test_generate_plan_reuses_latest_variant_when_request_fingerprint_matches(self):
        request = GenerateCheckinPlanRequest(
            checkin_id="checkin-1",
            plan_type=PlanType.TRAINING,
            environment=Environment.HOME_GYM,
            time_available=30,
        )
        fingerprint = DailyCheckinService(repository=None)._build_request_fingerprint(request)

        class GeneratePlanRepository:
            def get_by_client_and_id(self, _client_id, checkin_id):
                return {
                    "id": checkin_id,
                    "client_id": "client-1",
                    "date": "2026-04-08",
                    "inputs": {
                        "sleep": 4,
                        "stress": 4,
                        "soreness": 4,
                        "nutrition": 4,
                        "motivation": 4,
                    },
                    "total_score": 20,
                    "assigned_mode": "BUILD",
                }

            def get_previous_checkin(self, _client_id, _before_date):
                return None

            def get_latest_workout_session(self, _user_id):
                return None

            def get_latest_generated_plan_variant(self, **_kwargs):
                return {
                    "id": "generated-plan-existing",
                    "request_fingerprint": fingerprint,
                    "revision_number": 2,
                    "raw_content": '{"title":"Existing Builder"}',
                    "structured_content": {
                        "title": "Existing Builder",
                        "type": "strength",
                        "difficulty": "intermediate",
                        "durationMinutes": 30,
                        "description": "Cached plan",
                        "warmup": [],
                        "exercises": [],
                        "cooldown": [],
                        "coachNote": "Cached note",
                    },
                }

            def get_latest_generated_plan_from_other_fingerprints(self, **_kwargs):
                return None

        class ExplodingLlm:
            def create_chat_completion(self, **_kwargs):
                raise AssertionError("LLM should not be called when matching fingerprint already exists")

        service = DailyCheckinService(repository=GeneratePlanRepository(), llm_client=ExplodingLlm())
        result = service.generate_plan(client_id="client-1", user_id="user-1", request=request)

        self.assertEqual(result.plan_id, "generated-plan-existing")
        self.assertEqual(result.revision_number, 2)
        self.assertEqual(result.request_fingerprint, fingerprint)
        self.assertEqual(result.workout_context["generated_plan_id"], "generated-plan-existing")

    def test_generate_plan_refresh_requested_creates_new_revision(self):
        class GeneratePlanRepository:
            def __init__(self):
                self.insert_payload = None

            def get_by_client_and_id(self, _client_id, checkin_id):
                return {
                    "id": checkin_id,
                    "client_id": "client-1",
                    "date": "2026-04-08",
                    "inputs": {
                        "sleep": 4,
                        "stress": 4,
                        "soreness": 4,
                        "nutrition": 4,
                        "motivation": 4,
                    },
                    "total_score": 20,
                    "assigned_mode": "BUILD",
                }

            def get_previous_checkin(self, _client_id, _before_date):
                return None

            def get_latest_workout_session(self, _user_id):
                return None

            def get_latest_generated_plan_variant(self, **_kwargs):
                return {
                    "id": "generated-plan-existing",
                    "request_fingerprint": "abc123",
                    "revision_number": 2,
                    "structured_content": {"title": "Older"},
                }

            def get_latest_generated_plan_from_other_fingerprints(self, **_kwargs):
                return None

            def insert_generated_plan(self, payload):
                self.insert_payload = payload
                return {"id": "generated-plan-new", **payload}

        class SuccessfulLlm:
            def create_chat_completion(self, **_kwargs):
                return (
                    '{"title":"Fresh Builder","type":"strength","difficulty":"intermediate","durationMinutes":30,'
                    '"description":"A varied home gym strength session.","warmup":[{"name":"Prep","duration":"4 min",'
                    '"description":"Prime shoulders and hips."}],"exercises":[{"name":"Split squat","sets":3,'
                    '"reps":"8 / side","rest":"45 sec","muscleGroup":"legs","description":"Controlled unilateral work.",'
                    '"coachTip":"Stay tall and smooth."}],"cooldown":[{"name":"Reset","duration":"2 min",'
                    '"description":"Bring breathing down."}],"coachNote":"Today builds on your last manageable effort."}'
                )

        repository = GeneratePlanRepository()
        service = DailyCheckinService(repository=repository, llm_client=SuccessfulLlm())
        result = service.generate_plan(
            client_id="client-1",
            user_id="user-1",
            request=GenerateCheckinPlanRequest(
                checkin_id="checkin-1",
                plan_type=PlanType.TRAINING,
                environment=Environment.HOME_GYM,
                time_available=30,
                refresh_requested=True,
            ),
        )

        self.assertEqual(result.plan_id, "generated-plan-new")
        self.assertEqual(result.revision_number, 3)
        self.assertEqual(repository.insert_payload["revision_number"], 3)

    def test_generate_plan_forces_divergence_when_prior_variant_is_identical(self):
        class GeneratePlanRepository:
            def __init__(self):
                self.insert_payload = None

            def get_by_client_and_id(self, _client_id, checkin_id):
                return {
                    "id": checkin_id,
                    "client_id": "client-1",
                    "date": "2026-04-08",
                    "inputs": {
                        "sleep": 4,
                        "stress": 4,
                        "soreness": 4,
                        "nutrition": 4,
                        "motivation": 4,
                    },
                    "total_score": 20,
                    "assigned_mode": "BUILD",
                }

            def get_previous_checkin(self, _client_id, _before_date):
                return None

            def get_latest_workout_session(self, _user_id):
                return None

            def get_latest_generated_plan_variant(self, **_kwargs):
                return None

            def get_latest_generated_plan_from_other_fingerprints(self, **_kwargs):
                return {
                    "id": "generated-plan-prior",
                    "request_fingerprint": "prior",
                    "environment": "outdoors",
                    "time_available": 30,
                    "structured_content": {
                        "title": "Outside Builder",
                        "type": "strength",
                        "difficulty": "intermediate",
                        "durationMinutes": 30,
                        "description": "Same plan",
                        "warmup": [{"name": "Prep", "duration": "4 min", "description": "Prime shoulders and hips."}],
                        "exercises": [{"name": "Split squat", "sets": 3, "reps": "8 / side", "rest": "45 sec", "muscleGroup": "legs", "description": "Controlled unilateral work.", "coachTip": "Stay tall and smooth."}],
                        "cooldown": [{"name": "Reset", "duration": "2 min", "description": "Bring breathing down."}],
                        "coachNote": "Same note",
                    },
                }

            def insert_generated_plan(self, payload):
                self.insert_payload = payload
                return {"id": "generated-plan-diverged", **payload}

        class StubbornLlm:
            def create_chat_completion(self, **_kwargs):
                return (
                    '{"title":"Outside Builder","type":"strength","difficulty":"intermediate","durationMinutes":30,'
                    '"description":"Same plan","warmup":[{"name":"Prep","duration":"4 min","description":"Prime shoulders and hips."}],'
                    '"exercises":[{"name":"Split squat","sets":3,"reps":"8 / side","rest":"45 sec","muscleGroup":"legs","description":"Controlled unilateral work.","coachTip":"Stay tall and smooth."}],'
                    '"cooldown":[{"name":"Reset","duration":"2 min","description":"Bring breathing down."}],"coachNote":"Same note"}'
                )

        repository = GeneratePlanRepository()
        service = DailyCheckinService(repository=repository, llm_client=StubbornLlm())
        result = service.generate_plan(
            client_id="client-1",
            user_id="user-1",
            request=GenerateCheckinPlanRequest(
                checkin_id="checkin-1",
                plan_type=PlanType.TRAINING,
                environment=Environment.HOME_GYM,
                time_available=30,
            ),
        )

        self.assertEqual(result.plan_id, "generated-plan-diverged")
        self.assertNotEqual(result.structured["exercises"][0]["name"], "Split squat")
        self.assertEqual(repository.insert_payload["environment"], "home_gym")


class DailyCheckinRepositoryTests(unittest.TestCase):
    def test_list_checkin_dates_on_or_before_returns_dates(self):
        table = StubTable(
            lookup_data=[
                {"date": "2026-03-27"},
                {"date": "2026-03-26"},
                {"date": "2026-03-25"},
            ],
        )
        repository = DailyCheckinRepository(StubSupabase(table))

        result = repository.list_checkin_dates_on_or_before("client-1", date(2026, 3, 27))

        self.assertEqual(result, [date(2026, 3, 27), date(2026, 3, 26), date(2026, 3, 25)])

    def test_list_checkins_on_or_before_returns_compact_rows(self):
        table = StubTable(
            lookup_data=[
                {"date": "2026-03-27", "total_score": 18, "assigned_mode": "BUILD"},
                {"date": "2026-03-26", "total_score": 16, "assigned_mode": "YELLOW"},
            ],
        )
        repository = DailyCheckinRepository(StubSupabase(table))

        result = repository.list_checkins_on_or_before("client-1", date(2026, 3, 27))

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["date"], "2026-03-27")
        self.assertEqual(result[1]["assigned_mode"], "YELLOW")

    def test_upsert_checkin_surfaces_supabase_error_details(self):
        table = StubTable(
            execute_error=FakeSupabaseFailure(FailingResponse()),
        )
        repository = DailyCheckinRepository(StubSupabase(table))

        with self.assertRaises(DailyCheckinRepositoryError) as captured:
            repository.upsert_checkin({
                "client_id": "client-1",
                "date": "2026-03-27",
            })

        error = captured.exception
        self.assertEqual(error.status_code, 403)
        self.assertEqual(error.code, "42501")
        self.assertIn("row-level security", str(error))

    def test_upsert_checkin_reads_row_back_when_upsert_returns_no_data(self):
        existing = {
            "id": "checkin-1",
            "client_id": "client-1",
            "date": "2026-03-27",
            "inputs": {
                "sleep": 4,
                "stress": 4,
                "soreness": 4,
                "nutrition": 4,
                "motivation": 4,
            },
            "total_score": 20,
            "assigned_mode": "BUILD",
        }
        table = StubTable(
            execute_result=StubResponse([]),
            lookup_data=[existing],
        )
        repository = DailyCheckinRepository(StubSupabase(table))

        result = repository.upsert_checkin({
            "client_id": "client-1",
            "date": "2026-03-27",
        })

        self.assertEqual(result["id"], "checkin-1")

    def test_upsert_checkin_raises_when_row_still_missing_after_empty_response(self):
        table = StubTable(
            execute_result=StubResponse([]),
            lookup_data=[],
        )
        repository = DailyCheckinRepository(StubSupabase(table))

        with self.assertRaises(DailyCheckinRepositoryError) as captured:
            repository.upsert_checkin({
                "client_id": "client-1",
                "date": "2026-03-27",
            })

        self.assertIn("without a readable row", str(captured.exception))

    def test_upsert_checkin_parses_postgrest_api_error_without_response_object(self):
        table = StubTable(
            execute_error=FakePostgrestApiError(),
        )
        repository = DailyCheckinRepository(StubSupabase(table))

        with self.assertRaises(DailyCheckinRepositoryError) as captured:
            repository.upsert_checkin({
                "client_id": "client-1",
                "date": "2026-03-27",
            })

        error = captured.exception
        self.assertEqual(error.code, "23514")
        self.assertIn("daily_checkins_assigned_mode_check", str(error))

    def test_upsert_generated_plan_surfaces_supabase_error_details(self):
        table = StubTable(
            execute_error=FakeSupabaseFailure(
                FailingResponse(
                    status_code=404,
                    payload={
                        "message": "Could not find the table 'public.generated_checkin_plans' in the schema cache",
                        "code": "PGRST205",
                        "hint": "Perhaps you meant the table 'public.daily_checkins'",
                        "details": None,
                    },
                )
            ),
        )
        repository = DailyCheckinRepository(StubSupabase(table))

        with self.assertRaises(DailyCheckinRepositoryError) as captured:
            repository.upsert_generated_plan({
                "client_id": "client-1",
                "checkin_id": "checkin-1",
                "plan_type": "training",
            })

        error = captured.exception
        self.assertEqual(error.status_code, 404)
        self.assertEqual(error.code, "PGRST205")
        self.assertIn("generated_checkin_plans", str(error))


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
            client_user_id="user-123",
        )

        response = self.client.get(
            "/api/v1/checkin/today",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["completed"])
        self.assertEqual(response.json()["current_streak"], 0)
        self.assertIsNone(response.json()["checkin"])

    def test_today_returns_current_streak_when_checkin_exists(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-complete",
            client_user_id="user-123",
        )

        response = self.client.get(
            "/api/v1/checkin/today",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["completed"])
        self.assertEqual(response.json()["current_streak"], 4)
        self.assertEqual(response.json()["checkin"]["id"], "checkin-1")

    def test_progress_returns_analytics_schema(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-complete",
            client_user_id="user-123",
        )

        response = self.client.get(
            "/api/v1/checkin/progress?as_of_date=2026-04-08",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["current_streak_days"], 5)
        self.assertIn("score_change_7d", payload)
        self.assertIn("has_enough_for_30d", payload)
        self.assertEqual(payload["recent_checkins"][0]["score"], 19)
        self.assertEqual(self.fake_service.last_progress["client_id"], "client-complete")

    def test_progress_rejects_missing_client_context(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id=None,
        )

        response = self.client.get(
            "/api/v1/checkin/progress",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "No client assignment found")

    def test_progress_requires_authentication(self):
        app.dependency_overrides.pop(require_user, None)
        app.dependency_overrides.pop(get_trainer_context, None)
        auth_client = TestClient(app)

        response = auth_client.get("/api/v1/checkin/progress")

        self.assertEqual(response.status_code, 401)

    def test_submit_returns_daily_bundle_and_passes_client_context(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-submit",
            client_user_id="user-123",
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

    def test_submit_logs_context_when_service_raises(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-fail",
            client_user_id="user-123",
        )
        app.dependency_overrides[get_daily_checkin_service] = lambda: FailingDailyCheckinService()
        failure_client = TestClient(app, raise_server_exceptions=False)

        with self.assertLogs("app.api.v1.checkin", level="ERROR") as captured:
            response = failure_client.post(
                "/api/v1/checkin",
                json={
                    "date": "2026-03-27",
                    "inputs": {
                        "sleep": 3,
                        "stress": 3,
                        "soreness": 3,
                        "nutrition": 3,
                        "motivation": 3,
                    },
                    "time_to_complete": 12,
                },
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 500)
        self.assertIn("Daily check-in submit failed unexpectedly for client_id=client-fail date=2026-03-27", captured.output[0])
        self.assertIn("database unavailable", response.json()["detail"])
        self.assertIn("RuntimeError", response.json()["detail"])

    def test_submit_rejects_client_user_mismatch(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-mismatch",
            client_user_id="someone-else",
        )

        response = self.client.post(
            "/api/v1/checkin",
            json={
                "date": "2026-03-27",
                "inputs": {
                    "sleep": 4,
                    "stress": 4,
                    "soreness": 4,
                    "nutrition": 4,
                    "motivation": 4,
                },
                "time_to_complete": 9,
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json()["detail"],
            "Authenticated user does not own the resolved client record for this check-in",
        )

    def test_submit_rejects_missing_client_owner_user(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-missing-owner",
            client_user_id=None,
        )

        response = self.client.post(
            "/api/v1/checkin",
            json={
                "date": "2026-03-27",
                "inputs": {
                    "sleep": 4,
                    "stress": 4,
                    "soreness": 4,
                    "nutrition": 4,
                    "motivation": 4,
                },
                "time_to_complete": 9,
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Client account is missing an owning user")

    def test_generate_plan_uses_client_scope_and_returns_structured_payload(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-generate",
            client_user_id="user-123",
        )

        response = self.client.post(
            "/api/v1/checkin/generate-plan",
            json={
                "checkin_id": "checkin-1",
                "plan_type": "training",
                "environment": "home_gym",
                "time_available": 30,
                "include_yesterday_context": True,
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["plan_id"], "generated-plan-1")
        self.assertEqual(response.json()["structured"]["title"], "Builder")
        self.assertEqual(self.fake_service.last_generate["client_id"], "client-generate")
        self.assertEqual(self.fake_service.last_generate["user_id"], "user-123")
        self.assertFalse(self.fake_service.last_generate["request"]["refresh_requested"])

    def test_generate_plan_passes_refresh_requested_flag(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-generate",
            client_user_id="user-123",
        )

        response = self.client.post(
            "/api/v1/checkin/generate-plan",
            json={
                "checkin_id": "checkin-1",
                "plan_type": "training",
                "environment": "home_gym",
                "time_available": 30,
                "refresh_requested": True,
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.fake_service.last_generate["request"]["refresh_requested"])

    def test_generate_plan_returns_structured_diagnostics_on_repository_failure(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-generate",
            client_user_id="user-123",
        )
        app.dependency_overrides[get_daily_checkin_service] = lambda: FailingGenerateDailyCheckinService()

        response = self.client.post(
            "/api/v1/checkin/generate-plan",
            json={
                "checkin_id": "checkin-1",
                "plan_type": "training",
                "environment": "home_gym",
                "time_available": 30,
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 500)
        payload = response.json()["detail"]
        self.assertEqual(payload["stage"], "persist_generated_plan")
        self.assertEqual(payload["code"], "PGRST205")
        self.assertIn("generated_checkin_plans", payload["detail"])
        self.assertTrue(payload["request_id"])

    def test_previous_checkin_is_loaded_from_dedicated_endpoint(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-generate",
            client_user_id="user-123",
        )

        response = self.client.get(
            "/api/v1/checkin/previous?before_date=2026-03-27",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["before_date"], "2026-03-27")
        self.assertEqual(payload["checkin"]["date"], "2026-03-26")
        self.assertEqual(payload["checkin"]["mode"], "BUILD")

    def test_log_generated_workout_uses_authenticated_user_scope(self):
        response = self.client.post(
            "/api/v1/checkin/log-workout",
            json={
                "generated_plan_id": "generated-plan-1",
                "title": "Builder",
                "elapsed_seconds": 930,
                "completed": True,
                "feel_rating": 4,
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["workout_id"], "workout-1")
        self.assertEqual(self.fake_service.last_log["user_id"], "user-123")
        self.assertEqual(self.fake_service.last_log["request"]["feel_rating"], 4)


if __name__ == "__main__":
    unittest.main()
