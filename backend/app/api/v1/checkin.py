from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.dependencies import get_daily_checkin_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.modules.daily_checkins.schemas import DailyCheckinResult, DailyCheckinStatusResponse, SubmitDailyCheckinRequest
from app.modules.daily_checkins.service import DailyCheckinService


router = APIRouter()


def _resolve_client_id(trainer_context: TrainerContext) -> str:
    if not trainer_context.client_id:
        raise HTTPException(status_code=400, detail="No client assignment found")
    return trainer_context.client_id


@router.get("/today", response_model=DailyCheckinStatusResponse)
async def get_today_checkin(
    request_date: date | None = None,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    client_id = _resolve_client_id(trainer_context)
    today = request_date or datetime.now(timezone.utc).date()
    return service.get_status(client_id, today)


@router.post("", response_model=DailyCheckinResult)
async def submit_daily_checkin(
    request: SubmitDailyCheckinRequest,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: DailyCheckinService = Depends(get_daily_checkin_service),
):
    client_id = _resolve_client_id(trainer_context)
    return service.submit_checkin(
        client_id=client_id,
        checkin_date=request.date,
        inputs=request.inputs,
        time_to_complete=request.time_to_complete,
    )
