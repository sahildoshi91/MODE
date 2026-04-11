from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_client_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.modules.trainer_clients.schemas import (
    TrainerAIContextResponse,
    TrainerClientDetailResponse,
    TrainerMemoryCreateRequest,
    TrainerMemoryRecord,
    TrainerMemoryUpdateRequest,
)
from app.modules.trainer_clients.service import TrainerClientService


router = APIRouter()

def _handle_service_value_error(exc: ValueError) -> None:
    detail = str(exc)
    if detail.lower() in {"client not found for trainer", "memory not found"}:
        raise HTTPException(status_code=404, detail=detail) from exc
    raise HTTPException(status_code=400, detail=detail) from exc


@router.get("/{client_id}/detail", response_model=TrainerClientDetailResponse)
async def get_trainer_client_detail(
    client_id: str,
    request_date: date | None = Query(default=None, alias="date"),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    target_date = request_date or datetime.now(timezone.utc).date()
    try:
        return service.get_client_detail(
            trainer_context,
            client_id,
            target_date=target_date,
        )
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.get("/{client_id}/memory", response_model=list[TrainerMemoryRecord])
async def list_trainer_client_memory(
    client_id: str,
    include_archived: bool = Query(default=False),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.list_memory(
            trainer_context,
            client_id,
            include_archived=include_archived,
        )
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.post("/{client_id}/memory", response_model=TrainerMemoryRecord)
async def create_trainer_client_memory(
    client_id: str,
    request: TrainerMemoryCreateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.create_memory(trainer_context, client_id, request)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.patch("/{client_id}/memory/{memory_id}", response_model=TrainerMemoryRecord)
async def patch_trainer_client_memory(
    client_id: str,
    memory_id: str,
    request: TrainerMemoryUpdateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.update_memory(trainer_context, client_id, memory_id, request)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.delete("/{client_id}/memory/{memory_id}", response_model=TrainerMemoryRecord)
async def archive_trainer_client_memory(
    client_id: str,
    memory_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.archive_memory(trainer_context, client_id, memory_id)
    except ValueError as exc:
        _handle_service_value_error(exc)


@router.get("/{client_id}/ai-context", response_model=TrainerAIContextResponse)
async def get_trainer_client_ai_context(
    client_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.get_ai_context(trainer_context, client_id)
    except ValueError as exc:
        _handle_service_value_error(exc)
