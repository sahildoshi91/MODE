from __future__ import annotations

from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from supabase import Client

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import (
    get_internal_onboarding_repository,
    get_request_scoped_supabase_client,
    get_trainer_context,
)
from app.core.tenancy import TrainerContext
from app.modules.account_deletion.repository import AccountDeletionRequestRepository
from app.modules.account_deletion.service import AccountDeletionService
from app.modules.intelligence_jobs.queue import enqueue_intelligence_job
from app.modules.intelligence_jobs.schemas import IntelligenceJob
from app.modules.onboarding.repository import OnboardingRepository, SELF_GUIDED_TENANT_SLUG


router = APIRouter()


class AccountMeResponse(BaseModel):
    email: str | None = None
    pending_email_change: bool = False
    pending_email: str | None = None
    user_account_id: str
    viewer_role: Literal["trainer", "client", "unassigned"] = "unassigned"
    client_id: str | None = None
    assigned_trainer_id: str | None = None
    assigned_trainer_display_name: str | None = None
    is_self_guided: bool = False


class DeleteMyAccountRequest(BaseModel):
    confirmation: str = Field(min_length=1, max_length=32)


class DeleteMyAccountResponse(BaseModel):
    deletion_request_id: str
    outcome: Literal["queued"] = "queued"
    actor_role: Literal["client", "trainer", "mixed", "unassigned"] = "unassigned"
    worker_job_id: str | None = None


def _object_value(obj: object, key: str) -> object:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    value = getattr(obj, key, None)
    if value is not None:
        return value
    model_dump = getattr(obj, "model_dump", None)
    if callable(model_dump):
        try:
            dumped = model_dump()
        except Exception:
            dumped = None
        if isinstance(dumped, dict):
            return dumped.get(key)
    to_dict = getattr(obj, "dict", None)
    if callable(to_dict):
        try:
            dumped = to_dict()
        except Exception:
            dumped = None
        if isinstance(dumped, dict):
            return dumped.get(key)
    return None


def _optional_text(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _get_auth_user_object(supabase: Client, user: AuthenticatedUser) -> object | None:
    if not user.access_token:
        return None
    auth = getattr(supabase, "auth", None)
    get_user = getattr(auth, "get_user", None)
    if not callable(get_user):
        return None
    try:
        response = get_user(user.access_token)
    except TypeError:
        response = get_user()
    except Exception:
        return None
    return _object_value(response, "user") or response


def _resolve_account_viewer_role(
    *,
    trainer_context: TrainerContext,
    user: AuthenticatedUser,
) -> Literal["trainer", "client", "unassigned"]:
    if trainer_context.trainer_id and trainer_context.trainer_user_id == user.id:
        return "trainer"
    if trainer_context.client_id:
        return "client"
    return "unassigned"


def _is_self_guided_context(
    *,
    repository: OnboardingRepository,
    trainer_context: TrainerContext,
) -> bool:
    if not trainer_context.tenant_id or trainer_context.trainer_id:
        return False
    tenant_slug = repository.get_tenant_slug(tenant_id=trainer_context.tenant_id)
    return tenant_slug == SELF_GUIDED_TENANT_SLUG


@router.get("/me", response_model=AccountMeResponse)
async def get_my_account(
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    supabase: Client = Depends(get_request_scoped_supabase_client),
    repository: OnboardingRepository = Depends(get_internal_onboarding_repository),
):
    auth_user = _get_auth_user_object(supabase, user)
    confirmed_email = _optional_text(_object_value(auth_user, "email")) or user.email
    pending_email = _optional_text(_object_value(auth_user, "new_email"))
    _email_change_sent_at = _object_value(auth_user, "email_change_sent_at")
    pending_email_change = bool(
        pending_email
        and confirmed_email
        and pending_email.strip().lower() != confirmed_email.strip().lower()
    )

    account = repository.ensure_user_account(user_id=user.id, email=confirmed_email)
    return AccountMeResponse(
        email=confirmed_email,
        pending_email_change=pending_email_change,
        pending_email=pending_email if pending_email_change else None,
        user_account_id=account["id"],
        viewer_role=_resolve_account_viewer_role(trainer_context=trainer_context, user=user),
        client_id=trainer_context.client_id,
        assigned_trainer_id=trainer_context.trainer_id if trainer_context.client_id else None,
        assigned_trainer_display_name=trainer_context.trainer_display_name if trainer_context.client_id else None,
        is_self_guided=_is_self_guided_context(repository=repository, trainer_context=trainer_context),
    )


@router.delete("/me", response_model=DeleteMyAccountResponse, status_code=status.HTTP_202_ACCEPTED)
async def delete_my_account(
    request: DeleteMyAccountRequest,
    user: AuthenticatedUser = CurrentUser,
    supabase: Client = Depends(get_request_scoped_supabase_client),
):
    if str(request.confirmation or "").strip().upper() != AccountDeletionService.CONFIRMATION_TOKEN:
        raise HTTPException(status_code=422, detail="Invalid deletion confirmation")

    deletion_request_id = str(uuid4())
    job = IntelligenceJob(
        job_type="account_deletion",
        trainer_id="",
        client_id="",
        conversation_id=deletion_request_id,
        trace_id=deletion_request_id,
        payload={
            "request_id": deletion_request_id,
            "user_id": user.id,
        },
    )
    request_repository = AccountDeletionRequestRepository(supabase)
    request_repository.create_request(
        request_id=deletion_request_id,
        user_id=user.id,
        job_id=job.job_id,
    )
    enqueue_result = enqueue_intelligence_job(job)
    if not enqueue_result.ok:
        request_repository.mark_enqueue_failed(
            request_id=deletion_request_id,
            error_category=enqueue_result.error_category or "enqueue_failed",
        )
        raise HTTPException(status_code=503, detail="Account deletion queue unavailable")

    return DeleteMyAccountResponse(
        deletion_request_id=deletion_request_id,
        actor_role="unassigned",
        worker_job_id=job.job_id,
    )
