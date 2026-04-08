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
        self._pending_upsert = False

    def upsert(self, payload, on_conflict=None):
        self.last_upsert_payload = payload
        self._pending_upsert = True
        return self

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
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


class DailyCheckinRepositoryTests(unittest.TestCase):
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
        self.assertIsNone(response.json()["checkin"])

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
