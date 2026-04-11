from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_context
from app.core.tenancy import TrainerContext
from app.db.client import get_supabase_client


router = APIRouter()


class TrainerOption(BaseModel):
    id: str
    display_name: str


class TrainerAssignmentStatus(BaseModel):
    needs_assignment: bool
    assigned_trainer_id: str | None = None
    assigned_trainer_display_name: str | None = None
    available_trainers: list[TrainerOption] = Field(default_factory=list)
    available_trainers_count: int = 0
    scope: Literal["tenant", "global_fallback"] = "global_fallback"


class TrainerAssignmentRequest(BaseModel):
    trainer_id: str


def _resolve_scope(trainer_context: TrainerContext) -> Literal["tenant", "global_fallback"]:
    return "tenant" if trainer_context.tenant_id else "global_fallback"


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
    available_trainers: list[dict] | None = None,
) -> TrainerAssignmentStatus:
    needs_assignment = not trainer_context.trainer_id
    scoped_trainers = (available_trainers or []) if needs_assignment else []
    return TrainerAssignmentStatus(
        needs_assignment=needs_assignment,
        assigned_trainer_id=trainer_context.trainer_id,
        assigned_trainer_display_name=trainer_context.trainer_display_name,
        available_trainers=[
            TrainerOption(id=trainer["id"], display_name=trainer["display_name"])
            for trainer in scoped_trainers
        ],
        available_trainers_count=len(scoped_trainers),
        scope=_resolve_scope(trainer_context),
    )


@router.get("/status", response_model=TrainerAssignmentStatus)
async def get_assignment_status(
    trainer_context: TrainerContext = Depends(get_trainer_context),
):
    if trainer_context.trainer_id:
        return _build_status_response(trainer_context)

    return _build_status_response(
        trainer_context,
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

    if len(existing_clients) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User has multiple client records and cannot self-assign automatically",
        )

    existing_client = existing_clients[0] if existing_clients else None
    if existing_client and existing_client.get("assigned_trainer_id"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already assigned to an active trainer context",
        )
    if existing_client and existing_client.get("tenant_id") != selected_trainer.get("tenant_id"):
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

    updated_context = TrainerContext(
        tenant_id=selected_trainer.get("tenant_id"),
        trainer_id=selected_trainer["id"],
        trainer_user_id=None,
        trainer_display_name=selected_trainer["display_name"],
        client_id=existing_client.get("id") if existing_client else None,
    )
    return _build_status_response(updated_context)
