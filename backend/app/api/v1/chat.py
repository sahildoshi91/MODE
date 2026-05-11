import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.api.v1.trainer_auth import require_client_or_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.config import settings
from app.core.dependencies import get_conversation_service, get_trainer_context
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.modules.conversation.schemas import (
    ChatHistoryResponse,
    ChatRequest,
    ChatRequestEventsResponse,
    ChatResponse,
)
from app.modules.conversation.service import ConversationProcessingError, ConversationService
from app.modules.conversation.streaming import (
    STATUS_READING_USER_MESSAGE,
    STATUS_WRITING_FINAL_COACH_RESPONSE,
    STREAMING_RESPONSE_HEADERS,
    ChatStreamSseEncoder,
    done_event,
    error_event,
    message_delta_event,
    status_event,
)
from app.modules.conversation.trace import ChatTraceAccumulator, strip_private_trace


router = APIRouter()
logger = logging.getLogger(__name__)
CONTROLLED_CHAT_ERROR_DETAIL = "Chat response could not be completed"


def _public_chat_response(response: ChatResponse) -> ChatResponse:
    if settings.expose_route_debug:
        return response
    return response.model_copy(update={"route_debug": None})


def _trace_metadata_from_response(response: ChatResponse) -> dict[str, object]:
    route_debug = response.route_debug
    if route_debug is None:
        return {
            "route": "unknown",
            "router_confidence": 0.0,
            "risk_flags": [],
            "cache_hit": False,
            "retrieval_latency_ms": None,
            "model_used": "unknown",
            "fallback_used": bool(response.fallback_triggered),
            "escalation_triggered": False,
        }
    return {
        "route": route_debug.intent_route or route_debug.flow,
        "router_confidence": route_debug.router_confidence or 0.0,
        "risk_flags": route_debug.risk_flags,
        "cache_hit": False,
        "retrieval_latency_ms": None,
        "model_used": route_debug.execution_model or route_debug.selected_model,
        "fallback_used": bool(response.fallback_triggered or route_debug.fallback_reason),
        "escalation_triggered": bool(
            route_debug.intent_route == "SAFETY_ESCALATION"
            or route_debug.flow == "safety_escalation"
            or route_debug.response_mode == "safe_interim_escalation"
        ),
    }


def _raise_chat_value_error(exc: ValueError) -> None:
    normalized = str(exc).strip().lower()
    if normalized == "conversation not found":
        raise HTTPException(status_code=404, detail="Not found") from exc
    if normalized == "user is not assigned to an active trainer context":
        raise HTTPException(status_code=400, detail="Invalid chat context") from exc
    raise HTTPException(status_code=400, detail="Invalid chat request") from exc


def _raise_controlled_chat_error(
    *,
    endpoint: str,
    exc: Exception,
    user: AuthenticatedUser,
    trainer_context: TrainerContext,
    request: ChatRequest,
) -> None:
    logger.exception(
        "Unexpected chat failure endpoint=%s user_id=%s trainer_id=%s client_id=%s conversation_id=%s",
        endpoint,
        user.id,
        trainer_context.trainer_id,
        trainer_context.client_id,
        request.conversation_id,
        exc_info=exc,
    )
    raise HTTPException(status_code=502, detail=CONTROLLED_CHAT_ERROR_DETAIL)


