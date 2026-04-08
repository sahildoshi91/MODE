import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_daily_checkin_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.modules.daily_checkins.repository import DailyCheckinRepositoryError
from app.modules.daily_checkins.schemas import (
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
):
    client_id = _resolve_client_id(trainer_context)
    try:
        return service.generate_plan(client_id=client_id, user_id=user.id, request=request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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
