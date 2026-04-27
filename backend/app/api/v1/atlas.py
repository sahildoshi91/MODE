from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.config import settings
from app.core.dependencies import (
    get_atlas_review_queue_service,
    get_trainer_ai_review_queue_service,
    get_trainer_context,
)
from app.core.tenancy import TrainerContext
from app.modules.atlas.schemas import (
    AtlasAdminMeResponse,
    AtlasKnowledgeItem,
    AtlasReviewQueueItem,
    AtlasReviewQueueRejectRequest,
    AtlasReviewQueueUpdateRequest,
    TrainerAiKnowledgeItem,
    TrainerAiReviewQueueItem,
    TrainerAiReviewQueueRejectRequest,
    TrainerAiReviewQueueUpdateRequest,
)
from app.modules.atlas.service import AtlasReviewQueueService, TrainerAiReviewQueueService


router = APIRouter()


def _require_atlas_admin(user: AuthenticatedUser) -> None:
    allowlist = set(settings.atlas_admin_email_allowlist_list)
    email = str(user.email or "").strip().lower()
    if not allowlist or not email or email not in allowlist:
        raise HTTPException(status_code=403, detail="Atlas admin access denied")


def _map_value_error(exc: ValueError) -> None:
    message = str(exc)
    if "not found" in message.lower():
        raise HTTPException(status_code=404, detail=message) from exc
    raise HTTPException(status_code=400, detail=message) from exc


