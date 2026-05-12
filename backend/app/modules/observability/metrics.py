from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import datetime, timezone
from typing import Any


logger = logging.getLogger(__name__)

PHASE_D_METRIC_NAMES = {
    "chat.ttft_ms",
    "chat.total_ms",
    "router.latency_ms",
    "db.query_latency_ms",
    "worker.queue_lag_ms",
    "worker.job_success_rate",
    "worker.retry_rate",
    "worker.dead_letter_count",
    "llm.tokens_in",
    "llm.tokens_out",
    "llm.cost_usd",
    "llm.fallback_rate",
    "llm.error_rate",
    "db.error_rate",
    "cache.miss_rate",
    "safety.escalation_rate",
    "safety.injection_detected_rate",
    "safety.trainer_review_pending_count",
}

ALERT_THRESHOLDS = {
    "chat.ttft_ms": {"warning": 2000, "critical": 4000, "aggregation": "p95"},
    "api.standard_ms": {"warning": 400, "critical": 800, "aggregation": "p95"},
    "worker.queue_lag_ms": {"warning": 15000, "critical": 30000, "aggregation": "p95"},
    "worker.dead_letter_count": {"warning": 1, "critical": 5, "aggregation": "count"},
    "llm.fallback_rate": {"warning": 0.05, "critical": 0.15, "aggregation": "rate"},
    "security.cross_tenant_rls_violation": {"warning": 1, "critical": 1, "aggregation": "count"},
    "safety.injection_detected_rate": {"warning": 0.01, "critical": 0.03, "aggregation": "rate"},
}


@dataclass(frozen=True)
class MetricEvent:
    name: str
    value: float
    unit: str = "count"
    tags: dict[str, str] = field(default_factory=dict)
    observed_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def emit_metric(
    name: str,
    value: int | float | bool,
    *,
    unit: str = "count",
    tags: dict[str, Any] | None = None,
) -> MetricEvent:
    event = MetricEvent(
        name=name,
        value=float(value),
        unit=unit,
        tags=_safe_tags(tags or {}),
    )
    logger.info(json.dumps({"event": "observation_metric", **asdict(event)}, default=str))
    return event


def emit_chat_trace_metrics(trace: Any) -> list[MetricEvent]:
    payload = _object_payload(trace)
    trainer_id = str(payload.get("trainer_id") or "")
    model = str(payload.get("model_used") or "unknown")
    route = str(payload.get("route") or "unknown")
    tags = {"trainer_id": trainer_id, "model": model, "route": route}
    events: list[MetricEvent] = []

    ttft_ms = _int(payload.get("time_to_first_token_ms"), -1)
    if ttft_ms >= 0:
        events.append(emit_metric("chat.ttft_ms", ttft_ms, unit="ms", tags=tags))
    events.append(emit_metric("chat.total_ms", _int(payload.get("total_response_ms"), 0), unit="ms", tags=tags))
    events.append(emit_metric("llm.tokens_in", _int(payload.get("tokens_in"), 0), unit="tokens", tags=tags))
    events.append(emit_metric("llm.tokens_out", _int(payload.get("tokens_out"), 0), unit="tokens", tags=tags))
    cost = payload.get("tokens_cost_usd")
    if cost is not None:
        events.append(emit_metric("llm.cost_usd", _float(cost, 0.0), unit="usd", tags=tags))
    events.append(emit_metric("llm.fallback_rate", 1.0 if payload.get("fallback_used") else 0.0, unit="ratio", tags=tags))
    if payload.get("error_category"):
        events.append(emit_metric("llm.error_rate", 1.0, unit="ratio", tags={**tags, "error_category": payload["error_category"]}))
    events.append(emit_metric("cache.miss_rate", 0.0 if payload.get("cache_hit") else 1.0, unit="ratio", tags={"trainer_id": trainer_id, "route": route}))
    events.append(emit_metric("safety.escalation_rate", 1.0 if payload.get("escalation_triggered") else 0.0, unit="ratio", tags={"trainer_id": trainer_id, "route": route}))
    risk_flags = payload.get("risk_flags") if isinstance(payload.get("risk_flags"), list) else []
    injection_detected = route == "prompt_injection_blocked" or any("injection" in str(flag) or "prompt" in str(flag) for flag in risk_flags)
    events.append(emit_metric("safety.injection_detected_rate", 1.0 if injection_detected else 0.0, unit="ratio", tags={"trainer_id": trainer_id, "route": route}))
    return events


def emit_worker_job_metrics(trace_payload: Any, *, enqueued_at: str | None = None) -> list[MetricEvent]:
    payload = _object_payload(trace_payload)
    status = str(payload.get("status") or "unknown")
    job_type = str(payload.get("job_type") or "unknown")
    tags = {
        "job_type": job_type,
        "trainer_id": str(payload.get("trainer_id") or ""),
        "status": status,
    }
    events = [
        emit_metric("worker.job_success_rate", 1.0 if status == "success" else 0.0, unit="ratio", tags=tags),
        emit_metric("worker.retry_rate", 1.0 if status == "retry" else 0.0, unit="ratio", tags=tags),
        emit_metric("worker.dead_letter_count", 1.0 if status == "failed" else 0.0, unit="count", tags=tags),
    ]
    lag_ms = _queue_lag_ms(enqueued_at, _int(payload.get("duration_ms"), 0))
    if lag_ms is not None:
        events.append(emit_metric("worker.queue_lag_ms", lag_ms, unit="ms", tags=tags))
    if job_type in {"safety_flag_persistence", "trainer_escalation_notification"} and status == "success":
        events.append(emit_metric("safety.trainer_review_pending_count", 1.0, unit="count", tags=tags))
    return events


def emit_db_query_metric(query_type: str, latency_ms: int, *, ok: bool = True) -> None:
    tags = {"query_type": query_type}
    emit_metric("db.query_latency_ms", latency_ms, unit="ms", tags=tags)
    emit_metric("db.error_rate", 0.0 if ok else 1.0, unit="ratio", tags=tags)


def _queue_lag_ms(enqueued_at: str | None, duration_ms: int) -> int | None:
    if not enqueued_at:
        return None
    try:
        parsed = datetime.fromisoformat(str(enqueued_at).replace("Z", "+00:00"))
    except ValueError:
        return None
    now = datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(0, int((now - parsed).total_seconds() * 1000) - max(0, int(duration_ms or 0)))


def _object_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if is_dataclass(value):
        return asdict(value)
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return model_dump(mode="json")
    if hasattr(value, "__dict__"):
        return dict(vars(value))
    return {}


def _safe_tags(tags: dict[str, Any]) -> dict[str, str]:
    safe: dict[str, str] = {}
    for key, value in tags.items():
        key_text = str(key or "").strip()
        if not key_text:
            continue
        safe[key_text] = str(value or "")[:160]
    return safe


def _int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback
