import logging
from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.authorization import authorize_actor_access
from app.core.dependencies import get_ai_feedback_logger_service, get_daily_checkin_service, get_trainer_context
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.modules.ai_feedback.service import AIFeedbackService
from app.modules.daily_checkins.repository import DailyCheckinRepositoryError
from app.modules.daily_checkins.schemas import (
    CheckinProgressResponse,
    DailyCheckinResult,
    DailyCheckinStatusResponse,
    GenerateCheckinPlanRequest,
    GenerateCheckinPlanResponse,
    LogGeneratedWorkoutRequest,
    LogGeneratedWorkoutResponse,
    PreviousCheckinResponse,
    SubmitDailyCheckinRequest,
)
from app.modules.daily_checkins.service import DailyCheckinService


router = APIRouter()
logger = logging.getLogger(__name__)


def _resolve_client_id(trainer_context: TrainerContext) -> str:
    if not trainer_context.client_id:
        raise HTTPException(status_code=400, detail="No client assignment found")
    return trainer_context.client_id


def _validate_client_write_access(user: AuthenticatedUser, trainer_context: TrainerContext) -> None:
    if not trainer_context.client_id:
        raise HTTPException(status_code=400, detail="No client assignment found")
    if not trainer_context.client_user_id:
        raise HTTPException(status_code=400, detail="Client account is missing an owning user")
    authorize_actor_access(
        actor=user,
        trainer_id=trainer_context.trainer_id,
        client_id=trainer_context.client_id,
        resource_owner={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": trainer_context.client_id,
            "client_user_id": trainer_context.client_user_id,
        },
        require_client_owner=True,
        expected_tenant_id=trainer_context.tenant_id,
    )


def _format_unexpected_submit_error(exc: Exception) -> str:
    message = str(exc).strip()
    if message:
        return f"Unexpected check-in save failure ({exc.__class__.__name__}): {message}"
    return f"Unexpected check-in save failure ({exc.__class__.__name__})"


def _build_generate_plan_error_payload(
    *,
    detail: str,
    stage: str,
    request_id: str,
) -> dict:
    return {
        "detail": detail,
        "stage": stage,
        "request_id": request_id,
    }


def _normalize_preview_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _safe_positive_int(value: object) -> int:
    try:
        parsed = int(float(value))
        return parsed if parsed > 0 else 0
    except Exception:
        return 0


def _derive_plan_preview(
    *,
    structured_payload: dict | None,
    plan_type_value: str | None,
) -> tuple[str | None, str | None]:
    if not isinstance(structured_payload, dict):
        plan_type_label = _normalize_preview_text(plan_type_value).replace("_", " ").strip()
        if plan_type_label:
            return f"{plan_type_label.title()} Plan", f"{plan_type_label.title()} plan ready for review."
        return None, None

    headline = (
        _normalize_preview_text(structured_payload.get("headline"))
        or _normalize_preview_text(structured_payload.get("title"))
    ) or None
    summary = (
        _normalize_preview_text(structured_payload.get("summary"))
        or _normalize_preview_text(structured_payload.get("description"))
    ) or None

    meals = structured_payload.get("meals")
    if not summary and isinstance(meals, list):
        total_calories = _safe_positive_int(
            structured_payload.get("totalCalories")
            or structured_payload.get("total_calories")
            or structured_payload.get("calories")
        )
        total_protein = _safe_positive_int(
            structured_payload.get("totalProtein")
            or structured_payload.get("total_protein")
            or structured_payload.get("protein")
        )
        if total_calories == 0 and total_protein == 0:
            for meal in meals:
                if not isinstance(meal, dict):
                    continue
                total_calories += _safe_positive_int(meal.get("totalCalories"))
                total_protein += _safe_positive_int(meal.get("totalProtein"))
        meal_count = len([meal for meal in meals if isinstance(meal, dict)])
        if meal_count > 0:
            summary = (
                f"{meal_count} meals | {total_calories} kcal | {total_protein}g protein"
                if (total_calories > 0 or total_protein > 0)
                else f"{meal_count} meals planned"
            )

    exercises = structured_payload.get("exercises")
    if not summary and isinstance(exercises, list):
        exercise_count = len([item for item in exercises if isinstance(item, dict)])
        if exercise_count > 0:
            summary = f"{exercise_count} exercises planned"

    blocks = structured_payload.get("blocks")
    if not summary and isinstance(blocks, list):
        block_count = len([item for item in blocks if isinstance(item, dict)])
        if block_count > 0:
            summary = f"{block_count} workout blocks planned"

    if not headline:
        plan_type_label = _normalize_preview_text(plan_type_value).replace("_", " ").strip()
        headline = f"{plan_type_label.title()} Plan" if plan_type_label else "Generated Plan"
    if not summary:
        summary = "Plan ready for review."
    return headline, summary


