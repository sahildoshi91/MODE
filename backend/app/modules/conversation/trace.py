from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Any

from app.modules.observability.metrics import emit_chat_trace_metrics


logger = logging.getLogger(__name__)


@dataclass
class ChatTrace:
    request_id: str
    user_id: str
    trainer_id: str
    route: str = "unknown"
    router_confidence: float = 0.0
    risk_flags: list[str] = field(default_factory=list)
    cache_hit: bool = False
    retrieval_latency_ms: int | None = None
    llm_latency_ms: int = 0
    time_to_first_token_ms: int = -1
    total_response_ms: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    model_used: str = "unknown"
    fallback_used: bool = False
    stream_fallback_attempted: bool = False
    mid_stream_failure: bool = False
    providers_attempted: list[str] = field(default_factory=list)
    escalation_triggered: bool = False
    error_category: str | None = None
    worker_job_id: str | None = None
    prompt_version: str = "inline_legacy"
    model_fallback_chain: list[str] = field(default_factory=list)
    tokens_cost_usd: float | None = None
    queue_enqueue_latency_ms: int | None = None
    chat_stream_semaphore_available: int | None = None
    chat_stream_semaphore_limit: int | None = None

    def log(self) -> None:
        emit_chat_trace_metrics(self)
        logger.info(json.dumps({"event": "chat_trace", **asdict(self)}, default=str))


