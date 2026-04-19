import json
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.config import settings
from app.core.dependencies import get_conversation_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.modules.conversation.schemas import (
    ChatHistoryResponse,
    ChatRequest,
    ChatRequestEventsResponse,
    ChatResponse,
)
from app.modules.conversation.service import ConversationProcessingError, ConversationService


router = APIRouter()
logger = logging.getLogger(__name__)
CONTROLLED_CHAT_ERROR_DETAIL = "Chat response could not be completed"


def _public_route_debug(route_debug: object | None) -> dict | None:
    if not settings.expose_route_debug or route_debug is None:
        return None
    return route_debug.model_dump()


def _public_chat_response(response: ChatResponse) -> ChatResponse:
    if settings.expose_route_debug:
        return response
    return response.model_copy(update={"route_debug": None})


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


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ConversationService = Depends(get_conversation_service),
):
    try:
        return _public_chat_response(service.handle_chat(user.id, trainer_context, request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ConversationProcessingError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        _raise_controlled_chat_error(
            endpoint="/api/v1/chat",
            exc=exc,
            user=user,
            trainer_context=trainer_context,
            request=request,
        )


@router.get("/history", response_model=ChatHistoryResponse)
async def chat_history(
    conversation_id: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=80, ge=1, le=200),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ConversationService = Depends(get_conversation_service),
):
    try:
        return service.get_history(
            user_id=user.id,
            trainer_context=trainer_context,
            conversation_id=conversation_id,
            limit=limit,
            cursor=cursor,
        )
    except ValueError as exc:
        detail = str(exc)
        if detail.strip().lower() == "conversation not found":
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=400, detail=detail)
    except ConversationProcessingError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
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
    since_seq: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ConversationService = Depends(get_conversation_service),
):
    del user
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
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ConversationService = Depends(get_conversation_service),
):
    request_id = str(request.request_id) if request.request_id else str(uuid4())
    try:
        conversation_id, chunks, route_debug, result_state = service.stream_chat(user.id, trainer_context, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ConversationProcessingError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        _raise_controlled_chat_error(
            endpoint="/api/v1/chat/stream",
            exc=exc,
            user=user,
            trainer_context=trainer_context,
            request=request,
        )

    create_ai_request_record = getattr(service, "create_ai_request_record", None)
    append_ai_request_event = getattr(service, "append_ai_request_event", None)
    update_ai_request_status = getattr(service, "update_ai_request_status", None)
    ai_request_row = (
        create_ai_request_record(
            conversation_id=conversation_id,
            trainer_context=trainer_context,
            request=request,
            metadata={
                "endpoint": "/api/v1/chat/stream",
            },
        )
        if callable(create_ai_request_record)
        else None
    )
    if isinstance(ai_request_row, dict):
        request_id = str(ai_request_row.get("id") or request_id)

    def event_stream():
        seq = 0
        stream_started = False
        assistant_chunks: list[str] = []

        def emit_event(
            payload: dict[str, object],
            *,
            event_type: str | None = None,
            stage: str | None = None,
            persist: bool = True,
            status: str | None = None,
            error_detail: str | None = None,
        ) -> str:
            nonlocal seq
            seq += 1
            payload_with_meta = {
                **payload,
                "request_id": request_id,
                "seq": seq,
            }
            if persist and callable(append_ai_request_event):
                append_ai_request_event(
                    request_id=request_id,
                    seq=seq,
                    event_type=event_type or str(payload.get("type") or "progress"),
                    stage=stage,
                    payload=payload,
                )
            if status and callable(update_ai_request_status):
                update_ai_request_status(
                    request_id=request_id,
                    status=status,
                    latest_event_seq=seq,
                    error_detail=error_detail,
                )
            return f"data: {json.dumps(payload_with_meta)}\n\n"

        start_payload = {
            "type": "start",
            "conversation_id": conversation_id,
        }
        route_debug_payload = _public_route_debug(route_debug)
        if route_debug_payload is not None:
            start_payload["route_debug"] = route_debug_payload
        yield emit_event(start_payload, persist=False)
        yield emit_event(
            {
                "type": "ack",
                "conversation_id": conversation_id,
                "stage": "reviewing_message",
            },
            event_type="ack",
            stage="reviewing_message",
            status="working",
        )
        yield emit_event(
            {
                "type": "progress",
                "conversation_id": conversation_id,
                "stage": "checking_context",
            },
            event_type="progress",
            stage="checking_context",
            status="working",
        )
        try:
            for chunk in chunks:
                if not stream_started:
                    stream_started = True
                    yield emit_event(
                        {
                            "type": "progress",
                            "conversation_id": conversation_id,
                            "stage": "preparing_response",
                        },
                        event_type="progress",
                        stage="preparing_response",
                        status="streaming",
                    )
                text_chunk = str(chunk or "")
                if not text_chunk:
                    continue
                assistant_chunks.append(text_chunk)
                yield emit_event(
                    {
                        "type": "delta",
                        "conversation_id": conversation_id,
                        "text": text_chunk,
                    },
                    event_type="delta",
                    status="streaming",
                )
            yield emit_event(
                {
                    "type": "progress",
                    "conversation_id": conversation_id,
                    "stage": "finalizing_response",
                },
                event_type="progress",
                stage="finalizing_response",
                status="streaming",
            )
            assistant_message = "".join(assistant_chunks).strip()
            completed_payload = {
                "type": "completed",
                "conversation_id": conversation_id,
                "assistant_message": assistant_message,
                "token_usage": result_state.token_usage.model_dump(),
                "conversation_usage": (
                    result_state.conversation_usage.model_dump()
                    if result_state.conversation_usage else None
                ),
            }
            if route_debug_payload is not None:
                completed_payload["route_debug"] = route_debug_payload
            yield emit_event(
                completed_payload,
                event_type="completed",
                stage="finalizing_response",
                status="completed",
            )
            done_payload = {
                "type": "done",
                "conversation_id": conversation_id,
                "token_usage": result_state.token_usage.model_dump(),
                "conversation_usage": result_state.conversation_usage.model_dump() if result_state.conversation_usage else None,
            }
            if route_debug_payload is not None:
                done_payload["route_debug"] = route_debug_payload
            yield emit_event(done_payload, persist=False)
            if callable(update_ai_request_status):
                update_ai_request_status(
                    request_id=request_id,
                    status="completed",
                    latest_event_seq=seq,
                    completed_message_id=result_state.assistant_message_id,
                )
        except ConversationProcessingError as exc:
            detail = str(exc)
            yield emit_event(
                {
                    "type": "failed",
                    "detail": detail,
                    "conversation_id": conversation_id,
                },
                event_type="failed",
                status="failed",
                error_detail=detail,
            )
            yield emit_event(
                {
                    "type": "error",
                    "detail": detail,
                    "conversation_id": conversation_id,
                },
                persist=False,
            )
        except Exception as exc:
            logger.exception(
                "Unexpected stream generator failure conversation_id=%s trainer_id=%s client_id=%s",
                conversation_id,
                trainer_context.trainer_id,
                trainer_context.client_id,
                exc_info=exc,
            )
            yield emit_event(
                {
                    "type": "failed",
                    "detail": CONTROLLED_CHAT_ERROR_DETAIL,
                    "conversation_id": conversation_id,
                },
                event_type="failed",
                status="failed",
                error_detail=CONTROLLED_CHAT_ERROR_DETAIL,
            )
            yield emit_event(
                {
                    "type": "error",
                    "detail": CONTROLLED_CHAT_ERROR_DETAIL,
                    "conversation_id": conversation_id,
                },
                persist=False,
            )

    return StreamingResponse(event_stream(), media_type="text/event-stream")
