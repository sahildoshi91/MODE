from __future__ import annotations

import json
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.api.v1.chat import CONTROLLED_CHAT_ERROR_DETAIL
from app.api.v1.trainer_auth import require_client_or_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_chat_session_service, get_trainer_context
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.modules.chat_sessions.schemas import (
    ChatSessionContinueRequest,
    ChatSessionDetailResponse,
    ChatSessionListResponse,
    ChatSessionSendRequest,
    ChatSessionSendResponse,
    ChatSessionTodayRequest,
    ChatSessionTodayResponse,
)
from app.modules.chat_sessions.service import ChatSessionAccessError, ChatSessionService
from app.modules.conversation.service import ConversationProcessingError


router = APIRouter()
logger = logging.getLogger(__name__)

CHAT_SESSION_SCHEMA_MISSING_CODE = "CHAT_SESSION_SCHEMA_MISSING"
CHAT_SESSION_SCHEMA_MISSING_MESSAGE = "Chat session storage is not migrated on this backend yet."
CHAT_SESSION_SCHEMA_MISSING_HINT = (
    "Run backend/sql/20260504_create_chat_sessions.sql against the active Supabase project, "
    "then run NOTIFY pgrst, 'reload schema'."
)
CHAT_SESSION_STORAGE_OBJECTS = {
    "chat_sessions",
    "chat_messages",
    "append_chat_message",
}


def _rate_limit_chat(http_request: Request, user: AuthenticatedUser, trainer_context: TrainerContext) -> None:
    enforce_rate_limit(
        group="chat",
        user=user,
        request=http_request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": trainer_context.client_id,
        },
    )


def _raise_session_value_error(exc: ValueError) -> None:
    if isinstance(exc, ChatSessionAccessError):
        raise HTTPException(status_code=403, detail="Chat session is not available for this account") from exc
    normalized = str(exc).strip().lower()
    if "not found" in normalized:
        raise HTTPException(status_code=404, detail="Not found") from exc
    if "archived" in normalized:
        raise HTTPException(status_code=409, detail="Chat session is read-only") from exc
    if "not assigned" in normalized:
        raise HTTPException(status_code=400, detail="Invalid chat context") from exc
    raise HTTPException(status_code=400, detail="Invalid chat session request") from exc


def _error_text(exc: Exception) -> str:
    parts: list[str] = []
    current: BaseException | None = exc
    while current is not None:
        parts.append(str(current))
        current = current.__cause__
    return " ".join(parts).lower()


def _error_codes(exc: Exception) -> set[str]:
    codes: set[str] = set()
    current: BaseException | None = exc
    while current is not None:
        current_code = getattr(current, "code", None)
        if current_code:
            codes.add(str(current_code).upper())
        for arg in getattr(current, "args", ()):
            if isinstance(arg, dict):
                arg_code = arg.get("code")
                if arg_code:
                    codes.add(str(arg_code).upper())
        current = current.__cause__
    return codes


def _is_chat_session_schema_missing(exc: Exception) -> bool:
    error_text = _error_text(exc)
    error_codes = _error_codes(exc)
    mentions_chat_storage = any(name in error_text for name in CHAT_SESSION_STORAGE_OBJECTS)
    if mentions_chat_storage and {"PGRST205", "42P01", "42883"}.intersection(error_codes):
        return True
    if mentions_chat_storage and (
        "schema cache" in error_text
        or "could not find the table" in error_text
        or "relation" in error_text and "does not exist" in error_text
        or "function" in error_text and "does not exist" in error_text
    ):
        return True
    return False


def _raise_unexpected_chat_session_error(exc: Exception, *, log_message: str, **log_context: object) -> None:
    logger.exception(log_message, *log_context.values())
    if _is_chat_session_schema_missing(exc):
        raise HTTPException(
            status_code=503,
            detail={
                "code": CHAT_SESSION_SCHEMA_MISSING_CODE,
                "message": CHAT_SESSION_SCHEMA_MISSING_MESSAGE,
                "hint": CHAT_SESSION_SCHEMA_MISSING_HINT,
            },
        ) from exc
    raise HTTPException(status_code=502, detail=CONTROLLED_CHAT_ERROR_DETAIL) from exc


@router.post("/today", response_model=ChatSessionTodayResponse)
async def get_today_chat_session(
    request: ChatSessionTodayRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ChatSessionService = Depends(get_chat_session_service),
):
    require_client_or_trainer_actor(user, trainer_context)
    _rate_limit_chat(http_request, user, trainer_context)
    try:
        return service.get_or_create_today_session(
            user_id=user.id,
            trainer_context=trainer_context,
            request=request,
        )
    except ValueError as exc:
        _raise_session_value_error(exc)
    except Exception as exc:
        _raise_unexpected_chat_session_error(
            exc,
            log_message=(
                "Unexpected daily chat session failure user_id=%s trainer_id=%s client_id=%s"
            ),
            user_id=user.id,
            trainer_id=trainer_context.trainer_id,
            client_id=trainer_context.client_id,
        )


@router.get("/", response_model=ChatSessionListResponse, include_in_schema=False)
@router.get("", response_model=ChatSessionListResponse)
async def list_chat_sessions(
    http_request: Request,
    role: str = Query(...),
    session_type: str | None = Query(default=None),
    limit: int = Query(default=80, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ChatSessionService = Depends(get_chat_session_service),
):
    require_client_or_trainer_actor(user, trainer_context)
    _rate_limit_chat(http_request, user, trainer_context)
    try:
        return service.list_history(
            user_id=user.id,
            trainer_context=trainer_context,
            role=role,
            session_type=session_type,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        _raise_session_value_error(exc)
    except Exception as exc:
        _raise_unexpected_chat_session_error(
            exc,
            log_message=(
                "Unexpected chat session list failure user_id=%s trainer_id=%s client_id=%s"
            ),
            user_id=user.id,
            trainer_id=trainer_context.trainer_id,
            client_id=trainer_context.client_id,
        )


@router.post("/{session_id}/continue", response_model=ChatSessionTodayResponse)
async def continue_chat_session(
    session_id: str,
    request: ChatSessionContinueRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ChatSessionService = Depends(get_chat_session_service),
):
    require_client_or_trainer_actor(user, trainer_context)
    _rate_limit_chat(http_request, user, trainer_context)
    try:
        return service.continue_from_session(
            user_id=user.id,
            trainer_context=trainer_context,
            session_id=session_id,
            request=request,
        )
    except ValueError as exc:
        _raise_session_value_error(exc)
    except Exception as exc:
        _raise_unexpected_chat_session_error(
            exc,
            log_message="Unexpected chat session continue failure session_id=%s",
            session_id=session_id,
        )


@router.post("/{session_id}/messages", response_model=ChatSessionSendResponse)
async def send_chat_session_message(
    session_id: str,
    request: ChatSessionSendRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ChatSessionService = Depends(get_chat_session_service),
):
    require_client_or_trainer_actor(user, trainer_context)
    _rate_limit_chat(http_request, user, trainer_context)
    try:
        return service.send_message(
            user_id=user.id,
            trainer_context=trainer_context,
            session_id=session_id,
            request=request,
        )
    except ValueError as exc:
        _raise_session_value_error(exc)
    except ConversationProcessingError:
        logger.warning("Chat session message processing failed session_id=%s", session_id, exc_info=True)
        raise HTTPException(status_code=502, detail=CONTROLLED_CHAT_ERROR_DETAIL)
    except Exception as exc:
        _raise_unexpected_chat_session_error(
            exc,
            log_message="Unexpected chat session message failure session_id=%s",
            session_id=session_id,
        )


@router.post("/{session_id}/messages/stream")
async def stream_chat_session_message(
    session_id: str,
    request: ChatSessionSendRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ChatSessionService = Depends(get_chat_session_service),
):
    require_client_or_trainer_actor(user, trainer_context)
    _rate_limit_chat(http_request, user, trainer_context)
    request_id = str(request.request_id) if request.request_id else str(uuid4())
    try:
        session, user_message, conversation_id, chunks, route_debug, result_state = service.prepare_stream(
            user_id=user.id,
            trainer_context=trainer_context,
            session_id=session_id,
            request=request,
        )
    except ValueError as exc:
        _raise_session_value_error(exc)
    except ConversationProcessingError:
        logger.warning("Chat session stream processing failed session_id=%s", session_id, exc_info=True)
        raise HTTPException(status_code=502, detail=CONTROLLED_CHAT_ERROR_DETAIL)
    except Exception as exc:
        _raise_unexpected_chat_session_error(
            exc,
            log_message="Unexpected chat session stream start failure session_id=%s",
            session_id=session_id,
        )

    def event_stream():
        seq = 0
        assistant_chunks: list[str] = []

        def emit(payload: dict[str, object]) -> str:
            nonlocal seq
            seq += 1
            payload_with_meta = {
                **payload,
                "request_id": request_id,
                "seq": seq,
            }
            return f"data: {json.dumps(payload_with_meta)}\n\n"

        yield emit({
            "type": "start",
            "session_id": session_id,
            "conversation_id": conversation_id,
            "user_message": user_message,
        })
        try:
            for chunk in chunks:
                text_chunk = str(chunk or "")
                if not text_chunk:
                    continue
                assistant_chunks.append(text_chunk)
                yield emit({
                    "type": "delta",
                    "session_id": session_id,
                    "conversation_id": conversation_id,
                    "text": text_chunk,
                })
            assistant_message = "".join(assistant_chunks).strip()
            if not assistant_message:
                assistant_message = "I'm here with you. Could you rephrase that and I'll try again?"
            token_usage = getattr(result_state, "token_usage", None)
            conversation_usage = getattr(result_state, "conversation_usage", None)
            saved_ai_message = service.persist_streamed_ai_message(
                session_id=session_id,
                content=assistant_message,
                metadata={
                    "request_id": request_id,
                    "conversation_id": conversation_id,
                    "legacy_assistant_message_id": getattr(result_state, "assistant_message_id", None),
                    "token_usage": token_usage.model_dump() if token_usage else None,
                    "conversation_usage": conversation_usage.model_dump() if conversation_usage else None,
                },
            )
            yield emit({
                "type": "completed",
                "session_id": session_id,
                "conversation_id": conversation_id,
                "assistant_message": assistant_message,
                "ai_message": saved_ai_message,
            })
            yield emit({
                "type": "done",
                "session_id": session_id,
                "conversation_id": conversation_id,
            })
        except ConversationProcessingError as exc:
            detail = str(exc) or CONTROLLED_CHAT_ERROR_DETAIL
            yield emit({
                "type": "error",
                "detail": detail,
                "session_id": session_id,
                "conversation_id": conversation_id,
            })
        except Exception:
            logger.exception("Unexpected chat session stream generator failure session_id=%s", session_id)
            yield emit({
                "type": "error",
                "detail": CONTROLLED_CHAT_ERROR_DETAIL,
                "session_id": session_id,
                "conversation_id": conversation_id,
            })

    del session, route_debug
    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{session_id}", response_model=ChatSessionDetailResponse)
async def get_chat_session(
    session_id: str,
    http_request: Request,
    message_limit: int = Query(default=500, ge=1, le=500),
    message_offset: int = Query(default=0, ge=0),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ChatSessionService = Depends(get_chat_session_service),
):
    require_client_or_trainer_actor(user, trainer_context)
    _rate_limit_chat(http_request, user, trainer_context)
    try:
        return service.get_session_detail(
            user_id=user.id,
            trainer_context=trainer_context,
            session_id=session_id,
            message_limit=message_limit,
            message_offset=message_offset,
        )
    except ValueError as exc:
        _raise_session_value_error(exc)
    except Exception as exc:
        _raise_unexpected_chat_session_error(
            exc,
            log_message="Unexpected chat session detail failure session_id=%s",
            session_id=session_id,
        )
