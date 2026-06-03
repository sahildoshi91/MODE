import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from supabase import Client

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.config import settings
from app.core.dependencies import (
    get_internal_onboarding_service,
    get_request_scoped_supabase_client,
    get_trainer_context,
    invalidate_trainer_context_cache,
)
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext, resolve_trainer_context
from app.modules.conversation.cache import invalidate_chat_context
from app.modules.onboarding.service import OnboardingService, OnboardingServiceError


router = APIRouter()
logger = logging.getLogger(__name__)


class TrainerOption(BaseModel):
    id: str
    display_name: str


class TrainerAssignmentStatus(BaseModel):
    needs_assignment: bool
    assigned_trainer_id: str | None = None
    assigned_trainer_display_name: str | None = None
    viewer_role: Literal["trainer", "client", "unassigned"] = "unassigned"
    viewer_display_name: str | None = None
    trainer_onboarding_completed: bool = False
    trainer_onboarding_status: Literal[
        "not_started",
        "in_progress",
        "calibration_pending",
        "completed",
    ] = "not_started"
    trainer_onboarding_completed_steps: int = 0
    trainer_onboarding_total_steps: int = 8
    trainer_onboarding_last_step: str | None = None
    available_trainers: list[TrainerOption] = Field(default_factory=list)
    available_trainers_count: int = 0
    scope: Literal["tenant", "global_fallback"] = "global_fallback"


class TrainerAssignmentRequest(BaseModel):
    trainer_id: str


class TrainerInviteCodeAssignmentRequest(BaseModel):
    invite_code: str = Field(min_length=3, max_length=64)


def _resolve_scope(trainer_context: TrainerContext) -> Literal["tenant", "global_fallback"]:
    return "tenant" if trainer_context.tenant_id else "global_fallback"


def _email_local_part(email: str | None) -> str | None:
    if not email:
        return None
    local_part, _, _domain = email.partition("@")
    return local_part or email


def _resolve_viewer_role(
    *,
    trainer_context: TrainerContext,
    user: AuthenticatedUser,
) -> Literal["trainer", "client", "unassigned"]:
    if trainer_context.trainer_id and trainer_context.trainer_user_id == user.id:
        return "trainer"
    if trainer_context.client_id:
        return "client"
    return "unassigned"


def _resolve_viewer_display_name(
    *,
    trainer_context: TrainerContext,
    user: AuthenticatedUser,
    viewer_role: Literal["trainer", "client", "unassigned"],
) -> str | None:
    if viewer_role == "trainer":
        return trainer_context.trainer_display_name or _email_local_part(user.email)
    return _email_local_part(user.email)


def _list_active_trainers(*, supabase: Client, tenant_id: str | None) -> list[dict]:
    if not tenant_id and not settings.trainer_assignment_global_fallback_enabled:
        return []
    query = (
        supabase
        .table("trainers")
        .select("id, tenant_id, user_id, display_name, is_active")
        .eq("is_active", True)
    )
    if tenant_id:
        query = query.eq("tenant_id", tenant_id)
    response = query.order("display_name").order("id").execute()
    return response.data or []


def _build_status_response(
    trainer_context: TrainerContext,
    user: AuthenticatedUser,
    available_trainers: list[dict] | None = None,
) -> TrainerAssignmentStatus:
    needs_assignment = not trainer_context.trainer_id
    scoped_trainers = (available_trainers or []) if needs_assignment else []
    viewer_role = _resolve_viewer_role(trainer_context=trainer_context, user=user)
    total_steps = max(1, int(trainer_context.trainer_onboarding_total_steps or 8))
    completed_steps = max(0, int(trainer_context.trainer_onboarding_completed_steps or 0))
    onboarding_status = str(
        trainer_context.trainer_onboarding_status
        or ("completed" if trainer_context.trainer_onboarding_completed else "not_started")
    )
    if onboarding_status not in {"not_started", "in_progress", "calibration_pending", "completed"}:
        onboarding_status = "completed" if trainer_context.trainer_onboarding_completed else "not_started"
    if trainer_context.trainer_onboarding_completed:
        onboarding_status = "completed"
        completed_steps = max(completed_steps, total_steps)
    return TrainerAssignmentStatus(
        needs_assignment=needs_assignment,
        assigned_trainer_id=trainer_context.trainer_id,
        assigned_trainer_display_name=trainer_context.trainer_display_name,
        viewer_role=viewer_role,
        viewer_display_name=_resolve_viewer_display_name(
            trainer_context=trainer_context,
            user=user,
            viewer_role=viewer_role,
        ),
        trainer_onboarding_completed=bool(trainer_context.trainer_onboarding_completed),
        trainer_onboarding_status=onboarding_status,
        trainer_onboarding_completed_steps=min(total_steps, completed_steps),
        trainer_onboarding_total_steps=total_steps,
        trainer_onboarding_last_step=trainer_context.trainer_onboarding_last_step,
        available_trainers=[
            TrainerOption(id=trainer["id"], display_name=trainer["display_name"])
            for trainer in scoped_trainers
        ],
        available_trainers_count=len(scoped_trainers),
        scope=_resolve_scope(trainer_context),
    )


