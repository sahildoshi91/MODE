import logging
from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_ai_feedback_logger_service, get_daily_checkin_service, get_trainer_context
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
    if trainer_context.client_user_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="Authenticated user does not own the resolved client record for this check-in",
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
    code: str | None = None,
    hint: str | None = None,
) -> dict:
    payload = {
        "detail": detail,
        "stage": stage,
        "request_id": request_id,
    }
    if code:
        payload["code"] = code
    if hint:
        payload["hint"] = hint
    return payload


@router.get("/today", response_model=DailyCheckinStatusResponse)
async def get_today_checkin(
    request_date: date | None = None,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    client_id = _resolve_client_id(trainer_context)
    today = request_date or datetime.now(timezone.utc).date()
    return service.get_status(client_id, today)


@router.get("/previous", response_model=PreviousCheckinResponse)
async def get_previous_checkin(
    before_date: date | None = None,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    client_id = _resolve_client_id(trainer_context)
    target_date = before_date or datetime.now(timezone.utc).date()
    summary = service.get_previous_checkin_summary(client_id, target_date)
    return PreviousCheckinResponse(before_date=target_date, checkin=summary)


@router.get("/progress", response_model=CheckinProgressResponse)
async def get_checkin_progress(
    as_of_date: date | None = None,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    client_id = _resolve_client_id(trainer_context)
    target_date = as_of_date or datetime.now(timezone.utc).date()
    return service.get_progress_analytics(client_id, target_date)


@router.post("", response_model=DailyCheckinResult)
async def submit_daily_checkin(
    request: SubmitDailyCheckinRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    _validate_client_write_access(user, trainer_context)
    client_id = trainer_context.client_id
    logger.info(
        "Daily check-in submit starting for client_id=%s date=%s",
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
            "Daily check-in submit failed for client_id=%s date=%s status=%s code=%s hint=%s details=%s",
            client_id,
            request.date.isoformat(),
            exc.status_code,
            exc.code,
            exc.hint,
            exc.details,
            extra={
                "client_id": client_id,
                "checkin_date": request.date.isoformat(),
                "supabase_status_code": exc.status_code,
                "supabase_code": exc.code,
                "supabase_hint": exc.hint,
                "supabase_details": exc.details,
            },
        )
        detail_parts = [str(exc)]
        if exc.code:
            detail_parts.append(f"code={exc.code}")
        if exc.hint:
            detail_parts.append(f"hint={exc.hint}")
        if exc.details:
            detail_parts.append(f"details={exc.details}")
        raise HTTPException(
            status_code=502 if exc.status_code and exc.status_code >= 500 else 500,
            detail=" | ".join(detail_parts),
        ) from exc
    except Exception as exc:
        detail = _format_unexpected_submit_error(exc)
        logger.exception(
            "Daily check-in submit failed unexpectedly for client_id=%s date=%s exception_type=%s detail=%s",
            client_id,
            request.date.isoformat(),
            exc.__class__.__name__,
            detail,
            extra={
                "client_id": client_id,
                "checkin_date": request.date.isoformat(),
                "exception_type": exc.__class__.__name__,
            },
        )
        raise HTTPException(status_code=500, detail=detail) from exc


@router.post("/generate-plan", response_model=GenerateCheckinPlanResponse)
async def generate_checkin_plan(
    request: GenerateCheckinPlanRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
    ai_feedback_logger_service: AIFeedbackService = Depends(get_ai_feedback_logger_service),
):
    client_id = _resolve_client_id(trainer_context)
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
                ai_feedback_logger_service.log_generated_output(
                    tenant_id=trainer_context.tenant_id,
                    trainer_id=trainer_context.trainer_id,
                    client_id=client_id,
                    source_type="generated_checkin_plan",
                    source_ref_id=plan_id,
                    output_text=response_payload.get("content") if isinstance(response_payload, dict) else None,
                    output_json={
                        "plan_type": plan_type_value,
                        "structured": response_payload.get("structured"),
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
        raise HTTPException(
            status_code=400,
            detail=_build_generate_plan_error_payload(
                detail=str(exc),
                stage="validation",
                request_id=request_id,
            ),
        ) from exc
    except DailyCheckinRepositoryError as exc:
        detail_parts = [str(exc)]
        if exc.details:
            detail_parts.append(f"details={exc.details}")
        detail = " | ".join(detail_parts)

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
                detail=detail,
                stage="persist_generated_plan",
                request_id=request_id,
                code=exc.code,
                hint=exc.hint,
            ),
        ) from exc
    except Exception as exc:
        detail = f"Unexpected generate-plan failure ({exc.__class__.__name__})"
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
                detail=detail,
                stage="generate_plan_unexpected",
                request_id=request_id,
            ),
        ) from exc


@router.post("/log-workout", response_model=LogGeneratedWorkoutResponse)
async def log_generated_workout(
    request: LogGeneratedWorkoutRequest,
    user: AuthenticatedUser = CurrentUser,
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    try:
        return service.log_generated_workout(user.id, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
