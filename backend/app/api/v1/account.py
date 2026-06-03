from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from supabase import Client

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.config import settings
from app.core.dependencies import (
    get_internal_onboarding_repository,
    get_request_scoped_supabase_client,
    get_trainer_context,
)
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.db.client import get_supabase_admin_client
from app.modules.account_deletion.repository import AccountDeletionRequestRepository
from app.modules.account_deletion.service import AccountDeletionService
from app.modules.intelligence_jobs.queue import enqueue_intelligence_job
from app.modules.intelligence_jobs.schemas import IntelligenceJob
from app.modules.onboarding.repository import OnboardingRepository, SELF_GUIDED_TENANT_SLUG


router = APIRouter()
logger = logging.getLogger(__name__)

NO_STORE_HEADERS = {"Cache-Control": "no-store"}
PASSWORD_UPDATE_ERROR_DETAIL = "Unable to update password"
EMAIL_UPDATE_ERROR_DETAIL = "Unable to start email change"
PASSWORD_REVIEW_FAILURE_THRESHOLD = 3
_password_failure_counts: dict[str, int] = {}
_password_failure_lock = threading.Lock()


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


class ChangeEmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> str:
        return str(value or "").strip().lower()

    @field_validator("email")
    @classmethod
    def validate_email_shape(cls, value: str) -> str:
        if "@" not in value:
            raise ValueError("Invalid email")
        local_part, _, domain = value.rpartition("@")
        if not local_part or not domain or "." not in domain:
            raise ValueError("Invalid email")
        return value


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=1, max_length=512)


class CredentialMutationResponse(BaseModel):
    success: bool = True


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


def _client_ip(request: Request) -> str:
    return str(request.client.host if request.client else "unknown").strip() or "unknown"


def _user_agent(request: Request) -> str | None:
    normalized = str(request.headers.get("user-agent") or "").strip()
    return normalized[:240] or None


def _email_domain(email: object) -> str | None:
    normalized = str(email or "").strip().lower()
    if "@" not in normalized:
        return None
    domain = normalized.rsplit("@", 1)[-1].strip()
    return domain or None


def _set_no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def _credential_route_disabled() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Password auth proxy is disabled",
        headers=NO_STORE_HEADERS,
    )


def _password_update_error(status_code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=PASSWORD_UPDATE_ERROR_DETAIL,
        headers=NO_STORE_HEADERS,
    )


def _email_update_error(status_code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=EMAIL_UPDATE_ERROR_DETAIL,
        headers=NO_STORE_HEADERS,
    )


def _with_no_store(exc: HTTPException) -> HTTPException:
    headers = dict(exc.headers or {})
    headers["Cache-Control"] = "no-store"
    exc.headers = headers
    return exc


def _enforce_credential_rate_limit(
    *,
    group: str,
    user: AuthenticatedUser,
    request: Request,
    action: str,
) -> None:
    try:
        enforce_rate_limit(
            group=group,
            user=user,
            request=request,
            context={"action": action},
        )
    except HTTPException as exc:
        raise _with_no_store(exc) from exc


def _emit_credential_audit(
    event: str,
    *,
    user: AuthenticatedUser,
    request: Request,
    **extra: object,
) -> None:
    payload = {
        "event": event,
        "user_id": user.id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ip": _client_ip(request),
        "user_agent": _user_agent(request),
        **extra,
    }
    logger.warning(json.dumps(payload, default=str))


def _record_password_failure(user: AuthenticatedUser, request: Request, *, reason: str) -> None:
    with _password_failure_lock:
        next_count = int(_password_failure_counts.get(user.id, 0)) + 1
        _password_failure_counts[user.id] = next_count
    _emit_credential_audit(
        "credential.password_change_failed",
        user=user,
        request=request,
        reason=reason,
    )
    if next_count == PASSWORD_REVIEW_FAILURE_THRESHOLD:
        _emit_credential_audit(
            "credential.password_change_review_flagged",
            user=user,
            request=request,
            reason="consecutive_failures",
            failure_count=next_count,
        )


def _reset_password_failures(user_id: str) -> None:
    with _password_failure_lock:
        _password_failure_counts.pop(user_id, None)


def _auth_user_id(auth_user: object | None) -> str | None:
    user_id = _object_value(auth_user, "id")
    normalized = str(user_id or "").strip()
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


def _revoke_other_sessions(supabase: Client, user: AuthenticatedUser) -> None:
    auth = getattr(supabase, "auth", None)
    if auth is None or not user.access_token:
        raise RuntimeError("credential_session_revoke_unavailable")

    get_session = getattr(auth, "get_session", None)
    session = get_session() if callable(get_session) else None
    if session is not None:
        sign_out = getattr(auth, "sign_out", None)
        if not callable(sign_out):
            raise RuntimeError("credential_session_revoke_unavailable")
        sign_out({"scope": "others"})
        return

    validated_user = _get_auth_user_object(supabase, user)
    if _auth_user_id(validated_user) != user.id:
        raise RuntimeError("credential_session_revoke_subject_mismatch")

    # TODO: remove if user-scoped sign_out confirmed working in the server Supabase client.
    get_supabase_admin_client().auth.admin.sign_out(user.access_token, "others")


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


@router.patch("/email", response_model=CredentialMutationResponse)
async def change_account_email(
    request: ChangeEmailRequest,
    http_request: Request,
    response: Response,
    user: AuthenticatedUser = CurrentUser,
    supabase: Client = Depends(get_request_scoped_supabase_client),
):
    _set_no_store(response)
    if not settings.auth_password_proxy_enabled:
        raise _credential_route_disabled()
    _enforce_credential_rate_limit(
        group="credential_email_change",
        user=user,
        request=http_request,
        action="email_change",
    )

    normalized_email = str(request.email or "").strip().lower()
    auth_user = _get_auth_user_object(supabase, user)
    old_email_domain = _email_domain(_object_value(auth_user, "email") or user.email)
    try:
        supabase.auth.update_user({"email": normalized_email})
    except Exception as exc:
        raise _email_update_error() from exc

    _emit_credential_audit(
        "credential.email_change_requested",
        user=user,
        request=http_request,
        old_email_domain=old_email_domain,
        new_email_domain=_email_domain(normalized_email),
    )
    return CredentialMutationResponse()


@router.patch("/password", response_model=CredentialMutationResponse)
async def change_account_password(
    request: ChangePasswordRequest,
    http_request: Request,
    response: Response,
    user: AuthenticatedUser = CurrentUser,
    supabase: Client = Depends(get_request_scoped_supabase_client),
):
    _set_no_store(response)
    if not settings.auth_password_proxy_enabled:
        raise _credential_route_disabled()
    try:
        _enforce_credential_rate_limit(
            group="credential_password_change",
            user=user,
            request=http_request,
            action="password_change",
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
            _emit_credential_audit(
                "credential.password_change_failed",
                user=user,
                request=http_request,
                reason="rate_limited",
            )
        raise

    current_password = str(request.current_password or "")
    new_password = str(request.new_password or "")
    if len(new_password) < 12 or new_password == current_password:
        _record_password_failure(user, http_request, reason="provider_error")
        raise _password_update_error()

    try:
        supabase.auth.update_user(
            {
                "password": new_password,
                "current_password": current_password,
            }
        )
    except Exception as exc:
        _record_password_failure(user, http_request, reason="invalid_current")
        raise _password_update_error() from exc

    _reset_password_failures(user.id)
    _emit_credential_audit("credential.password_changed", user=user, request=http_request)
    try:
        _revoke_other_sessions(supabase, user)
    except Exception as exc:
        _emit_credential_audit(
            "credential.session_revocation_failed",
            user=user,
            request=http_request,
            reason=type(exc).__name__,
        )
    return CredentialMutationResponse()


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
