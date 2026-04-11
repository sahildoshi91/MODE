from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_context, get_trainer_home_service
from app.core.tenancy import TrainerContext
from app.modules.trainer_home.schemas import TrainerHomeTodayResponse
from app.modules.trainer_home.service import TrainerHomeService


router = APIRouter()


def _is_trainer_actor(user: AuthenticatedUser, trainer_context: TrainerContext) -> bool:
    return bool(
        trainer_context.trainer_id
        and trainer_context.trainer_user_id
        and trainer_context.trainer_user_id == user.id
    )


@router.get("/today", response_model=TrainerHomeTodayResponse)
async def get_trainer_home_today(
    request_date: date | None = Query(default=None, alias="date"),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerHomeService = Depends(get_trainer_home_service),
):
    if not _is_trainer_actor(user, trainer_context):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Trainer-only endpoint",
        )

    target_date = request_date or datetime.now(timezone.utc).date()
    try:
        return service.build_today_dashboard(trainer_context, target_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