@router.get("/today", response_model=DailyCheckinStatusResponse)
async def get_today_checkin(
    request_date: date | None = None,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    _validate_client_write_access(user, trainer_context)
    client_id = _resolve_client_id(trainer_context)
    today = request_date or datetime.now(timezone.utc).date()
    return service.get_status(client_id, today)


@router.get("/previous", response_model=PreviousCheckinResponse)
async def get_previous_checkin(
    before_date: date | None = None,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    _validate_client_write_access(user, trainer_context)
    client_id = _resolve_client_id(trainer_context)
    target_date = before_date or datetime.now(timezone.utc).date()
    summary = service.get_previous_checkin_summary(client_id, target_date)
    return PreviousCheckinResponse(before_date=target_date, checkin=summary)


@router.get("/progress", response_model=CheckinProgressResponse)
async def get_checkin_progress(
    as_of_date: date | None = None,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    _validate_client_write_access(user, trainer_context)
    client_id = _resolve_client_id(trainer_context)
    target_date = as_of_date or datetime.now(timezone.utc).date()
    return service.get_progress_analytics(client_id, target_date)


@router.post("", response_model=DailyCheckinResult)
async def submit_daily_checkin(
    request: SubmitDailyCheckinRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    _validate_client_write_access(user, trainer_context)
    enforce_rate_limit(
        group="expensive_ai",
        user=user,
        request=http_request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": trainer_context.client_id,
        },
    )
    client_id = trainer_context.client_id
    request_id = uuid4().hex[:12]
    logger.info(
        "Daily check-in submit starting request_id=%s client_id=%s date=%s",
        request_id,
        client_id,
        request.date.isoformat(),
    )
    try:
        result = service.submit_checkin(
            client_id=client_id,
            checkin_date=request.date,
            inputs=request.inputs,
            time_to_complete=request.time_to_complete,
        )
        logger.info(
            "Daily check-in submit service completed for client_id=%s date=%s checkin_id=%s",
            client_id,
            request.date.isoformat(),
            result.id,
        )
        logger.info(
            "Daily check-in submit returning response for client_id=%s date=%s",
            client_id,
            request.date.isoformat(),
        )
        return result
    except DailyCheckinRepositoryError as exc:
        logger.exception(
            "Daily check-in submit failed request_id=%s client_id=%s date=%s status=%s code=%s hint=%s details=%s",
            request_id,
            client_id,
            request.date.isoformat(),
            exc.status_code,
            exc.code,
            exc.hint,
            exc.details,
            extra={
                "request_id": request_id,
                "client_id": client_id,
                "checkin_date": request.date.isoformat(),
                "supabase_status_code": exc.status_code,
                "supabase_code": exc.code,
                "supabase_hint": exc.hint,
                "supabase_details": exc.details,
            },
        )
        raise HTTPException(
            status_code=502 if exc.status_code and exc.status_code >= 500 else 500,
            detail={
                "detail": "Daily check-in save failed",
                "stage": "persist_checkin",
                "request_id": request_id,
            },
        ) from exc
    except Exception as exc:
        detail = _format_unexpected_submit_error(exc)
        logger.exception(
            "Daily check-in submit failed unexpectedly request_id=%s client_id=%s date=%s exception_type=%s detail=%s",
            request_id,
            client_id,
            request.date.isoformat(),
            exc.__class__.__name__,
            detail,
            extra={
                "request_id": request_id,
                "client_id": client_id,
                "checkin_date": request.date.isoformat(),
                "exception_type": exc.__class__.__name__,
            },
        )
        raise HTTPException(
            status_code=500,
            detail={
                "detail": "Unexpected check-in save failure",
                "stage": "submit_checkin_unexpected",
                "request_id": request_id,
            },
        ) from exc


@router.post("/generate-plan", response_model=GenerateCheckinPlanResponse)
async def generate_checkin_plan(
    request: GenerateCheckinPlanRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
    ai_feedback_logger_service: AIFeedbackService = Depends(get_ai_feedback_logger_service),
):
    _validate_client_write_access(user, trainer_context)
    client_id = _resolve_client_id(trainer_context)
    enforce_rate_limit(
        group="chat",
        user=user,
        request=http_request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": client_id,
        },
    )
    request_id = uuid4().hex[:12]
    try:
        response = service.generate_plan(client_id=client_id, user_id=user.id, request=request)
        response_payload = (
            response.model_dump()
            if hasattr(response, "model_dump")
            else (response if isinstance(response, dict) else None)
        )
        if trainer_context.tenant_id and trainer_context.trainer_id:
            try:
                plan_id = response_payload.get("plan_id") if isinstance(response_payload, dict) else None
                if not isinstance(plan_id, str) or not plan_id.strip():
                    return response
                plan_type = response_payload.get("plan_type")
                if hasattr(plan_type, "value"):
                    plan_type_value = plan_type.value
                else:
                    plan_type_value = str(plan_type) if plan_type is not None else None
                structured_payload = response_payload.get("structured") if isinstance(response_payload, dict) else None
                headline, summary = _derive_plan_preview(
                    structured_payload=structured_payload if isinstance(structured_payload, dict) else None,
                    plan_type_value=plan_type_value,
                )
                ai_feedback_logger_service.log_generated_output(
                    tenant_id=trainer_context.tenant_id,
                    trainer_id=trainer_context.trainer_id,
                    client_id=client_id,
                    source_type="generated_checkin_plan",
                    source_ref_id=plan_id,
                    output_text=response_payload.get("content") if isinstance(response_payload, dict) else None,
                    output_json={
                        "plan_type": plan_type_value,
                        "structured": structured_payload,
                        "headline": headline,
                        "summary": summary,
                        "request_fingerprint": response_payload.get("request_fingerprint"),
                        "revision_number": response_payload.get("revision_number"),
                        "workout_context": response_payload.get("workout_context"),
                    },
                    generation_metadata={
                        "producer": "daily_checkin_generate_plan",
                        "generation_strategy": "llm_with_fallback",
                        "generated_at": datetime.now(timezone.utc).isoformat(),
                        "request_id": request_id,
                        "plan_type": request.plan_type.value,
                        "refresh_requested": request.refresh_requested,
                        "include_yesterday_context": request.include_yesterday_context,
                        "environment": request.environment.value if request.environment else None,
                        "time_available": request.time_available,
                    },
                )
            except Exception:
                logger.exception(
                    "Failed to log generated checkin plan output request_id=%s client_id=%s plan_id=%s",
                    request_id,
                    client_id,
                    response_payload.get("plan_id") if isinstance(response_payload, dict) else None,
                )
        return response
    except ValueError as exc:
        logger.warning(
            "Generate-plan validation failed for client_id=%s checkin_id=%s request_id=%s detail=%s",
            client_id,
            request.checkin_id,
            request_id,
            str(exc),
        )
        raise HTTPException(
            status_code=400,
            detail=_build_generate_plan_error_payload(
                detail="Invalid generate-plan request",
                stage="validation",
                request_id=request_id,
            ),
        ) from exc
    except DailyCheckinRepositoryError as exc:
        logger.exception(
            "Generate-plan persistence failed for client_id=%s checkin_id=%s request_id=%s status=%s code=%s hint=%s details=%s",
            client_id,
            request.checkin_id,
            request_id,
            exc.status_code,
            exc.code,
            exc.hint,
            exc.details,
            extra={
                "client_id": client_id,
                "checkin_id": request.checkin_id,
                "request_id": request_id,
                "supabase_status_code": exc.status_code,
                "supabase_code": exc.code,
                "supabase_hint": exc.hint,
                "supabase_details": exc.details,
            },
        )
        raise HTTPException(
            status_code=502 if exc.status_code and exc.status_code >= 500 else 500,
            detail=_build_generate_plan_error_payload(
                detail="Generated plan persistence failed",
                stage="persist_generated_plan",
                request_id=request_id,
            ),
        ) from exc
    except Exception as exc:
        logger.exception(
            "Generate-plan failed unexpectedly for client_id=%s checkin_id=%s request_id=%s exception_type=%s",
            client_id,
            request.checkin_id,
            request_id,
            exc.__class__.__name__,
            extra={
                "client_id": client_id,
                "checkin_id": request.checkin_id,
                "request_id": request_id,
                "exception_type": exc.__class__.__name__,
            },
        )
        raise HTTPException(
            status_code=500,
            detail=_build_generate_plan_error_payload(
                detail="Unexpected generate-plan failure",
                stage="generate_plan_unexpected",
                request_id=request_id,
            ),
        ) from exc


@router.post("/log-workout", response_model=LogGeneratedWorkoutResponse)
async def log_generated_workout(
    request: LogGeneratedWorkoutRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    _validate_client_write_access(user, trainer_context)
    client_id = trainer_context.client_id
    enforce_rate_limit(
        group="chat",
        user=user,
        request=http_request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": client_id,
        },
    )
    try:
        return service.log_generated_workout(user.id, request, client_id=client_id)
    except ValueError as exc:
        logger.warning(
            "Log-generated-workout validation failed user_id=%s generated_plan_id=%s detail=%s",
            user.id,
            request.generated_plan_id,
            str(exc),
        )
        raise HTTPException(status_code=400, detail="Invalid log-workout request") from exc
