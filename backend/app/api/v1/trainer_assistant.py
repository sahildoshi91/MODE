import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

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
logger = logging.getLogger(__name__)
CONTROLLED_TRAINER_ASSISTANT_ERROR_DETAIL = "Trainer assistant request could not be completed"
TRAINER_ASSISTANT_SOURCE_TYPE_CONSTRAINT = "ai_generated_outputs_source_type_check"


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


def _raise_controlled_trainer_assistant_error(
    *,
    endpoint: str,
    exc: Exception,
    user: AuthenticatedUser,
    trainer_context: TrainerContext,
    request_context: dict[str, object] | None = None,
) -> JSONResponse:
    diagnostics = _extract_error_diagnostics(exc)
    if _is_source_type_constraint_mismatch(diagnostics):
        diagnostics["code"] = diagnostics["code"] or "23514"
        diagnostics["hint"] = (
            "Apply backend/sql/20260418c_allow_trainer_assistant_draft_source_type.sql "
            "to the active database, then restart backend from current repo code."
        )
        diagnostics["details"] = diagnostics["details"] or (
            "Constraint ai_generated_outputs_source_type_check rejected source_type='trainer_assistant_draft'."
        )

    logger.exception(
        "Unexpected trainer assistant failure endpoint=%s user_id=%s trainer_id=%s client_id=%s request_context=%s "
        "code=%s hint=%s details=%s",
        endpoint,
        user.id,
        trainer_context.trainer_id,
        trainer_context.client_id,
        request_context or {},
        diagnostics["code"],
        diagnostics["hint"],
        diagnostics["details"],
        exc_info=exc,
    )
    return JSONResponse(
        status_code=502,
        content={
            "detail": CONTROLLED_TRAINER_ASSISTANT_ERROR_DETAIL,
            "status": 502,
            "request_path": endpoint,
            "code": diagnostics["code"],
            "hint": diagnostics["hint"],
            "details": diagnostics["details"],
        },
    )


def _extract_error_diagnostics(exc: Exception) -> dict[str, str | None]:
    code: str | None = None
    hint: str | None = None
    details: str | None = None
    messages: list[str] = []

    current: BaseException | None = exc
    while current is not None:
        if code is None:
            current_code = getattr(current, "code", None)
            if current_code:
                code = str(current_code)
        if hint is None:
            current_hint = getattr(current, "hint", None)
            if isinstance(current_hint, str) and current_hint.strip():
                hint = current_hint.strip()
        if details is None:
            current_details = getattr(current, "details", None)
            if isinstance(current_details, str) and current_details.strip():
                details = current_details.strip()

        current_message = getattr(current, "message", None)
        if isinstance(current_message, str) and current_message.strip():
            messages.append(current_message.strip())
        current_text = str(current).strip()
        if current_text:
            messages.append(current_text)

        for arg in getattr(current, "args", ()):
            if isinstance(arg, dict):
                if code is None and arg.get("code"):
                    code = str(arg.get("code"))
                if hint is None and isinstance(arg.get("hint"), str) and arg.get("hint").strip():
                    hint = str(arg.get("hint")).strip()
                if details is None and isinstance(arg.get("details"), str) and arg.get("details").strip():
                    details = str(arg.get("details")).strip()
                message_value = arg.get("message")
                if isinstance(message_value, str) and message_value.strip():
                    messages.append(message_value.strip())
            elif isinstance(arg, str) and arg.strip():
                messages.append(arg.strip())

        current = current.__cause__

    return {
        "code": code,
        "hint": hint,
        "details": details,
        "text": " ".join(messages).lower() if messages else "",
    }


def _is_source_type_constraint_mismatch(diagnostics: dict[str, str | None]) -> bool:
    code = str(diagnostics.get("code") or "").strip().upper()
    text = str(diagnostics.get("text") or "").lower()
    if TRAINER_ASSISTANT_SOURCE_TYPE_CONSTRAINT not in text:
        return False
    return not code or code == "23514"


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
    except Exception as exc:
        return _raise_controlled_trainer_assistant_error(
            endpoint="/api/v1/trainer-assistant/bootstrap",
            exc=exc,
            user=user,
            trainer_context=trainer_context,
            request_context={"client_id": client_id},
        )


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
    except Exception as exc:
        return _raise_controlled_trainer_assistant_error(
            endpoint="/api/v1/trainer-assistant/execute",
            exc=exc,
            user=user,
            trainer_context=trainer_context,
            request_context={
                "client_id": request.client_id,
                "action_type": request.action_type.value,
            },
        )


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
    except Exception as exc:
        return _raise_controlled_trainer_assistant_error(
            endpoint="/api/v1/trainer-assistant/drafts/{draft_id}/edit",
            exc=exc,
            user=user,
            trainer_context=trainer_context,
            request_context={"draft_id": draft_id},
        )


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
    except Exception as exc:
        return _raise_controlled_trainer_assistant_error(
            endpoint="/api/v1/trainer-assistant/drafts/{draft_id}/approve",
            exc=exc,
            user=user,
            trainer_context=trainer_context,
            request_context={"draft_id": draft_id},
        )


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
    except Exception as exc:
        return _raise_controlled_trainer_assistant_error(
            endpoint="/api/v1/trainer-assistant/drafts/{draft_id}/reject",
            exc=exc,
            user=user,
            trainer_context=trainer_context,
            request_context={"draft_id": draft_id},
        )


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
    except Exception as exc:
        return _raise_controlled_trainer_assistant_error(
            endpoint="/api/v1/trainer-assistant/background/run",
            exc=exc,
            user=user,
            trainer_context=trainer_context,
            request_context={
                "run_date": request.run_date.isoformat() if request.run_date else None,
                "jobs_count": len(request.jobs or []),
            },
        )
