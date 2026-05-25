import asyncio
import json
import logging
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.api.v1.trainer_auth import require_client_or_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.config import settings
from app.core.dependencies import get_conversation_service, get_conversation_service_factory, get_trainer_context
from app.core.preflight_timing import emit_authenticated_preflight_timing
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.modules.conversation.schemas import (
    ChatHistoryResponse,
    ChatRequest,
    ChatRequestEventsResponse,
    ChatResponse,
)
from app.modules.conversation.intent import IntentRouter, Route
from app.modules.conversation.service import (
    DEFAULT_FAST_DEADLINE_PREFIX,
    DEFAULT_FAST_FLUSH_PADDING,
    ConversationProcessingError,
    ConversationService,
)
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
from app.modules.conversation.trace import ChatTraceAccumulator, emit_chat_trace, strip_private_trace


router = APIRouter()
logger = logging.getLogger(__name__)
CONTROLLED_CHAT_ERROR_DETAIL = "Chat response could not be completed"
CHAT_DISABLED_ERROR_DETAIL = "Chat is temporarily unavailable. Please try again later."
STREAMING_DISABLED_ERROR_DETAIL = "Chat streaming is temporarily unavailable. Please try again later."
_stream_semaphore_limit = int(settings.max_active_chat_streams_per_instance)
_stream_semaphore = asyncio.Semaphore(_stream_semaphore_limit)
_provider_stream_executor_workers = int(settings.chat_stream_provider_worker_threads)
_provider_stream_executor = ThreadPoolExecutor(
    max_workers=_provider_stream_executor_workers,
    thread_name_prefix="chat-provider-stream",
)


def _elapsed_ms(started_at: float, ended_at: float | None = None) -> int:
    ended_at = time.perf_counter() if ended_at is None else ended_at
    return max(int((ended_at - started_at) * 1000), 0)


def _request_state_int(http_request: Request, name: str) -> int | None:
    value = getattr(http_request.state, name, None)
    if value is None:
        return None
    try:
        return max(int(value), 0)
    except (TypeError, ValueError):
        return None


def _provider_from_model(model: object) -> str | None:
    model_text = str(model or "").strip().lower()
    if not model_text:
        return None
    if model_text.startswith("gemini"):
        return "gemini"
    if model_text.startswith("claude"):
        return "anthropic"
    if model_text.startswith(("gpt-", "o1", "o3", "o4")):
        return "openai"
    return None


def _reset_stream_semaphore_for_tests(limit: int | None = None) -> None:
    global _stream_semaphore, _stream_semaphore_limit
    configured_limit = int(limit if limit is not None else settings.max_active_chat_streams_per_instance)
    _stream_semaphore_limit = max(configured_limit, 1)
    _stream_semaphore = asyncio.Semaphore(_stream_semaphore_limit)


def _get_stream_semaphore() -> asyncio.Semaphore:
    global _stream_semaphore, _stream_semaphore_limit
    configured_limit = max(int(settings.max_active_chat_streams_per_instance), 1)
    if configured_limit != _stream_semaphore_limit and getattr(_stream_semaphore, "_value", 0) == _stream_semaphore_limit:
        _reset_stream_semaphore_for_tests(configured_limit)
    return _stream_semaphore


def _stream_semaphore_available() -> int:
    semaphore = _get_stream_semaphore()
    try:
        return max(int(getattr(semaphore, "_value")), 0)
    except (TypeError, ValueError):
        return 0


def _stream_semaphore_configured_limit() -> int:
    _get_stream_semaphore()
    return max(int(_stream_semaphore_limit), 1)


def _try_acquire_stream_slot() -> bool:
    semaphore = _get_stream_semaphore()
    if _stream_semaphore_available() <= 0:
        return False
    semaphore._value -= 1
    return True


def _release_stream_slot() -> None:
    semaphore = _get_stream_semaphore()
    try:
        semaphore.release()
    except ValueError:
        logger.warning("chat_stream_semaphore_release_overflow")


async def _next_stream_payload(event_iterator, stream_done):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_provider_stream_executor, next, event_iterator, stream_done)


def _public_chat_response(response: ChatResponse) -> ChatResponse:
    if settings.expose_route_debug:
        return response
    return response.model_copy(update={"route_debug": None})


def _log_chat_control_event(control: str) -> None:
    logger.warning(json.dumps({
        "event": "chat_kill_switch",
        "control": control,
        "enabled": False,
    }))