@router.get("/trainer-ai/review-queue", response_model=list[TrainerAiReviewQueueItem])
async def list_trainer_ai_review_queue(
    status: str | None = Query(default="pending"),
    limit: int = Query(default=100, ge=1, le=250),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAiReviewQueueService = Depends(get_trainer_ai_review_queue_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    normalized_status = status.strip().lower() if isinstance(status, str) and status.strip() else None
    if normalized_status and normalized_status not in {"pending", "approved", "rejected", "edited"}:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    return service.list_queue(trainer_id, reviewer_status=normalized_status, limit=limit)


@router.post("/trainer-ai/review-queue/{queue_id}/approve", response_model=TrainerAiKnowledgeItem)
async def approve_trainer_ai_review_queue_item(
    queue_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAiReviewQueueService = Depends(get_trainer_ai_review_queue_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    try:
        return service.approve(trainer_id, queue_id)
    except ValueError as exc:
        _map_value_error(exc)


@router.patch("/trainer-ai/review-queue/{queue_id}", response_model=TrainerAiReviewQueueItem)
async def update_trainer_ai_review_queue_item(
    queue_id: str,
    request: TrainerAiReviewQueueUpdateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAiReviewQueueService = Depends(get_trainer_ai_review_queue_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    try:
        return service.update(trainer_id, queue_id, request.model_dump(exclude_unset=True))
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/trainer-ai/review-queue/{queue_id}/reject", response_model=TrainerAiReviewQueueItem)
async def reject_trainer_ai_review_queue_item(
    queue_id: str,
    request: TrainerAiReviewQueueRejectRequest | None = None,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAiReviewQueueService = Depends(get_trainer_ai_review_queue_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    try:
        return service.reject(trainer_id, queue_id, reviewer_notes=(request.reviewer_notes if request else None))
    except ValueError as exc:
        _map_value_error(exc)


@router.delete("/trainer-ai/review-queue/{queue_id}")
async def delete_trainer_ai_review_queue_item(
    queue_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAiReviewQueueService = Depends(get_trainer_ai_review_queue_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    try:
        return service.delete_queue_item(trainer_id, queue_id)
    except ValueError as exc:
        _map_value_error(exc)


@router.get("/trainer-ai/knowledge", response_model=list[TrainerAiKnowledgeItem])
async def list_trainer_ai_knowledge(
    status: str | None = Query(default="approved"),
    limit: int = Query(default=100, ge=1, le=250),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAiReviewQueueService = Depends(get_trainer_ai_review_queue_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    normalized_status = status.strip().lower() if isinstance(status, str) and status.strip() else None
    if normalized_status and normalized_status not in {"proposed", "approved", "rejected", "retired"}:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    return service.list_knowledge(trainer_id, status=normalized_status, limit=limit)


@router.delete("/trainer-ai/knowledge/{knowledge_id}", response_model=TrainerAiKnowledgeItem)
async def delete_trainer_ai_knowledge(
    knowledge_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerAiReviewQueueService = Depends(get_trainer_ai_review_queue_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    try:
        return service.retire_knowledge(trainer_id, knowledge_id)
    except ValueError as exc:
        _map_value_error(exc)


@router.get("/admin/me", response_model=AtlasAdminMeResponse)
async def get_atlas_admin_me(user: AuthenticatedUser = CurrentUser):
    allowlist = set(settings.atlas_admin_email_allowlist_list)
    email = str(user.email or "").strip().lower() or None
    return AtlasAdminMeResponse(allowed=bool(allowlist and email and email in allowlist), email=email)


@router.get("/admin/review-queue", response_model=list[AtlasReviewQueueItem])
async def list_atlas_admin_review_queue(
    status: str | None = Query(default="pending"),
    limit: int = Query(default=100, ge=1, le=250),
    user: AuthenticatedUser = CurrentUser,
    service: AtlasReviewQueueService = Depends(get_atlas_review_queue_service),
):
    _require_atlas_admin(user)
    normalized_status = status.strip().lower() if isinstance(status, str) and status.strip() else None
    if normalized_status and normalized_status not in {"pending", "approved", "rejected", "edited"}:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    return service.list_queue(reviewer_status=normalized_status, limit=limit)


@router.patch("/admin/review-queue/{queue_id}", response_model=AtlasReviewQueueItem)
async def update_atlas_admin_review_queue_item(
    queue_id: str,
    request: AtlasReviewQueueUpdateRequest,
    user: AuthenticatedUser = CurrentUser,
    service: AtlasReviewQueueService = Depends(get_atlas_review_queue_service),
):
    _require_atlas_admin(user)
    try:
        return service.update_queue_item(queue_id, request.model_dump(exclude_unset=True))
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/admin/review-queue/{queue_id}/approve", response_model=AtlasKnowledgeItem)
async def approve_atlas_admin_review_queue_item(
    queue_id: str,
    request: AtlasReviewQueueRejectRequest | None = None,
    user: AuthenticatedUser = CurrentUser,
    service: AtlasReviewQueueService = Depends(get_atlas_review_queue_service),
):
    _require_atlas_admin(user)
    try:
        return service.approve_queue_item(queue_id, reviewer_notes=(request.reviewer_notes if request else None))
    except ValueError as exc:
        _map_value_error(exc)


@router.post("/admin/review-queue/{queue_id}/reject", response_model=AtlasReviewQueueItem)
async def reject_atlas_admin_review_queue_item(
    queue_id: str,
    request: AtlasReviewQueueRejectRequest | None = None,
    user: AuthenticatedUser = CurrentUser,
    service: AtlasReviewQueueService = Depends(get_atlas_review_queue_service),
):
    _require_atlas_admin(user)
    try:
        return service.reject_queue_item(queue_id, reviewer_notes=(request.reviewer_notes if request else None))
    except ValueError as exc:
        _map_value_error(exc)


@router.get("/admin/knowledge", response_model=list[AtlasKnowledgeItem])
async def list_atlas_admin_knowledge(
    status: str | None = Query(default="approved"),
    limit: int = Query(default=100, ge=1, le=250),
    user: AuthenticatedUser = CurrentUser,
    service: AtlasReviewQueueService = Depends(get_atlas_review_queue_service),
):
    _require_atlas_admin(user)
    normalized_status = status.strip().lower() if isinstance(status, str) and status.strip() else None
    if normalized_status and normalized_status not in {"proposed", "approved", "rejected", "retired"}:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    return service.list_knowledge(status=normalized_status, limit=limit)