def _legacy_stream_chat_events(
    service: ConversationService,
    user_id: str,
    trainer_context: TrainerContext,
    request: ChatRequest,
):
    yield status_event(STATUS_READING_USER_MESSAGE, request=request)
    conversation_id, chunks, route_debug, result_state = service.stream_chat(user_id, trainer_context, request)
    yield status_event(
        STATUS_WRITING_FINAL_COACH_RESPONSE,
        request=request,
        conversation_id=conversation_id,
    )
    assistant_chunks: list[str] = []
    for chunk in chunks:
        text_chunk = str(chunk or "")
        if not text_chunk:
            continue
        assistant_chunks.append(text_chunk)
        yield message_delta_event(text_chunk, conversation_id=conversation_id)
    done_payload = {
        "conversation_id": conversation_id,
        "assistant_message": "".join(assistant_chunks).strip(),
        "token_usage": result_state.token_usage.model_dump(),
        "conversation_usage": result_state.conversation_usage.model_dump() if result_state.conversation_usage else None,
        "memory_suggestions": getattr(result_state, "memory_suggestions", []) or [],
    }
    if settings.expose_route_debug and route_debug is not None:
        done_payload["route_debug"] = route_debug.model_dump()
    yield done_event(**done_payload)


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ConversationService = Depends(get_conversation_service),
):
    require_client_or_trainer_actor(user, trainer_context)
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
    trace = ChatTraceAccumulator(
        request_id=str(request.request_id) if request.request_id else str(uuid4()),
        user_id=user.id,
        trainer_id=str(trainer_context.trainer_id or ""),
    )
    try:
        response = service.handle_chat(user.id, trainer_context, request)
        if response.request_id:
            trace.request_id = response.request_id
        trace.observe_payload(message_delta_event(response.assistant_message or ""))
        trace.observe_payload(done_event(
            token_usage=response.token_usage.model_dump(),
            _trace=_trace_metadata_from_response(response),
        ))
        return _public_chat_response(response)
    except ValueError as exc:
        payload = error_event(str(exc) or CONTROLLED_CHAT_ERROR_DETAIL)
        trace.observe_payload(payload)
        _raise_chat_value_error(exc)
    except ConversationProcessingError as exc:
        logger.warning(
            "Conversation processing error endpoint=/api/v1/chat user_id=%s trainer_id=%s client_id=%s",
            user.id,
            trainer_context.trainer_id,
            trainer_context.client_id,
            exc_info=exc,
        )
        payload = error_event(CONTROLLED_CHAT_ERROR_DETAIL)
        trace.observe_payload(payload)
        raise HTTPException(status_code=502, detail=CONTROLLED_CHAT_ERROR_DETAIL)
    except Exception as exc:
        payload = error_event(CONTROLLED_CHAT_ERROR_DETAIL)
        trace.observe_payload(payload)
        _raise_controlled_chat_error(
            endpoint="/api/v1/chat",
            exc=exc,
            user=user,
            trainer_context=trainer_context,
            request=request,
        )
    finally:
        trace.build().log()


@router.get("/history", response_model=ChatHistoryResponse)
async def chat_history(
    http_request: Request,
    conversation_id: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=80, ge=1, le=200),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ConversationService = Depends(get_conversation_service),
):
    require_client_or_trainer_actor(user, trainer_context)
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
    try:
        return service.get_history(
            user_id=user.id,
            trainer_context=trainer_context,
            conversation_id=conversation_id,
            limit=limit,
            cursor=cursor,
        )
    except ValueError as exc:
        _raise_chat_value_error(exc)
    except ConversationProcessingError as exc:
        logger.warning(
            "Conversation processing error endpoint=/api/v1/chat/history user_id=%s trainer_id=%s client_id=%s",
            user.id,
            trainer_context.trainer_id,
            trainer_context.client_id,
            exc_info=exc,
        )
        raise HTTPException(status_code=502, detail=CONTROLLED_CHAT_ERROR_DETAIL)
    except Exception as exc:
        logger.exception(
            "Unexpected chat history failure user_id=%s trainer_id=%s client_id=%s conversation_id=%s",
            user.id,
            trainer_context.trainer_id,
            trainer_context.client_id,
            conversation_id,
            exc_info=exc,
        )
        raise HTTPException(status_code=502, detail=CONTROLLED_CHAT_ERROR_DETAIL)


@router.get("/requests/{request_id}/events", response_model=ChatRequestEventsResponse)
async def chat_request_events(
    request_id: str,
    http_request: Request,
    since_seq: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ConversationService = Depends(get_conversation_service),
):
    require_client_or_trainer_actor(user, trainer_context)
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
    if not trainer_context.trainer_id:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        get_ai_request_events = getattr(service, "get_ai_request_events", None)
        rows = (
            get_ai_request_events(
                request_id=request_id,
                since_seq=since_seq,
                limit=limit,
            )
            if callable(get_ai_request_events)
            else []
        )
        return ChatRequestEventsResponse(
            request_id=request_id,
            events=[
                {
                    "request_id": str(row.get("request_id") or request_id),
                    "seq": int(row.get("seq") or 0),
                    "event_type": str(row.get("event_type") or ""),
                    "stage": row.get("stage"),
                    "payload": row.get("payload") if isinstance(row.get("payload"), dict) else {},
                    "created_at": row.get("created_at"),
                }
                for row in rows
            ],
        )
    except Exception:
        logger.exception(
            "Unexpected chat request events failure request_id=%s trainer_id=%s client_id=%s",
            request_id,
            trainer_context.trainer_id,
            trainer_context.client_id,
        )
        raise HTTPException(status_code=502, detail=CONTROLLED_CHAT_ERROR_DETAIL)


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ConversationService = Depends(get_conversation_service),
):
    require_client_or_trainer_actor(user, trainer_context)
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
    request_id = str(request.request_id) if request.request_id else str(uuid4())
    create_ai_request_record = getattr(service, "create_ai_request_record", None)
    append_ai_request_event = getattr(service, "append_ai_request_event", None)
    update_ai_request_status = getattr(service, "update_ai_request_status", None)

    async def event_stream():
        nonlocal request_id
        encoder = ChatStreamSseEncoder(request_id=request_id)
        request_record_created = False
        trace = ChatTraceAccumulator(
            request_id=request_id,
            user_id=user.id,
            trainer_id=str(trainer_context.trainer_id or ""),
        )

        def maybe_attach_request_record(payload: dict[str, object]) -> None:
            nonlocal request_id, request_record_created
            conversation_id = str(payload.get("conversation_id") or "").strip()
            if request_record_created or not conversation_id or not callable(create_ai_request_record):
                return
            request_record_created = True
            try:
                ai_request_row = create_ai_request_record(
                    conversation_id=conversation_id,
                    trainer_context=trainer_context,
                    request=request,
                    metadata={
                        "endpoint": "/api/v1/chat/stream",
                    },
                )
                if isinstance(ai_request_row, dict):
                    request_id = str(ai_request_row.get("id") or request_id)
                    encoder.request_id = request_id
                if callable(append_ai_request_event):
                    encoder.append_event = append_ai_request_event
                if callable(update_ai_request_status):
                    encoder.update_status = update_ai_request_status
            except Exception:
                logger.exception(
                    "Failed to create chat stream request record trainer_id=%s client_id=%s",
                    trainer_context.trainer_id,
                    trainer_context.client_id,
                )

        def request_status_for(payload: dict[str, object]) -> str | None:
            payload_type = str(payload.get("type") or "")
            if payload_type == "status":
                return "working"
            if payload_type in {"token", "message_delta"}:
                return "streaming"
            if payload_type == "done":
                return "completed"
            if payload_type == "error":
                return "failed"
            return None

        try:
            stream_events = getattr(service, "stream_chat_events", None)
            event_iterator = (
                stream_events(user.id, trainer_context, request)
                if callable(stream_events)
                else _legacy_stream_chat_events(service, user.id, trainer_context, request)
            )
            for payload in event_iterator:
                if await http_request.is_disconnected():
                    break
                trace.observe_payload(payload)
                payload_type = str(payload.get("type") or "")
                client_payload = strip_private_trace(payload)
                request_status = request_status_for(payload)
                error_detail = str(payload.get("detail") or "") if payload_type == "error" else None
                yield encoder.encode(client_payload, persist=False)
                maybe_attach_request_record(payload)
                encoder.record_encoded_event(
                    client_payload,
                    persist=payload_type not in {"token", "message_delta"},
                    request_status=request_status,
                    error_detail=error_detail,
                )
        except ValueError as exc:
            payload = error_event(str(exc) or CONTROLLED_CHAT_ERROR_DETAIL)
            trace.observe_payload(payload)
            yield encoder.encode(payload, persist=False)
            encoder.record_encoded_event(
                payload,
                request_status="failed",
                error_detail=str(payload.get("detail") or CONTROLLED_CHAT_ERROR_DETAIL),
            )
        except ConversationProcessingError as exc:
            detail = str(exc) or CONTROLLED_CHAT_ERROR_DETAIL
            payload = error_event(detail)
            trace.observe_payload(payload)
            yield encoder.encode(payload, persist=False)
            encoder.record_encoded_event(
                payload,
                request_status="failed",
                error_detail=detail,
            )
        except Exception as exc:
            logger.exception(
                "Unexpected chat stream failure user_id=%s trainer_id=%s client_id=%s",
                user.id,
                trainer_context.trainer_id,
                trainer_context.client_id,
                exc_info=exc,
            )
            payload = error_event(CONTROLLED_CHAT_ERROR_DETAIL)
            trace.observe_payload(payload)
            yield encoder.encode(payload, persist=False)
            encoder.record_encoded_event(
                payload,
                request_status="failed",
                error_detail=CONTROLLED_CHAT_ERROR_DETAIL,
            )
        finally:
            trace.request_id = request_id
            trace.build().log()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=STREAMING_RESPONSE_HEADERS,
    )
