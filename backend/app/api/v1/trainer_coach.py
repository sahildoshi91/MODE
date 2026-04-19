from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_coach_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.modules.trainer_coach.schemas import (
    CoachCreateEventRequest,
    CoachEventsResponse,
    CoachQueueApproveRequest,
    CoachQueueEditRequest,
    CoachQueueMutationResponse,
    CoachQueueRejectRequest,
    CoachQueueResponse,
    CoachSystemEventRecord,
    CoachWorkspaceResponse,
)
from app.modules.trainer_coach.service import TrainerCoachService


router = APIRouter()


def _map_value_error(exc: ValueError) -> None:
    message = str(exc)
    normalized = message.strip().lower()
    if normalized in {
        "output not found",
        "conversation not found",
        "client not found for trainer",
    }:
        raise HTTPException(status_code=404, detail=message) from exc
    raise HTTPException(status_code=400, detail=message) from exc


@router.get("/workspace", response_model=CoachWorkspaceResponse)
async def get_trainer_coach_workspace(
    request_date: date | None = Query(default=None, alias="date"),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerCoachService = Depends(get_trainer_coach_service),
):
    require_trainer_actor(user, trainer_context)
    resolved_date = request_date or datetime.now(timezone.utc).date()
    try:
        return service.build_workspace(trainer_context, target_date=resolved_date)
    except ValueError as exc:
        _map_value_error(exc)


@router.get("/queue", response_model=CoachQueueResponse)
async def get_trainer_coach_queue(
    request_date: date | None = Query(default=None, alias="date"),
    limit: int = Query(default=100, ge=1, le=250),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerCoachService = Depends(get_trainer_coach_service),
):
    require_trainer_actor(user, trainer_context)
    resolved_date = request_date or datetime.now(timezone.utc).date()
    try:
        return service.list_queue(trainer_context, target_date=resolved_date, limit=limit)
    except ValueError as exc:
        _map_value_error(exc)


@router.get("/events", response_model=CoachEventsResponse)
async def get_trainer_coach_events(
    limit: int = Query(default=80, ge=1, le=250),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerCoachService = Depends(get_trainer_coach_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.list_events(trainer_context, limit=limit)
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/events", response_model=CoachSystemEventRecord)
async def create_trainer_coach_event(
    request: CoachCreateEventRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerCoachService = Depends(get_trainer_coach_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.create_event(trainer_context, request)
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/queue/{output_id}/approve", response_model=CoachQueueMutationResponse)
async def approve_trainer_coach_queue_item(
    output_id: str,
    request: CoachQueueApproveRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerCoachService = Depends(get_trainer_coach_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.approve_queue_item(trainer_context, output_id, request)
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/queue/{output_id}/edit", response_model=CoachQueueMutationResponse)
async def edit_trainer_coach_queue_item(
    output_id: str,
    request: CoachQueueEditRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerCoachService = Depends(get_trainer_coach_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.edit_queue_item(trainer_context, output_id, request)
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/queue/{output_id}/reject", response_model=CoachQueueMutationResponse)
async def reject_trainer_coach_queue_item(
    output_id: str,
    request: CoachQueueRejectRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerCoachService = Depends(get_trainer_coach_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.reject_queue_item(trainer_context, output_id, request)
    except ValueError as exc:
        _map_value_error(exc)