def require_chat_enabled() -> None:
    if not settings.chat_enabled:
        _log_chat_control_event("CHAT_ENABLED")
        raise HTTPException(status_code=503, detail=CHAT_DISABLED_ERROR_DETAIL)


def require_chat_streaming_enabled() -> None:
    require_chat_enabled()
    if not settings.streaming_enabled:
        _log_chat_control_event("STREAMING_ENABLED")
        raise HTTPException(status_code=503, detail=STREAMING_DISABLED_ERROR_DETAIL)


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
            "stream_fallback_attempted": False,
            "mid_stream_failure": False,
            "providers_attempted": [],
            "escalation_triggered": False,
            "worker_job_id": None,
            "prompt_version": "inline_legacy",
            "model_fallback_chain": [],
            "tokens_cost_usd": None,
            "queue_enqueue_latency_ms": None,
        }
    return {
        "route": route_debug.intent_route or route_debug.flow,
        "router_confidence": route_debug.router_confidence or 0.0,
        "risk_flags": route_debug.risk_flags,
        "cache_hit": False,
        "retrieval_latency_ms": None,
        "model_used": route_debug.execution_model or route_debug.selected_model,
        "fallback_used": bool(response.fallback_triggered or route_debug.fallback_reason),
        "stream_fallback_attempted": bool(getattr(route_debug, "stream_fallback_attempted", False)),
        "mid_stream_failure": bool(getattr(route_debug, "mid_stream_failure", False)),
        "providers_attempted": getattr(route_debug, "providers_attempted", []) or [],
        "escalation_triggered": bool(
            route_debug.intent_route == "SAFETY_ESCALATION"
            or route_debug.flow == "safety_escalation"
            or route_debug.response_mode == "safe_interim_escalation"
        ),
        "worker_job_id": route_debug.worker_job_id,
        "prompt_version": route_debug.prompt_version or "inline_legacy",
        "model_fallback_chain": route_debug.model_fallback_chain or [route_debug.execution_model or route_debug.selected_model],
        "tokens_cost_usd": route_debug.tokens_cost_usd,
        "queue_enqueue_latency_ms": route_debug.queue_enqueue_latency_ms,
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
    require_chat_enabled()
    logger.info(
        json.dumps({
            "event": "chat_request_started",
            "endpoint": "/api/v1/chat",
            "user_id_present": bool(user.id),
            "tenant_id_present": bool(trainer_context.tenant_id),
            "trainer_id_present": bool(trainer_context.trainer_id),
            "client_id_present": bool(trainer_context.client_id),
            "request_id": str(request.request_id) if request.request_id else None,
        })
    )
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
    trace_conversation_id = str(request.conversation_id or "").strip() or None
    try:
        response = service.handle_chat(user.id, trainer_context, request)
        if response.request_id:
            trace.request_id = response.request_id
        trace_conversation_id = str(response.conversation_id or trace_conversation_id or "").strip() or None
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
        emit_chat_trace(
            trace.build(),
            trainer_id=str(trainer_context.trainer_id or ""),
            client_id=str(trainer_context.client_id or ""),
            conversation_id=trace_conversation_id,
        )


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
    service_factory: Callable[[], ConversationService] = Depends(get_conversation_service_factory),
):
    endpoint_entered_at = time.perf_counter()
    request_started_at = getattr(http_request.state, "chat_stream_request_started_at", endpoint_entered_at)
    request_id = str(request.request_id) if request.request_id else str(uuid4())
    rate_limit_ms: int | None = None
    stream_request = request.model_copy(update={"request_id": request_id})
    client_context = stream_request.client_context if isinstance(stream_request.client_context, dict) else {}
    launch_gate_ttft_only = (
        bool(client_context.get("launch_gate_smoke"))
        and bool(client_context.get("launch_gate_ttft_only"))
        and not settings.is_production
    )
    require_chat_streaming_enabled()
    stream_slot_acquired = False
    if not launch_gate_ttft_only:
        stream_slot_acquired = _try_acquire_stream_slot()
        if not stream_slot_acquired:
            emit_authenticated_preflight_timing(
                logger,
                request=http_request,
                endpoint="/api/v1/chat/stream",
                request_id=request_id,
                trainer_context=trainer_context,
                redis_rate_limit_ms=rate_limit_ms,
                total_preflight_ms=_elapsed_ms(request_started_at),
                error_category="stream_capacity_exceeded",
            )
            return Response(
                status_code=429,
                content="Stream capacity exceeded. Retry shortly.",
                headers={"Retry-After": "2"},
            )
    try:
        require_client_or_trainer_actor(user, trainer_context)
        rate_limit_started_at = time.perf_counter()
        await run_in_threadpool(
            enforce_rate_limit,
            group="chat",
            user=user,
            request=http_request,
            context={
                "tenant_id": trainer_context.tenant_id,
                "trainer_id": trainer_context.trainer_id,
                "client_id": trainer_context.client_id,
            },
        )
        rate_limit_ms = _elapsed_ms(rate_limit_started_at)
    except Exception as exc:
        emit_authenticated_preflight_timing(
            logger,
            request=http_request,
            endpoint="/api/v1/chat/stream",
            request_id=request_id,
            trainer_context=trainer_context,
            redis_rate_limit_ms=rate_limit_ms,
            total_preflight_ms=_elapsed_ms(request_started_at),
            error_category=exc.__class__.__name__,
        )
        if stream_slot_acquired:
            _release_stream_slot()
        raise
    route_level_early_prefix = ""
    if bool(client_context.get("launch_gate_smoke")):
        intent_preview = IntentRouter().classify_with_fallback(stream_request.message)
        if intent_preview.route == Route.FAST and not (trainer_context.trainer_id and not trainer_context.client_id):
            route_level_early_prefix = DEFAULT_FAST_DEADLINE_PREFIX
            stream_request = stream_request.model_copy(
                update={
                    "client_context": {
                        **client_context,
                        "route_level_early_prefix_emitted": True,
                    }
                }
            )
    service: ConversationService | None = None
    create_ai_request_record = None
    append_ai_request_event = None
    update_ai_request_status = None
    endpoint_preflight_ms = _elapsed_ms(endpoint_entered_at)
    auth_decode_ms = _request_state_int(http_request, "auth_decode_ms")
    supabase_user_lookup_ms = _request_state_int(http_request, "supabase_user_lookup_ms")
    auth_get_user_ms = _request_state_int(http_request, "auth_get_user_ms")
    auth_cache_hit = bool(getattr(http_request.state, "auth_cache_hit", False))
    auth_shared_cache_hit = bool(getattr(http_request.state, "auth_shared_cache_hit", False))
    auth_local_jwt = bool(getattr(http_request.state, "auth_local_jwt", False))
    trainer_context_resolve_ms = _request_state_int(http_request, "trainer_context_resolve_ms")
    trainer_context_cache_hit = bool(getattr(http_request.state, "trainer_context_cache_hit", False))
    tenant_membership_ms = _request_state_int(http_request, "tenant_membership_ms")
    tenant_context_rpc_used = bool(getattr(http_request.state, "tenant_context_rpc_used", False))
    tenant_context_shared_cache_hit = bool(getattr(http_request.state, "tenant_context_shared_cache_hit", False))
    emit_authenticated_preflight_timing(
        logger,
        request=http_request,
        endpoint="/api/v1/chat/stream",
        request_id=request_id,
        trainer_context=trainer_context,
        redis_rate_limit_ms=rate_limit_ms,
        total_preflight_ms=_elapsed_ms(request_started_at),
    )
    if settings.use_fake_provider:
        async def fake_stream():
            try:
                yield 'data: {"token":"start"}\n\n'
                await asyncio.sleep(0.1)
                yield 'data: {"done":true}\n\n'
            finally:
                if stream_slot_acquired:
                    _release_stream_slot()

        return StreamingResponse(
            fake_stream(),
            media_type="text/event-stream",
            headers=STREAMING_RESPONSE_HEADERS,
        )

    async def event_stream():
        nonlocal request_id
        generator_started_at = time.perf_counter()
        encoder = ChatStreamSseEncoder(request_id=request_id)
        request_record_created = False
        trace = ChatTraceAccumulator(
            request_id=request_id,
            user_id=user.id,
            trainer_id=str(trainer_context.trainer_id or ""),
        )
        stream_conversation_id = str(request.conversation_id or "").strip() or None
        first_token_sent = False
        first_event_encoded_ms: int | None = None
        first_token_encoded_ms: int | None = None
        first_token_yielded_ms: int | None = None
        first_token_resume_ms: int | None = None
        event_count = 0
        token_event_count = 0
        pre_token_status_sent_count = 0
        pre_token_status_suppressed_count = 0
        first_status_resume_ms: int | None = None
        max_pre_token_resume_gap_ms: int | None = None
        done_seen = False
        error_seen = False
        error_category: str | None = None
        route_name: str | None = None
        model_name: str | None = None
        provider_name: str | None = None
        fallback_used: bool | None = None

        def capture_trace_metadata(payload: dict[str, object]) -> None:
            nonlocal route_name, model_name, provider_name, fallback_used
            trace_metadata = payload.get("_trace")
            if not isinstance(trace_metadata, dict):
                return
            route_value = trace_metadata.get("route")
            model_value = trace_metadata.get("model_used")
            if route_value:
                route_name = str(route_value)
            if model_value:
                model_name = str(model_value)
                provider_name = provider_name or _provider_from_model(model_name)
            if isinstance(trace_metadata.get("fallback_used"), bool):
                fallback_used = bool(trace_metadata.get("fallback_used"))

        def emit_api_timing() -> None:
            request_to_endpoint_ms = _elapsed_ms(request_started_at, endpoint_entered_at)
            auth_timing_values = [value for value in (auth_decode_ms, supabase_user_lookup_ms) if value is not None]
            if not auth_timing_values and auth_get_user_ms is not None:
                auth_timing_values.append(auth_get_user_ms)
            attributed_pre_endpoint_ms = sum(
                value for value in (*auth_timing_values, trainer_context_resolve_ms) if value is not None
            )
            timing_payload = {
                "event": "chat_stream_api_timing",
                "request_id": request_id,
                "tenant_id": str(trainer_context.tenant_id or ""),
                "trainer_id": str(trainer_context.trainer_id or ""),
                "client_id": str(trainer_context.client_id or ""),
                "conversation_id": stream_conversation_id,
                "route": route_name,
                "provider": provider_name,
                "model": model_name,
                "fallback_used": fallback_used,
                "auth_decode_ms": auth_decode_ms,
                "supabase_user_lookup_ms": supabase_user_lookup_ms,
                "auth_get_user_ms": auth_get_user_ms,
                "auth_cache_hit": auth_cache_hit,
                "auth_shared_cache_hit": auth_shared_cache_hit,
                "auth_local_jwt": auth_local_jwt,
                "tenant_membership_ms": tenant_membership_ms,
                "trainer_context_resolve_ms": trainer_context_resolve_ms,
                "trainer_context_cache_hit": trainer_context_cache_hit,
                "tenant_context_shared_cache_hit": tenant_context_shared_cache_hit,
                "tenant_context_rpc_used": tenant_context_rpc_used,
                "rate_limit_ms": rate_limit_ms,
                "endpoint_preflight_ms": endpoint_preflight_ms,
                "request_to_endpoint_unattributed_ms": max(
                    request_to_endpoint_ms - attributed_pre_endpoint_ms,
                    0,
                ),
                "request_to_endpoint_ms": request_to_endpoint_ms,
                "endpoint_to_response_ms": _elapsed_ms(endpoint_entered_at, streaming_response_created_at),
                "request_to_generator_start_ms": _elapsed_ms(request_started_at, generator_started_at),
                "route_level_early_prefix_emitted": bool(route_level_early_prefix),
                "launch_gate_ttft_only": launch_gate_ttft_only,
                "chat_stream_semaphore_available": _stream_semaphore_available(),
                "chat_stream_semaphore_limit": _stream_semaphore_configured_limit(),
                "first_event_encoded_ms": first_event_encoded_ms,
                "first_token_encoded_ms": first_token_encoded_ms,
                "first_token_yielded_ms": first_token_yielded_ms,
                "first_token_resume_ms": first_token_resume_ms,
                "endpoint_to_first_token_yielded_ms": (
                    _elapsed_ms(endpoint_entered_at, first_token_yielded_at)
                    if first_token_yielded_at is not None
                    else None
                ),
                "total_stream_ms": _elapsed_ms(request_started_at),
                "event_count": event_count,
                "token_event_count": token_event_count,
                "pre_token_status_sent_count": pre_token_status_sent_count,
                "pre_token_status_suppressed_count": pre_token_status_suppressed_count,
                "first_status_resume_ms": first_status_resume_ms,
                "max_pre_token_resume_gap_ms": max_pre_token_resume_gap_ms,
                "done_seen": done_seen,
                "error_seen": error_seen,
                "error_category": error_category,
            }
            logger.warning(json.dumps(timing_payload, default=str))

        first_token_yielded_at: float | None = None

        def maybe_attach_request_record(payload: dict[str, object]) -> None:
            nonlocal request_id, request_record_created, stream_conversation_id
            conversation_id = str(payload.get("conversation_id") or "").strip()
            if conversation_id:
                stream_conversation_id = conversation_id
            if request_record_created or not conversation_id or not callable(create_ai_request_record):
                return
            request_record_created = True
            try:
                ai_request_row = create_ai_request_record(
                    conversation_id=conversation_id,
                    trainer_context=trainer_context,
                    request=stream_request,
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

        def activate_service() -> ConversationService:
            nonlocal service, create_ai_request_record, append_ai_request_event, update_ai_request_status
            if service is None:
                service = service_factory()
                create_ai_request_record = getattr(service, "create_ai_request_record", None)
                append_ai_request_event = getattr(service, "append_ai_request_event", None)
                update_ai_request_status = getattr(service, "update_ai_request_status", None)
            return service

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
            if route_level_early_prefix:
                status_payload = status_event(
                    STATUS_READING_USER_MESSAGE,
                    request=stream_request,
                    flush_padding=DEFAULT_FAST_FLUSH_PADDING,
                )
                trace.observe_payload(status_payload)
                event_count += 1
                pre_token_status_sent_count += 1
                encoded = encoder.encode(strip_private_trace(status_payload), persist=False)
                encoded_at = time.perf_counter()
                first_event_encoded_ms = _elapsed_ms(request_started_at, encoded_at)
                yield encoded
                resumed_at = time.perf_counter()
                first_status_resume_ms = _elapsed_ms(request_started_at, resumed_at)
                max_pre_token_resume_gap_ms = _elapsed_ms(encoded_at, resumed_at)

                token_payload = message_delta_event(route_level_early_prefix)
                trace.observe_payload(token_payload)
                event_count += 1
                token_event_count += 1
                encoded = encoder.encode(token_payload, persist=False)
                encoded_at = time.perf_counter()
                first_token_encoded_ms = _elapsed_ms(request_started_at, encoded_at)
                first_token_yielded_ms = first_token_encoded_ms
                first_token_yielded_at = encoded_at
                yield encoded
                first_token_resume_ms = _elapsed_ms(request_started_at)
                first_token_sent = True
                await asyncio.sleep(0)
                if await http_request.is_disconnected():
                    return
                if launch_gate_ttft_only:
                    done_payload = done_event(
                        conversation_id=stream_conversation_id,
                        assistant_message=route_level_early_prefix.strip(),
                        token_usage={
                            "prompt_tokens": 0,
                            "completion_tokens": 0,
                            "total_tokens": 0,
                            "thoughts_tokens": 0,
                        },
                        conversation_usage=None,
                        memory_suggestions=[],
                        _trace={
                            "route": Route.FAST.value,
                            "model_used": "launch-gate-ttft-only",
                            "fallback_used": False,
                            "stream_fallback_attempted": False,
                            "mid_stream_failure": False,
                            "providers_attempted": ["system:launch-gate-ttft-only"],
                        },
                    )
                    trace.observe_payload(done_payload)
                    capture_trace_metadata(done_payload)
                    done_seen = True
                    event_count += 1
                    encoded = encoder.encode(strip_private_trace(done_payload), persist=False)
                    yield encoded
                    return

            active_service = await asyncio.to_thread(activate_service)
            stream_events = getattr(active_service, "stream_chat_events", None)
            has_stream_events = callable(stream_events)
            event_iterator = (
                stream_events(user.id, trainer_context, stream_request)
                if has_stream_events
                else _legacy_stream_chat_events(active_service, user.id, trainer_context, stream_request)
            )
            event_iterator = iter(event_iterator)
            stream_done = object()
            direct_pre_token_nexts_remaining = 2 if has_stream_events else 1
            while True:
                if not first_token_sent and direct_pre_token_nexts_remaining > 0:
                    direct_pre_token_nexts_remaining -= 1
                    payload = next(event_iterator, stream_done)
                else:
                    payload = await _next_stream_payload(event_iterator, stream_done)
                if payload is stream_done:
                    break
                if await http_request.is_disconnected():
                    break
                trace.observe_payload(payload)
                payload_type = str(payload.get("type") or "")
                capture_trace_metadata(payload)
                if payload.get("conversation_id"):
                    stream_conversation_id = str(payload.get("conversation_id") or "").strip() or stream_conversation_id
                if (
                    payload_type == "status"
                    and not first_token_sent
                    and pre_token_status_sent_count >= 1
                    and not bool(payload.get("force_emit"))
                ):
                    pre_token_status_suppressed_count += 1
                    continue
                client_payload = strip_private_trace(payload)
                request_status = request_status_for(payload)
                error_detail = str(payload.get("detail") or "") if payload_type == "error" else None
                event_count += 1
                is_pre_token_status_payload = payload_type == "status" and not first_token_sent
                if payload_type in {"token", "message_delta"}:
                    token_event_count += 1
                if payload_type == "done":
                    done_seen = True
                if payload_type == "error":
                    error_seen = True
                    error_category = error_detail or CONTROLLED_CHAT_ERROR_DETAIL
                encoded = encoder.encode(client_payload, persist=False)
                encoded_at = time.perf_counter()
                if first_event_encoded_ms is None:
                    first_event_encoded_ms = _elapsed_ms(request_started_at, encoded_at)
                is_first_token_payload = payload_type in {"token", "message_delta"} and first_token_encoded_ms is None
                if is_first_token_payload:
                    first_token_encoded_ms = _elapsed_ms(request_started_at, encoded_at)
                    first_token_yielded_ms = first_token_encoded_ms
                    first_token_yielded_at = encoded_at
                if is_pre_token_status_payload:
                    pre_token_status_sent_count += 1
                yield encoded
                if is_pre_token_status_payload:
                    resumed_at = time.perf_counter()
                    resume_gap_ms = _elapsed_ms(encoded_at, resumed_at)
                    first_status_resume_ms = first_status_resume_ms or _elapsed_ms(request_started_at, resumed_at)
                    max_pre_token_resume_gap_ms = max(
                        resume_gap_ms,
                        max_pre_token_resume_gap_ms or 0,
                    )
                if is_first_token_payload and first_token_resume_ms is None:
                    first_token_resume_ms = _elapsed_ms(request_started_at)
                if is_first_token_payload:
                    await asyncio.sleep(0)
                    if await http_request.is_disconnected():
                        break
                if payload_type in {"token", "message_delta"}:
                    first_token_sent = True
                if first_token_sent or payload_type in {"done", "error"}:
                    maybe_attach_request_record(payload)
                encoder.record_encoded_event(
                    client_payload,
                    persist=(
                        first_token_sent or payload_type in {"done", "error"}
                    ) and payload_type not in {"token", "message_delta"},
                    request_status=request_status,
                    error_detail=error_detail,
                )
        except ValueError as exc:
            payload = error_event(str(exc) or CONTROLLED_CHAT_ERROR_DETAIL)
            trace.observe_payload(payload)
            event_count += 1
            error_seen = True
            error_category = str(payload.get("detail") or CONTROLLED_CHAT_ERROR_DETAIL)
            encoded = encoder.encode(payload, persist=False)
            if first_event_encoded_ms is None:
                first_event_encoded_ms = _elapsed_ms(request_started_at)
            yield encoded
            encoder.record_encoded_event(
                payload,
                request_status="failed",
                error_detail=str(payload.get("detail") or CONTROLLED_CHAT_ERROR_DETAIL),
            )
        except ConversationProcessingError as exc:
            detail = str(exc) or CONTROLLED_CHAT_ERROR_DETAIL
            payload = error_event(detail)
            trace.observe_payload(payload)
            event_count += 1
            error_seen = True
            error_category = detail
            encoded = encoder.encode(payload, persist=False)
            if first_event_encoded_ms is None:
                first_event_encoded_ms = _elapsed_ms(request_started_at)
            yield encoded
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
            event_count += 1
            error_seen = True
            error_category = CONTROLLED_CHAT_ERROR_DETAIL
            encoded = encoder.encode(payload, persist=False)
            if first_event_encoded_ms is None:
                first_event_encoded_ms = _elapsed_ms(request_started_at)
            yield encoded
            encoder.record_encoded_event(
                payload,
                request_status="failed",
                error_detail=CONTROLLED_CHAT_ERROR_DETAIL,
            )
        finally:
            trace.chat_stream_semaphore_available = _stream_semaphore_available()
            trace.chat_stream_semaphore_limit = _stream_semaphore_configured_limit()
            emit_api_timing()
            trace.request_id = request_id
            emit_chat_trace(
                trace.build(),
                trainer_id=str(trainer_context.trainer_id or ""),
                client_id=str(trainer_context.client_id or ""),
                conversation_id=stream_conversation_id,
            )
            if stream_slot_acquired:
                _release_stream_slot()

    streaming_response_created_at = time.perf_counter()
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=STREAMING_RESPONSE_HEADERS,
    )
