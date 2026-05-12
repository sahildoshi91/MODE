from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.modules.intelligence_jobs.schemas import EnqueueResult, IntelligenceJob, JOB_CONFIGS, JobType


logger = logging.getLogger(__name__)

QUEUE_NAMES = {
    "high": "mode:intelligence:high",
    "normal": "mode:intelligence:normal",
    "low": "mode:intelligence:low",
}


def enqueue_intelligence_job(job: IntelligenceJob) -> EnqueueResult:
    started_at = time.perf_counter()
    config = JOB_CONFIGS[job.job_type]
    queue_name = QUEUE_NAMES[config.priority]
    if not settings.redis_url:
        return EnqueueResult(ok=False, job_id=job.job_id, queue_name=queue_name, error_category="redis_url_missing")

    try:
        import redis  # type: ignore[import-not-found]
        from rq import Queue, Retry  # type: ignore[import-not-found]

        timeout_seconds = max(0.001, settings.chat_cache_timeout_ms / 1000)
        connection = redis.Redis.from_url(
            str(settings.redis_url),
            socket_timeout=timeout_seconds,
            socket_connect_timeout=timeout_seconds,
        )
        queue = Queue(queue_name, connection=connection)
        rq_job = queue.enqueue(
            "app.modules.intelligence_jobs.handlers.run_intelligence_job",
            job.model_dump(mode="json"),
            job_id=job.job_id,
            retry=Retry(max=max(0, config.max_attempts - 1), interval=list(config.retry_intervals_seconds)),
            job_timeout=300,
            meta={
                "job_type": job.job_type,
                "trainer_id": job.trainer_id,
                "client_id": job.client_id,
                "trace_id": job.trace_id,
                "enqueued_at": job.enqueued_at,
            },
        )
        del rq_job
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            "intelligence_job_enqueued job_id=%s job_type=%s queue=%s latency_ms=%s",
            job.job_id,
            job.job_type,
            queue_name,
            latency_ms,
        )
        return EnqueueResult(ok=True, job_id=job.job_id, queue_name=queue_name, latency_ms=latency_ms)
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        logger.exception(
            "intelligence_job_enqueue_failed job_id=%s job_type=%s queue=%s latency_ms=%s",
            job.job_id,
            job.job_type,
            queue_name,
            latency_ms,
            exc_info=exc,
        )
        return EnqueueResult(
            ok=False,
            job_id=job.job_id,
            queue_name=queue_name,
            latency_ms=latency_ms,
            error_category=exc.__class__.__name__,
        )


def build_job(
    *,
    job_type: JobType,
    trainer_id: str | None,
    client_id: str | None,
    conversation_id: str | None,
    payload: dict[str, Any],
    trace_id: str | None,
) -> IntelligenceJob:
    return IntelligenceJob(
        job_type=job_type,
        trainer_id=str(trainer_id or ""),
        client_id=str(client_id or ""),
        conversation_id=str(conversation_id or ""),
        payload=payload,
        enqueued_at=datetime.now(timezone.utc).isoformat(),
        trace_id=str(trace_id or ""),
    )


def enqueue_post_chat_jobs(
    *,
    trainer_id: str | None,
    client_id: str | None,
    conversation_id: str | None,
    trace_id: str | None,
    message_text: str,
    route_payload: dict[str, Any] | None = None,
    assistant_message: str | None = None,
    user_message_id: str | None = None,
    tenant_id: str | None = None,
    include_memory: bool = True,
) -> list[EnqueueResult]:
    if not trainer_id or not client_id or not conversation_id:
        return []

    route_payload = route_payload if isinstance(route_payload, dict) else {}
    results: list[EnqueueResult] = []
    if include_memory:
        memory_job = build_job(
            job_type="memory_write",
            trainer_id=trainer_id,
            client_id=client_id,
            conversation_id=conversation_id,
            trace_id=trace_id,
            payload={
                "message_text": message_text,
                "message_length": len(str(message_text or "")),
            },
        )
        results.append(enqueue_intelligence_job(memory_job))
        results.append(
            enqueue_intelligence_job(
                build_job(
                    job_type="cache_invalidate",
                    trainer_id=trainer_id,
                    client_id=client_id,
                    conversation_id=conversation_id,
                    trace_id=trace_id,
                    payload={"reason": "memory_write_queued"},
                )
            )
        )

    if bool(route_payload.get("needs_trainer_review")):
        escalation_payload = {
            "tenant_id": tenant_id,
            "user_message_id": str(user_message_id or "") or None,
            "user_question": message_text,
            "assistant_message": assistant_message,
            "assistant_message_length": len(str(assistant_message or "")),
            "confidence_score": route_payload.get("retrieval_confidence"),
            "route_flow": route_payload.get("flow"),
            "route_reason": route_payload.get("reason"),
            "risk_flags": _risk_flags_from_route(route_payload),
        }
        results.append(
            enqueue_intelligence_job(
                build_job(
                    job_type="trainer_escalation_notification",
                    trainer_id=trainer_id,
                    client_id=client_id,
                    conversation_id=conversation_id,
                    trace_id=trace_id,
                    payload=escalation_payload,
                )
            )
        )
        results.append(
            enqueue_intelligence_job(
                build_job(
                    job_type="cache_invalidate",
                    trainer_id=trainer_id,
                    client_id=client_id,
                    conversation_id=conversation_id,
                    trace_id=trace_id,
                    payload={
                        "reason": "trainer_review_pending",
                        "include_trainer_persona": False,
                    },
                )
            )
        )
        if _is_safety_route(route_payload):
            results.append(
                enqueue_intelligence_job(
                    build_job(
                        job_type="safety_flag_persistence",
                        trainer_id=trainer_id,
                        client_id=client_id,
                        conversation_id=conversation_id,
                        trace_id=trace_id,
                        payload={
                            "route_flow": route_payload.get("flow"),
                            "route_reason": route_payload.get("reason"),
                            "risk_flags": _risk_flags_from_route(route_payload),
                        },
                    )
                )
            )

    return results


def enqueue_chat_trace_log(
    *,
    trace_payload: dict[str, Any],
    trainer_id: str | None,
    client_id: str | None,
    conversation_id: str | None,
) -> EnqueueResult:
    if not trainer_id or not client_id or not conversation_id:
        return EnqueueResult(ok=False, error_category="tenant_scope_missing")
    job = build_job(
        job_type="chat_trace_log_emit",
        trainer_id=trainer_id,
        client_id=client_id,
        conversation_id=conversation_id,
        trace_id=str(trace_payload.get("request_id") or ""),
        payload={"trace": trace_payload},
    )
    return enqueue_intelligence_job(job)


def _risk_flags_from_route(route_payload: dict[str, Any]) -> list[str]:
    intent = route_payload.get("intent_route") if isinstance(route_payload.get("intent_route"), dict) else {}
    raw_flags = intent.get("risk_flags") if isinstance(intent.get("risk_flags"), list) else []
    return [str(flag) for flag in raw_flags]


def _is_safety_route(route_payload: dict[str, Any]) -> bool:
    intent = route_payload.get("intent_route") if isinstance(route_payload.get("intent_route"), dict) else {}
    return str(route_payload.get("flow") or "") == "safety_escalation" or bool(intent.get("notify_trainer"))
