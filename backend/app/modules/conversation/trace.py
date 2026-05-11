from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Any


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
    escalation_triggered: bool = False
    error_category: str | None = None

    def log(self) -> None:
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
        self.escalation_triggered = False
        self.error_category: str | None = None

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
            self.escalation_triggered = bool(trace.get("escalation_triggered", self.escalation_triggered))
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
            escalation_triggered=self.escalation_triggered,
            error_category=self.error_category,
        )


def strip_private_trace(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if not key.startswith("_")}


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