def _invalidate_assignment_contexts(user_id: str, rows: list[dict]) -> None:
    invalidate_trainer_context_cache(user_id)
    for row in rows:
        client_id = str(row.get("client_id") or row.get("target_client_id") or "").strip()
        trainer_id = str(
            row.get("trainer_id")
            or row.get("previous_trainer_id")
            or row.get("target_trainer_id")
            or ""
        ).strip()
        if not client_id or not trainer_id:
            continue
        invalidate_chat_context(
            trainer_id,
            client_id,
            reason=str(row.get("event_type") or "trainer_assignment_mutation"),
        )


@router.get("/status", response_model=TrainerAssignmentStatus)
async def get_assignment_status(
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    supabase: Client = Depends(get_request_scoped_supabase_client),
):
    if trainer_context.trainer_id:
        return _build_status_response(trainer_context, user)

    return _build_status_response(
        trainer_context,
        user,
        available_trainers=_list_active_trainers(supabase=supabase, tenant_id=trainer_context.tenant_id),
    )


@router.post("/assign", response_model=TrainerAssignmentStatus)
async def assign_trainer(
    request: TrainerAssignmentRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
):
    del request, http_request, user, trainer_context
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Direct trainer selection is disabled. Attach with a trainer invite code instead.",
    )


@router.post("/assign-by-invite", response_model=TrainerAssignmentStatus)
async def assign_trainer_by_invite(
    request: TrainerInviteCodeAssignmentRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    onboarding_service: OnboardingService = Depends(get_internal_onboarding_service),
    supabase: Client = Depends(get_request_scoped_supabase_client),
):
    enforce_rate_limit(
        group="trainer_assignment_mutation",
        user=user,
        request=http_request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": trainer_context.client_id,
        },
    )
    if trainer_context.trainer_id and not trainer_context.client_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Trainer accounts cannot self-assign to a trainer",
        )
    try:
        onboarding_service.assign_by_invite(user=user, invite_code=request.invite_code)
        mutation_rows = getattr(onboarding_service, "_last_assignment_mutation_rows", [])
    except OnboardingServiceError as exc:
        logger.info(
            "Invite assignment rejected user_id=%s status_code=%s reason=%s",
            user.id,
            exc.status_code,
            exc.message,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to attach trainer with invite code",
        ) from exc

    if isinstance(mutation_rows, list):
        _invalidate_assignment_contexts(user.id, mutation_rows)
    else:
        invalidate_trainer_context_cache(user.id)
    updated_context = resolve_trainer_context(supabase, user.id)
    return _build_status_response(updated_context, user)


@router.delete("/current", response_model=TrainerAssignmentStatus)
async def delete_current_trainer_assignment(
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    onboarding_service: OnboardingService = Depends(get_internal_onboarding_service),
    supabase: Client = Depends(get_request_scoped_supabase_client),
):
    enforce_rate_limit(
        group="trainer_assignment_mutation",
        user=user,
        request=http_request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": trainer_context.client_id,
        },
    )
    if trainer_context.trainer_id and not trainer_context.client_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Trainer accounts cannot remove a trainer assignment",
        )

    try:
        mutation_rows = onboarding_service.self_detach_current_assignment(user=user)
    except OnboardingServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    _invalidate_assignment_contexts(user.id, mutation_rows)
    updated_context = resolve_trainer_context(supabase, user.id)
    return _build_status_response(updated_context, user)
