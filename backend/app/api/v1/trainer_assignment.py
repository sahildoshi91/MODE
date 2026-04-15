from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_onboarding_service, get_trainer_context
from app.core.tenancy import TrainerContext, resolve_trainer_context
from app.db.client import get_supabase_client
from app.modules.onboarding.service import OnboardingService, OnboardingServiceError


router = APIRouter()


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


def _list_active_trainers(*, tenant_id: str | None) -> list[dict]:
    query = (
        get_supabase_client()
        .table("trainers")
        .select("id, tenant_id, display_name, is_active")
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


@router.get("/status", response_model=TrainerAssignmentStatus)
async def get_assignment_status(
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
):
    if trainer_context.trainer_id:
        return _build_status_response(trainer_context, user)

    return _build_status_response(
        trainer_context,
        user,
        available_trainers=_list_active_trainers(tenant_id=trainer_context.tenant_id),
    )


@router.post("/assign", response_model=TrainerAssignmentStatus)
async def assign_trainer(
    request: TrainerAssignmentRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
):
    if trainer_context.trainer_id and not trainer_context.client_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Trainer accounts cannot self-assign to a trainer",
        )
    if trainer_context.trainer_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already assigned to an active trainer context",
        )

    admin_client = get_supabase_client()
    trainers = _list_active_trainers(tenant_id=trainer_context.tenant_id)
    selected_trainer = next((trainer for trainer in trainers if trainer["id"] == request.trainer_id), None)
    if not selected_trainer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Selected trainer was not found in the available trainer scope",
        )

    existing_clients = (
        admin_client
        .table("clients")
        .select("id, tenant_id, assigned_trainer_id")
        .eq("user_id", user.id)
        .execute()
    ).data or []

    assigned_to_other_trainer = [
        client for client in existing_clients
        if client.get("assigned_trainer_id") and client.get("assigned_trainer_id") != request.trainer_id
    ]
    if assigned_to_other_trainer:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already assigned to an active trainer context",
        )
    already_assigned = next(
        (
            client for client in existing_clients
            if client.get("assigned_trainer_id") == request.trainer_id
        ),
        None,
    )
    if already_assigned:
        updated_context = resolve_trainer_context(admin_client, user.id)
        return _build_status_response(updated_context, user)

    tenant_mismatch_assigned = [
        client for client in existing_clients
        if client.get("assigned_trainer_id")
        and client.get("tenant_id") != selected_trainer.get("tenant_id")
    ]
    if tenant_mismatch_assigned:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already linked to a different tenant and cannot self-assign to this trainer",
        )

    admin_client.rpc(
        "assign_client_to_trainer",
        {
            "client_user_id": user.id,
            "trainer_record_id": request.trainer_id,
        },
    ).execute()

    try:
        updated_context = resolve_trainer_context(admin_client, user.id)
    except Exception:
        fallback_client = next(
            (
                client for client in existing_clients
                if client.get("tenant_id") == selected_trainer.get("tenant_id")
            ),
            None,
        )
        updated_context = TrainerContext(
            tenant_id=selected_trainer.get("tenant_id"),
            trainer_id=selected_trainer["id"],
            trainer_user_id=None,
            trainer_display_name=selected_trainer["display_name"],
            client_id=fallback_client.get("id") if fallback_client else None,
        )
    return _build_status_response(updated_context, user)


@router.post("/assign-by-invite", response_model=TrainerAssignmentStatus)
async def assign_trainer_by_invite(
    request: TrainerInviteCodeAssignmentRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    onboarding_service: OnboardingService = Depends(get_onboarding_service),
):
    if trainer_context.trainer_id and not trainer_context.client_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Trainer accounts cannot self-assign to a trainer",
        )
    try:
        onboarding_service.assign_by_invite(user=user, invite_code=request.invite_code)
    except OnboardingServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    updated_context = resolve_trainer_context(get_supabase_client(), user.id)
    return _build_status_response(updated_context, user)
