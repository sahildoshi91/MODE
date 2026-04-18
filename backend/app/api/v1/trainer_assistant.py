from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.config import settings
from app.core.dependencies import get_trainer_assistant_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.modules.trainer_assistant.schemas import (
    TrainerAssistantBackgroundRunRequest,
    TrainerAssistantBackgroundRunResponse,
    TrainerAssistantBootstrapResponse,
    TrainerAssistantDraftApproveRequest,
    TrainerAssistantDraftEditRequest,
    TrainerAssistantDraftMutationResponse,
    TrainerAssistantDraftRejectRequest,
    TrainerAssistantExecuteRequest,
    TrainerAssistantExecuteResponse,
)
from app.modules.trainer_assistant.service import TrainerAssistantService


router = APIRouter()


def _ensure_enabled() -> None:
    if not settings.trainer_assistant_v1_enabled:
        raise HTTPException(status_code=404, detail="Not found")


def _map_value_error(exc: ValueError) -> None:
    detail = str(exc)
    normalized = detail.strip().lower()
    if normalized in {
        "draft not found",
        "client not found for trainer",
    }:
        raise HTTPException(status_code=404, detail=detail) from exc
    raise HTTPException(status_code=400, detail=detail) from exc


@router.get("/bootstrap", response_model=TrainerAssistantBootstrapResponse)
async def bootstrap_trainer_assistant(
    client_id: str | None = Query(default=None),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAssistantService = Depends(get_trainer_assistant_service),
):
    _ensure_enabled()
    require_trainer_actor(user, trainer_context)
    try:
        return service.bootstrap(
            trainer_context,
            preferred_client_id=client_id,
            target_date=datetime.now(timezone.utc).date(),
        )
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/execute", response_model=TrainerAssistantExecuteResponse)
async def execute_trainer_assistant(
    request: TrainerAssistantExecuteRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAssistantService = Depends(get_trainer_assistant_service),
):
    _ensure_enabled()
    require_trainer_actor(user, trainer_context)
    try:
        return service.execute(trainer_context, request)
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/drafts/{draft_id}/edit", response_model=TrainerAssistantDraftMutationResponse)
async def edit_trainer_assistant_draft(
    draft_id: str,
    request: TrainerAssistantDraftEditRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAssistantService = Depends(get_trainer_assistant_service),
):
    _ensure_enabled()
    require_trainer_actor(user, trainer_context)
    try:
        return service.edit_draft(trainer_context, draft_id, request)
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/drafts/{draft_id}/approve", response_model=TrainerAssistantDraftMutationResponse)
async def approve_trainer_assistant_draft(
    draft_id: str,
    request: TrainerAssistantDraftApproveRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAssistantService = Depends(get_trainer_assistant_service),
):
    _ensure_enabled()
    require_trainer_actor(user, trainer_context)
    try:
        return service.approve_draft(trainer_context, draft_id, request)
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/drafts/{draft_id}/reject", response_model=TrainerAssistantDraftMutationResponse)
async def reject_trainer_assistant_draft(
    draft_id: str,
    request: TrainerAssistantDraftRejectRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAssistantService = Depends(get_trainer_assistant_service),
):
    _ensure_enabled()
    require_trainer_actor(user, trainer_context)
    try:
        return service.reject_draft(trainer_context, draft_id, request)
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/background/run", response_model=TrainerAssistantBackgroundRunResponse)
async def run_trainer_assistant_background(
    request: TrainerAssistantBackgroundRunRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAssistantService = Depends(get_trainer_assistant_service),
):
    _ensure_enabled()
    require_trainer_actor(user, trainer_context)
    try:
        return service.run_background(trainer_context, request)
    except ValueError as exc:
        _map_value_error(exc)