class ChatTraceAccumulator:
    def __init__(self, *, request_id: str, user_id: str, trainer_id: str):
        self.request_id = request_id
        self.user_id = user_id
        self.trainer_id = trainer_id
        self.started_at = time.perf_counter()
        self.first_token_at: float | None = None
        self.route = "unknown"
        self.router_confidence = 0.0
        self.risk_flags: list[str] = []
        self.cache_hit = False
        self.retrieval_latency_ms: int | None = None
        self.tokens_in = 0
        self.tokens_out = 0
        self.model_used = "unknown"
        self.fallback_used = False
        self.stream_fallback_attempted = False
        self.mid_stream_failure = False
        self.providers_attempted: list[str] = []
        self.escalation_triggered = False
        self.error_category: str | None = None
        self.worker_job_id: str | None = None
        self.prompt_version = "inline_legacy"
        self.model_fallback_chain: list[str] = []
        self.tokens_cost_usd: float | None = None
        self.queue_enqueue_latency_ms: int | None = None
        self.chat_stream_semaphore_available: int | None = None
        self.chat_stream_semaphore_limit: int | None = None

    def observe_payload(self, payload: dict[str, Any]) -> None:
        payload_type = str(payload.get("type") or "").strip().lower()
        if payload_type == "token":
            content = payload.get("content")
            if self.first_token_at is None and isinstance(content, str) and content:
                self.first_token_at = time.perf_counter()
        if payload_type == "error":
            self.error_category = self.error_category or "stream_error"
        trace = payload.get("_trace")
        if isinstance(trace, dict):
            self.route = str(trace.get("route") or self.route)
            self.router_confidence = _float(trace.get("router_confidence"), self.router_confidence)
            risk_flags = trace.get("risk_flags")
            if isinstance(risk_flags, list):
                self.risk_flags = [str(flag) for flag in risk_flags]
            self.cache_hit = bool(trace.get("cache_hit", self.cache_hit))
            self.retrieval_latency_ms = _int_or_none(trace.get("retrieval_latency_ms"), self.retrieval_latency_ms)
            self.model_used = str(trace.get("model_used") or self.model_used)
            self.fallback_used = bool(trace.get("fallback_used", self.fallback_used))
            self.stream_fallback_attempted = bool(
                trace.get("stream_fallback_attempted", self.stream_fallback_attempted)
            )
            self.mid_stream_failure = bool(trace.get("mid_stream_failure", self.mid_stream_failure))
            providers_attempted = trace.get("providers_attempted")
            if isinstance(providers_attempted, list):
                self.providers_attempted = [str(item) for item in providers_attempted]
            self.escalation_triggered = bool(trace.get("escalation_triggered", self.escalation_triggered))
            self.worker_job_id = str(trace.get("worker_job_id") or self.worker_job_id or "") or None
            self.prompt_version = str(trace.get("prompt_version") or self.prompt_version)
            fallback_chain = trace.get("model_fallback_chain")
            if isinstance(fallback_chain, list):
                self.model_fallback_chain = [str(item) for item in fallback_chain]
            self.tokens_cost_usd = _float_or_none(trace.get("tokens_cost_usd"), self.tokens_cost_usd)
            self.queue_enqueue_latency_ms = _int_or_none(
                trace.get("queue_enqueue_latency_ms"),
                self.queue_enqueue_latency_ms,
            )
            self.chat_stream_semaphore_available = _int_or_none(
                trace.get("chat_stream_semaphore_available"),
                self.chat_stream_semaphore_available,
            )
            self.chat_stream_semaphore_limit = _int_or_none(
                trace.get("chat_stream_semaphore_limit"),
                self.chat_stream_semaphore_limit,
            )
        token_usage = payload.get("token_usage")
        if isinstance(token_usage, dict):
            self.tokens_in = _int(token_usage.get("prompt_tokens"), self.tokens_in)
            self.tokens_out = _int(token_usage.get("completion_tokens"), self.tokens_out)

    def build(self) -> ChatTrace:
        now = time.perf_counter()
        first_token_ms = -1 if self.first_token_at is None else int((self.first_token_at - self.started_at) * 1000)
        total_ms = int((now - self.started_at) * 1000)
        return ChatTrace(
            request_id=self.request_id,
            user_id=self.user_id,
            trainer_id=self.trainer_id,
            route=self.route,
            router_confidence=self.router_confidence,
            risk_flags=self.risk_flags,
            cache_hit=self.cache_hit,
            retrieval_latency_ms=self.retrieval_latency_ms,
            llm_latency_ms=max(0, total_ms - (self.retrieval_latency_ms or 0)),
            time_to_first_token_ms=first_token_ms,
            total_response_ms=total_ms,
            tokens_in=self.tokens_in,
            tokens_out=self.tokens_out,
            model_used=self.model_used,
            fallback_used=self.fallback_used,
            stream_fallback_attempted=self.stream_fallback_attempted,
            mid_stream_failure=self.mid_stream_failure,
            providers_attempted=self.providers_attempted,
            escalation_triggered=self.escalation_triggered,
            error_category=self.error_category,
            worker_job_id=self.worker_job_id,
            prompt_version=self.prompt_version,
            model_fallback_chain=self.model_fallback_chain,
            tokens_cost_usd=self.tokens_cost_usd,
            queue_enqueue_latency_ms=self.queue_enqueue_latency_ms,
            chat_stream_semaphore_available=self.chat_stream_semaphore_available,
            chat_stream_semaphore_limit=self.chat_stream_semaphore_limit,
        )


def strip_private_trace(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if not key.startswith("_")}


def emit_chat_trace(
    trace: ChatTrace,
    *,
    trainer_id: str | None,
    client_id: str | None,
    conversation_id: str | None,
) -> None:
    payload = asdict(trace)
    try:
        from app.modules.intelligence_jobs.queue import enqueue_chat_trace_log

        result = enqueue_chat_trace_log(
            trace_payload=payload,
            trainer_id=trainer_id,
            client_id=client_id,
            conversation_id=conversation_id,
        )
        if result.ok:
            return
        log_trace_enqueue_failure = (
            logger.debug if result.error_category in {"redis_url_missing", "tenant_scope_missing"} else logger.warning
        )
        log_trace_enqueue_failure(
            "chat_trace_enqueue_failed request_id=%s job_id=%s error_category=%s",
            trace.request_id,
            result.job_id,
            result.error_category,
        )
    except Exception:
        logger.exception("chat_trace_enqueue_failed request_id=%s", trace.request_id)
    trace.log()


def _float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _int_or_none(value: Any, fallback: int | None) -> int | None:
    if value is None:
        return fallback
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _float_or_none(value: Any, fallback: float | None) -> float | None:
    if value is None:
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback
