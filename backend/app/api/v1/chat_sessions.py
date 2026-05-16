from __future__ import annotations

import logging
import time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.api.v1.chat import CONTROLLED_CHAT_ERROR_DETAIL
from app.api.v1.trainer_auth import require_client_or_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.config import settings
from app.core.dependencies import get_chat_session_service, get_trainer_context
from app.core.preflight_timing import elapsed_ms, emit_authenticated_preflight_timing
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
from app.modules.conversation.streaming import (
    STATUS_CHECKING_RECENT_SIGNALS,
    STATUS_GENERATING_RECOMMENDATION,
    STATUS_LOADING_CLIENT_PROFILE,
    STATUS_READING_USER_MESSAGE,
    STATUS_RETRIEVING_TRAINER_KNOWLEDGE,
    STATUS_WRITING_FINAL_COACH_RESPONSE,
    STREAMING_RESPONSE_HEADERS,
    ChatStreamSseEncoder,
    done_event,
    error_event,
    message_delta_event,
    status_event_for_intent,
)
from app.modules.conversation.trace import ChatTraceAccumulator, emit_chat_trace, strip_private_trace


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


def _rate_limit_chat(http_request: Request, user: AuthenticatedUser, trainer_context: TrainerContext) -> int:
    started_at = time.perf_counter()
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
    return elapsed_ms(started_at)


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
    endpoint_entered_at = time.perf_counter()
    request_id = str(uuid4())
    rate_limit_ms: int | None = None
    session_fetch_or_create_ms: int | None = None
    error_category: str | None = None
    try:
        try:
            require_client_or_trainer_actor(user, trainer_context)
            rate_limit_ms = await run_in_threadpool(_rate_limit_chat, http_request, user, trainer_context)
        except Exception as exc:
            error_category = exc.__class__.__name__
            raise

        session_started_at = time.perf_counter()
        try:
            return await run_in_threadpool(
                service.list_history,
                user_id=user.id,
                trainer_context=trainer_context,
                role=role,
                session_type=session_type,
                limit=limit,
                offset=offset,
            )
        finally:
            session_fetch_or_create_ms = elapsed_ms(session_started_at)
    except HTTPException as exc:
        error_category = exc.__class__.__name__
        raise
    except ValueError as exc:
        error_category = exc.__class__.__name__
        _raise_session_value_error(exc)
    except Exception as exc:
        error_category = exc.__class__.__name__
        _raise_unexpected_chat_session_error(
            exc,
            log_message=(
                "Unexpected chat session list failure user_id=%s trainer_id=%s client_id=%s"
            ),
            user_id=user.id,
            trainer_id=trainer_context.trainer_id,
            client_id=trainer_context.client_id,
        )
    finally:
        emit_authenticated_preflight_timing(
            logger,
            request=http_request,
            endpoint="/api/v1/chat/sessions",
            request_id=request_id,
            trainer_context=trainer_context,
            redis_rate_limit_ms=rate_limit_ms,
            session_fetch_or_create_ms=session_fetch_or_create_ms,
            total_preflight_ms=elapsed_ms(
                getattr(http_request.state, "authenticated_preflight_request_started_at", endpoint_entered_at)
            ),
            error_category=error_category,
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

    async def event_stream():
        encoder = ChatStreamSseEncoder(request_id=request_id)
        assistant_chunks: list[str] = []
        conversation_service = getattr(service, "conversation_service", None)
        intent_router = getattr(conversation_service, "intent_router", None)
        intent_preview = None
        if intent_router and hasattr(intent_router, "classify_with_fallback"):
            intent_preview = intent_router.classify_with_fallback(request.message)
        trace = ChatTraceAccumulator(
            request_id=request_id,
            user_id=user.id,
            trainer_id=str(trainer_context.trainer_id or ""),
        )
        trace_conversation_id: str | None = None

        yield encoder.encode(
            status_event_for_intent(
                STATUS_READING_USER_MESSAGE,
                routed_intent=intent_preview,
                request=request,
                session_id=session_id,
            ),
            persist=False,
            request_status="working",
        )
        try:
            yield encoder.encode(
                status_event_for_intent(
                    STATUS_LOADING_CLIENT_PROFILE,
                    routed_intent=intent_preview,
                    request=request,
                    session_id=session_id,
                ),
                persist=False,
                request_status="working",
            )
            if (
                settings.trainer_intelligence_orchestration_enabled
                and getattr(conversation_service, "trainer_intelligence_service", None)
                and trainer_context.trainer_id
                and trainer_context.client_id
            ):
                yield encoder.encode(
                    status_event_for_intent(
                        STATUS_RETRIEVING_TRAINER_KNOWLEDGE,
                        routed_intent=intent_preview,
                        request=request,
                        session_id=session_id,
                    ),
                    persist=False,
                    request_status="working",
                )
                yield encoder.encode(
                    status_event_for_intent(
                        STATUS_CHECKING_RECENT_SIGNALS,
                        routed_intent=intent_preview,
                        request=request,
                        session_id=session_id,
                    ),
                    persist=False,
                    request_status="working",
                )
            status_payload = {"session_id": session_id}
            if intent_preview:
                status_payload["intent_route"] = intent_preview.route.value
            yield encoder.encode(
                status_event_for_intent(
                    STATUS_GENERATING_RECOMMENDATION,
                    routed_intent=intent_preview,
                    request=request,
                    **status_payload,
                ),
                persist=False,
                request_status="working",
            )
            session, user_message, conversation_id, chunks, route_debug, result_state = service.prepare_stream(
                user_id=user.id,
                trainer_context=trainer_context,
                session_id=session_id,
                request=request,
            )
            trace_conversation_id = str(conversation_id or "").strip() or None
            assistant_message_metadata = (
                route_debug.get("assistant_message_metadata")
                if isinstance(route_debug, dict)
                else None
            )
            if not isinstance(assistant_message_metadata, dict):
                assistant_message_metadata = {}
            del route_debug
            yield encoder.encode(
                status_event_for_intent(
                    STATUS_WRITING_FINAL_COACH_RESPONSE,
                    routed_intent=intent_preview,
                    request=request,
                    session_id=session_id,
                    conversation_id=conversation_id,
                    user_message=user_message,
                ),
                persist=False,
                request_status="streaming",
            )
            for chunk in chunks:
                if await http_request.is_disconnected():
                    return
                text_chunk = str(chunk or "")
                if not text_chunk:
                    continue
                assistant_chunks.append(text_chunk)
                token_payload = message_delta_event(
                    text_chunk,
                    session_id=session_id,
                    conversation_id=conversation_id,
                )
                trace.observe_payload(token_payload)
                yield encoder.encode(
                    token_payload,
                    persist=False,
                    request_status="streaming",
                )
            assistant_message = "".join(assistant_chunks).strip()
            if not assistant_message:
                assistant_message = "I'm here with you. Could you rephrase that and I'll try again?"
            token_usage = getattr(result_state, "token_usage", None)
            conversation_usage = getattr(result_state, "conversation_usage", None)
            saved_ai_message = service.persist_streamed_ai_message(
                session_id=session_id,
                content=assistant_message,
                metadata={
                    **assistant_message_metadata,
                    "request_id": request_id,
                    "conversation_id": conversation_id,
                    "legacy_assistant_message_id": getattr(result_state, "assistant_message_id", None),
                    "token_usage": token_usage.model_dump() if token_usage else None,
                    "conversation_usage": conversation_usage.model_dump() if conversation_usage else None,
                },
            )
            done_payload = done_event(
                session_id=session_id,
                conversation_id=conversation_id,
                assistant_message=assistant_message,
                user_message=user_message,
                ai_message=saved_ai_message,
                token_usage=token_usage.model_dump() if token_usage else None,
                conversation_usage=conversation_usage.model_dump() if conversation_usage else None,
                _trace=getattr(result_state, "trace_metadata", {}) or {},
            )
            trace.observe_payload(done_payload)
            yield encoder.encode(
                strip_private_trace(done_payload),
                persist=False,
                request_status="completed",
            )
            persist_side_effects = getattr(service, "persist_post_stream_side_effects", None)
            if callable(persist_side_effects) and result_state is not None:
                persist_side_effects(
                    trainer_context=trainer_context,
                    session=session,
                    request=request,
                    conversation_id=conversation_id,
                )
        except ValueError as exc:
            payload = error_event(str(exc) or CONTROLLED_CHAT_ERROR_DETAIL, session_id=session_id)
            trace.observe_payload(payload)
            yield encoder.encode(
                payload,
                persist=False,
                request_status="failed",
                error_detail=str(exc) or CONTROLLED_CHAT_ERROR_DETAIL,
            )
        except ConversationProcessingError as exc:
            detail = str(exc) or CONTROLLED_CHAT_ERROR_DETAIL
            payload = error_event(detail, session_id=session_id)
            trace.observe_payload(payload)
            yield encoder.encode(
                payload,
                persist=False,
                request_status="failed",
                error_detail=detail,
            )
        except Exception:
            logger.exception("Unexpected chat session stream generator failure session_id=%s", session_id)
            payload = error_event(CONTROLLED_CHAT_ERROR_DETAIL, session_id=session_id)
            trace.observe_payload(payload)
            yield encoder.encode(
                payload,
                persist=False,
                request_status="failed",
                error_detail=CONTROLLED_CHAT_ERROR_DETAIL,
            )
        finally:
            emit_chat_trace(
                trace.build(),
                trainer_id=str(trainer_context.trainer_id or ""),
                client_id=str(trainer_context.client_id or ""),
                conversation_id=trace_conversation_id,
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=STREAMING_RESPONSE_HEADERS,
    )


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
