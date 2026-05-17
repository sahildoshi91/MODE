from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from app.core.auth import AuthenticatedUser
from app.db.client import get_supabase_admin_client
from app.modules.account_deletion.repository import AccountDeletionRepository, AccountDeletionRequestRepository
from app.modules.account_deletion.service import AccountDeletionService
from app.modules.atlas.repository import AtlasRepository
from app.modules.atlas.service import AtlasTrainerDeletionObserver
from app.modules.conversation.cache import expire_chat_context_soon, invalidate_chat_context
from app.modules.conversation.memory import evaluate_memory_write
from app.modules.intelligence_jobs.repository import IntelligenceJobRepository
from app.modules.intelligence_jobs.schemas import (
    ConversationSummary,
    IntelligenceJob,
    JOB_CONFIGS,
    MemoryExtract,
    WorkerJobTrace,
)
from app.modules.observability.metrics import emit_chat_trace_metrics, emit_worker_job_metrics


logger = logging.getLogger(__name__)


def run_intelligence_job(raw_job: dict[str, Any]) -> None:
    job = IntelligenceJob.model_validate(raw_job)
    started_at = time.perf_counter()
    repo = IntelligenceJobRepository(get_supabase_admin_client())
    existing = _safe_get_job(repo, job.job_id)
    ensure_queued = getattr(repo, "ensure_queued", None)
    if not isinstance(existing, dict) and callable(ensure_queued):
        _safe_repo_call(
            ensure_queued,
            job,
            rq_job_id=None,
            queue_name=_queue_name_for_job(job),
        )
        existing = _safe_get_job(repo, job.job_id)
    attempt_number = _attempt_number_from_existing(existing)
    if isinstance(existing, dict) and existing.get("status") == "success":
        _emit_worker_trace(
            repo=repo,
            job=job,
            status="success",
            attempt_number=attempt_number,
            started_at=started_at,
            error_category=None,
        )
        return

    _safe_repo_call(repo.mark_running, job, attempt_number=attempt_number)
    try:
        _dispatch(job)
    except Exception as exc:
        error_category = exc.__class__.__name__
        config = JOB_CONFIGS[job.job_type]
        if attempt_number >= config.max_attempts:
            _safe_repo_call(repo.mark_failed, job, attempt_number=attempt_number, error_category=error_category)
            if job.job_type in {"safety_flag_persistence", "trainer_escalation_notification"}:
                logger.error(
                    "intelligence_job_final_failure_high_severity job_id=%s job_type=%s trace_id=%s error_category=%s",
                    job.job_id,
                    job.job_type,
                    job.trace_id,
                    error_category,
                )
            if job.job_type == "cache_invalidate":
                expire_chat_context_soon(job.trainer_id, job.client_id, reason="cache_invalidate_final_failure")
        else:
            _safe_repo_call(repo.mark_retry, job, attempt_number=attempt_number, error_category=error_category)
        _emit_worker_trace(
            repo=repo,
            job=job,
            status="failed" if attempt_number >= config.max_attempts else "retry",
            attempt_number=attempt_number,
            started_at=started_at,
            error_category=error_category,
        )
        raise

    _safe_repo_call(repo.mark_success, job, attempt_number=attempt_number)
    _emit_worker_trace(
        repo=repo,
        job=job,
        status="success",
        attempt_number=attempt_number,
        started_at=started_at,
        error_category=None,
    )


def _dispatch(job: IntelligenceJob) -> None:
    if job.job_type == "memory_write":
        _handle_memory_write(job)
        return
    if job.job_type == "cache_invalidate":
        _handle_cache_invalidate(job)
        return
    if job.job_type == "chat_trace_log_emit":
        _handle_chat_trace_log_emit(job)
        return
    if job.job_type == "trainer_escalation_notification":
        _handle_trainer_escalation_notification(job)
        return
    if job.job_type == "conversation_summarization":
        _handle_conversation_summarization(job)
        return
    if job.job_type == "safety_flag_persistence":
        _handle_safety_flag_persistence(job)
        return
    if job.job_type == "account_deletion":
        _handle_account_deletion(job)
        return
    raise RuntimeError(f"unsupported_intelligence_job_type:{job.job_type}")


def _queue_name_for_job(job: IntelligenceJob) -> str:
    priority = JOB_CONFIGS[job.job_type].priority
    return {
        "high": "mode:intelligence:high",
        "normal": "mode:intelligence:normal",
        "low": "mode:intelligence:low",
    }[priority]


def _handle_memory_write(job: IntelligenceJob) -> None:
    message_text = str(job.payload.get("message_text") or "")
    candidate = evaluate_memory_write(message_text)
    extract = _validated_memory_extract(job, candidate)
    if extract is None:
        return
    now = datetime.now(timezone.utc).isoformat()
    memory_key = f"chat_{extract.category}_{hashlib.sha256(extract.text.encode('utf-8')).hexdigest()[:16]}"
    payload = {
        "trainer_id": job.trainer_id,
        "client_id": job.client_id,
        "memory_type": extract.memory_type,
        "memory_key": memory_key,
        "value_json": {
            "source": "chat",
            "created_by": "ai_memory_policy",
            "client_visible": True,
            "ai_usable": True,
            "visibility": "ai_usable",
            "is_archived": False,
            "text": extract.text,
            "category": extract.category,
            "tags": [extract.category],
            "structured_data": {
                "conversation_id": job.conversation_id,
                "write_reason": extract.reason,
                "job_id": job.job_id,
            },
        },
        "updated_at": now,
    }
    supabase = get_supabase_admin_client()
    existing = (
        supabase
        .table("coach_memory")
        .select("id")
        .eq("trainer_id", job.trainer_id)
        .eq("client_id", job.client_id)
        .eq("memory_key", memory_key)
        .limit(1)
        .execute()
    )
    if existing.data:
        supabase.table("coach_memory").update(payload).eq("id", existing.data[0]["id"]).execute()
    else:
        supabase.table("coach_memory").insert(payload).execute()
    invalidate_chat_context(job.trainer_id, job.client_id, reason="memory_write")


def _validated_memory_extract(job: IntelligenceJob, candidate: Any) -> MemoryExtract | None:
    if not getattr(candidate, "should_write", False):
        return None
    try:
        return MemoryExtract.model_validate(
            {
                "memory_type": getattr(candidate, "memory_type", ""),
                "category": getattr(candidate, "category", ""),
                "text": getattr(candidate, "text", ""),
                "reason": getattr(candidate, "reason", ""),
            }
        )
    except ValidationError:
        logger.warning(
            "memory_extract_validation_failed job_id=%s trainer_id=%s client_id=%s conversation_id=%s",
            job.job_id,
            job.trainer_id,
            job.client_id,
            job.conversation_id,
        )
        return None


def _handle_cache_invalidate(job: IntelligenceJob) -> None:
    invalidate_chat_context(
        job.trainer_id,
        job.client_id,
        reason=str(job.payload.get("reason") or job.job_type),
        include_trainer_persona=bool(job.payload.get("include_trainer_persona")),
    )


def _handle_chat_trace_log_emit(job: IntelligenceJob) -> None:
    trace = job.payload.get("trace")
    if not isinstance(trace, dict):
        raise RuntimeError("missing_trace_payload")
    emit_chat_trace_metrics(trace)
    logger.info(json.dumps({"event": "chat_trace", **trace}, default=str))


def _handle_trainer_escalation_notification(job: IntelligenceJob) -> None:
    supabase = get_supabase_admin_client()
    user_question = str(job.payload.get("user_question") or "")
    assistant_message = str(job.payload.get("assistant_message") or "")
    message_id = _none_if_empty(job.payload.get("user_message_id"))
    queue_payload = {
        "trainer_id": job.trainer_id,
        "client_id": job.client_id,
        "conversation_id": job.conversation_id,
        "message_id": message_id,
        "user_question": user_question,
        "model_draft_answer": assistant_message,
        "confidence_score": job.payload.get("confidence_score"),
    }
    existing_queue = None
    if message_id:
        existing_response = (
            supabase
            .table("unanswered_question_queue")
            .select("id")
            .eq("trainer_id", job.trainer_id)
            .eq("client_id", job.client_id)
            .eq("conversation_id", job.conversation_id)
            .eq("message_id", message_id)
            .limit(1)
            .execute()
        )
        existing_queue = existing_response.data[0] if existing_response.data else None
    if existing_queue:
        queue_row = existing_queue
    else:
        queue_response = supabase.table("unanswered_question_queue").insert(queue_payload).execute()
        queue_row = (queue_response.data or [{}])[0]
    is_safety_escalation = _is_safety_job(job)
    if not is_safety_escalation:
        _tag_trainer_review_pending(
            job,
            reason=str(job.payload.get("route_reason") or "trainer_review_pending"),
            risk_flags=_string_list(job.payload.get("risk_flags")),
            active_safety_flags=[],
        )
        return

    tenant_id = str(job.payload.get("tenant_id") or "").strip() or _lookup_client_tenant_id(
        supabase,
        trainer_id=job.trainer_id,
        client_id=job.client_id,
    )
    if tenant_id:
        source_id = str(job.payload.get("user_message_id") or job.job_id)
        event_key = f"safety_escalation:{job.conversation_id}:{source_id}"
        if len(event_key) > 220:
            event_key = f"safety_escalation:{hashlib.sha256(event_key.encode('utf-8')).hexdigest()}"
        existing = (
            supabase
            .table("trainer_system_events")
            .select("id")
            .eq("trainer_id", job.trainer_id)
            .eq("event_key", event_key)
            .limit(1)
            .execute()
        )
        if not existing.data:
            now = datetime.now(timezone.utc).isoformat()
            supabase.table("trainer_system_events").insert(
                {
                    "tenant_id": tenant_id,
                    "trainer_id": job.trainer_id,
                    "client_id": job.client_id,
                    "output_id": None,
                    "event_key": event_key,
                    "event_type": "safety_escalation",
                    "message": "Safety review requested from chat",
                    "severity": "warning",
                    "visibility": "trainer_private",
                    "status": "confirmed",
                    "payload": {
                        "conversation_id": job.conversation_id,
                        "message_id": _none_if_empty(job.payload.get("user_message_id")),
                        "queue_id": queue_row.get("id"),
                        "risk_flags": _string_list(job.payload.get("risk_flags")),
                        "request_message_sha256": hashlib.sha256(user_question.encode("utf-8")).hexdigest(),
                        "request_message_length": len(user_question),
                        "source": "worker_safety_escalation",
                        "job_id": job.job_id,
                    },
                    "created_at": now,
                    "updated_at": now,
                }
            ).execute()


def _handle_safety_flag_persistence(job: IntelligenceJob) -> None:
    flags = _safety_flags(job)
    _tag_trainer_review_pending(
        job,
        reason=str(job.payload.get("route_reason") or "safety_escalation"),
        risk_flags=_string_list(job.payload.get("risk_flags")),
        active_safety_flags=flags,
    )
    invalidate_chat_context(job.trainer_id, job.client_id, reason="safety_flag_added")


def _handle_conversation_summarization(job: IntelligenceJob) -> None:
    supabase = get_supabase_admin_client()
    summary = _validated_conversation_summary(job)
    if summary is None and isinstance(job.payload.get("summary"), dict):
        logger.warning(
            "conversation_summary_validation_failed job_id=%s trainer_id=%s client_id=%s conversation_id=%s",
            job.job_id,
            job.trainer_id,
            job.client_id,
            job.conversation_id,
        )
        return
    response = (
        supabase
        .table("conversations")
        .select("metadata")
        .eq("id", job.conversation_id)
        .eq("trainer_id", job.trainer_id)
        .limit(1)
        .execute()
    )
    row = response.data[0] if response.data else {}
    metadata = row.get("metadata") if isinstance(row, dict) else {}
    if not isinstance(metadata, dict):
        metadata = {}
    if summary is not None:
        supabase.table("conversations").update(
            {
                "metadata": {
                    **metadata,
                    "conversation_summary": summary.model_dump(mode="json"),
                    "summary_job_status": "success",
                    "summary_job_id": job.job_id,
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", job.conversation_id).execute()
        return
    supabase.table("conversations").update(
        {
            "metadata": {
                **metadata,
                "summary_job_last_checked_at": datetime.now(timezone.utc).isoformat(),
                "summary_job_status": "deferred_no_summarizer_configured",
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", job.conversation_id).execute()


def _validated_conversation_summary(job: IntelligenceJob) -> ConversationSummary | None:
    raw_summary = job.payload.get("summary")
    if not isinstance(raw_summary, dict):
        return None
    try:
        return ConversationSummary.model_validate(
            {
                **raw_summary,
                "conversation_id": raw_summary.get("conversation_id") or job.conversation_id,
                "trainer_id": raw_summary.get("trainer_id") or job.trainer_id,
                "client_id": raw_summary.get("client_id") or job.client_id,
            }
        )
    except ValidationError:
        return None


def _handle_account_deletion(job: IntelligenceJob) -> None:
    request_id = str(job.payload.get("request_id") or job.conversation_id or job.job_id)
    user_id = str(job.payload.get("user_id") or "").strip()
    if not user_id:
        raise RuntimeError("account_deletion_user_id_missing")

    supabase = get_supabase_admin_client()
    request_repo = AccountDeletionRequestRepository(supabase)
    request_repo.mark_running(request_id=request_id)
    try:
        atlas_repository = AtlasRepository(supabase)
        result = AccountDeletionService(
            AccountDeletionRepository(supabase),
            atlas_trainer_deletion_observer=AtlasTrainerDeletionObserver(atlas_repository),
        ).delete_account(
            user=AuthenticatedUser(
                id=user_id,
                email=None,
                access_token=None,
            ),
            confirmation=AccountDeletionService.CONFIRMATION_TOKEN,
        )
    except Exception as exc:
        request_repo.mark_failed(request_id=request_id, error_category=exc.__class__.__name__)
        raise

    request_repo.mark_succeeded(
        request_id=request_id,
        deletion_request_id=result.deletion_request_id,
        actor_role=result.actor_role,
        deleted_record_counts=result.deleted_record_counts,
    )


def _next_attempt_number(repo: IntelligenceJobRepository, job: IntelligenceJob) -> int:
    existing = _safe_get_job(repo, job.job_id)
    return _attempt_number_from_existing(existing)


def _attempt_number_from_existing(existing: Any) -> int:
    if not isinstance(existing, dict):
        return 1
    try:
        return int(existing.get("attempt_count") or 0) + 1
    except (TypeError, ValueError):
        return 1


def _safe_get_job(repo: IntelligenceJobRepository, job_id: str) -> dict[str, Any] | None:
    try:
        return repo.get_job(job_id)
    except Exception:
        return None


def _safe_repo_call(fn: Any, *args: Any, **kwargs: Any) -> None:
    try:
        fn(*args, **kwargs)
    except Exception:
        logger.exception("intelligence_job_repository_update_failed")


def _emit_worker_trace(
    *,
    repo: IntelligenceJobRepository,
    job: IntelligenceJob,
    status: str,
    attempt_number: int,
    started_at: float,
    error_category: str | None,
) -> None:
    trace = WorkerJobTrace(
        job_id=job.job_id,
        job_type=job.job_type,
        trainer_id=job.trainer_id,
        client_id=job.client_id,
        trace_id=job.trace_id,
        status=status,
        attempt_number=attempt_number,
        duration_ms=int((time.perf_counter() - started_at) * 1000),
        error_category=error_category,
        completed_at=datetime.now(timezone.utc).isoformat(),
    )
    payload = asdict(trace)
    emit_worker_job_metrics(payload, enqueued_at=job.enqueued_at)
    logger.info(json.dumps({"event": "worker_job_trace", **payload}, default=str))
    try:
        repo.record_worker_trace(payload)
    except Exception:
        logger.exception("worker_job_trace_persist_failed job_id=%s", job.job_id)


def _tag_trainer_review_pending(
    job: IntelligenceJob,
    *,
    reason: str,
    risk_flags: list[str],
    active_safety_flags: list[dict[str, Any]],
) -> None:
    supabase = get_supabase_admin_client()
    response = (
        supabase
        .table("conversations")
        .select("metadata")
        .eq("id", job.conversation_id)
        .eq("trainer_id", job.trainer_id)
        .limit(1)
        .execute()
    )
    row = response.data[0] if response.data else {}
    metadata = row.get("metadata") if isinstance(row, dict) else {}
    if not isinstance(metadata, dict):
        metadata = {}
    existing_flags = metadata.get("active_safety_flags") if isinstance(metadata.get("active_safety_flags"), list) else []
    supabase.table("conversations").update(
        {
            "metadata": {
                **metadata,
                "trainer_review_pending": True,
                "trainer_review_pending_reason": reason,
                "trainer_review_risk_flags": risk_flags,
                "active_safety_flags": _merge_flags(existing_flags, active_safety_flags),
                "trainer_review_pending_at": datetime.now(timezone.utc).isoformat(),
                "trainer_review_job_id": job.job_id,
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", job.conversation_id).execute()


def _is_safety_job(job: IntelligenceJob) -> bool:
    route_flow = str(job.payload.get("route_flow") or "")
    flags = _string_list(job.payload.get("risk_flags"))
    return route_flow == "safety_escalation" or bool(flags)


def _safety_flags(job: IntelligenceJob) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat()
    flags: list[dict[str, Any]] = []
    for raw_flag in _string_list(job.payload.get("risk_flags")):
        flags.append(
            {
                "type": _safety_flag_type(raw_flag),
                "description": raw_flag,
                "severity": "high" if raw_flag in {"self_harm", "eating_disorder", "medical_request"} else "medium",
                "trainer_review_required": True,
                "flagged_at": now,
            }
        )
    if not flags:
        flags.append(
            {
                "type": "other",
                "description": "safety_escalation",
                "severity": "medium",
                "trainer_review_required": True,
                "flagged_at": now,
            }
        )
    return flags[:5]


def _safety_flag_type(flag: str) -> str:
    normalized = flag.lower()
    if any(token in normalized for token in ("injury", "pain", "tendon", "ligament")):
        return "injury"
    if any(token in normalized for token in ("medical", "med", "dosage", "dose", "supplement")):
        return "medical"
    if "eating" in normalized or "nutrition" in normalized:
        return "nutrition"
    if "self_harm" in normalized or "mental" in normalized:
        return "mental_health"
    return "other"


def _merge_flags(*flag_groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for group in flag_groups:
        for flag in group:
            if not isinstance(flag, dict):
                continue
            key = (str(flag.get("type") or "other"), str(flag.get("description") or ""))
            if key in seen:
                continue
            seen.add(key)
            merged.append(flag)
    return merged[:5]


def _lookup_client_tenant_id(supabase: Any, *, trainer_id: str, client_id: str) -> str | None:
    response = (
        supabase
        .table("clients")
        .select("tenant_id")
        .eq("id", client_id)
        .eq("assigned_trainer_id", trainer_id)
        .limit(1)
        .execute()
    )
    row = response.data[0] if response.data else None
    return str(row.get("tenant_id")) if isinstance(row, dict) and row.get("tenant_id") else None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item or "").strip()]


def _none_if_empty(value: Any) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None
