from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_context, get_trainer_home_service
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.modules.trainer_home.schemas import (
    TrainerHomeCommandCenterResponse,
    TrainerHomeTodayResponse,
)
from app.modules.trainer_home.service import TrainerHomeService


router = APIRouter()


def _enforce_trainer_home_limit(
    *,
    user: AuthenticatedUser,
    request: Request,
    trainer_context: TrainerContext,
) -> None:
    enforce_rate_limit(
        group="trainer_assistant",
        user=user,
        request=request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": trainer_context.client_id,
        },
    )


@router.get("/today", response_model=TrainerHomeTodayResponse)
async def get_trainer_home_today(
    http_request: Request,
    request_date: date | None = Query(default=None, alias="date"),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerHomeService = Depends(get_trainer_home_service),
):
    require_trainer_actor(user, trainer_context)
    _enforce_trainer_home_limit(user=user, request=http_request, trainer_context=trainer_context)

    target_date = request_date or datetime.now(timezone.utc).date()
    try:
        return service.build_today_dashboard(trainer_context, target_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid trainer home request") from exc


@router.get("/command-center", response_model=TrainerHomeCommandCenterResponse)
async def get_trainer_command_center(
    http_request: Request,
    request_date: date | None = Query(default=None, alias="date"),
    refresh_talking_points: bool = Query(default=False),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerHomeService = Depends(get_trainer_home_service),
):
    require_trainer_actor(user, trainer_context)
    _enforce_trainer_home_limit(user=user, request=http_request, trainer_context=trainer_context)

    target_date = request_date or datetime.now(timezone.utc).date()
    try:
        return service.build_command_center(
            trainer_context,
            target_date,
            refresh_talking_points=refresh_talking_points,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid trainer home request") from exc
