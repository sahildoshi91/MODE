from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client

from app.modules.intelligence_jobs.schemas import IntelligenceJob, JOB_CONFIGS


class IntelligenceJobRepository:
    TABLE = "intelligence_jobs"
    TRACE_TABLE = "worker_job_traces"

    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table(self.TABLE)
            .select("*")
            .eq("job_id", job_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def ensure_queued(self, job: IntelligenceJob, *, rq_job_id: str | None = None, queue_name: str | None = None) -> None:
        payload = {
            "job_id": job.job_id,
            "job_type": job.job_type,
            "trainer_id": job.trainer_id,
            "client_id": job.client_id,
            "conversation_id": job.conversation_id,
            "trace_id": job.trace_id,
            "status": "queued",
            "priority": None,
            "payload": self._redacted_payload(job),
            "enqueued_at": job.enqueued_at,
            "rq_job_id": rq_job_id,
            "queue_name": queue_name,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        (
            self.supabase
            .table(self.TABLE)
            .upsert(payload, on_conflict="job_id")
            .execute()
        )

    def mark_enqueue_failed(self, job: IntelligenceJob, *, error_category: str) -> None:
        self._update(
            job.job_id,
            {
                "status": "enqueue_failed",
                "last_error_category": error_category,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    def update_rq_metadata(self, job_id: str, *, rq_job_id: str | None, queue_name: str | None) -> None:
        self._update(
            job_id,
            {
                "rq_job_id": rq_job_id,
                "queue_name": queue_name,
            },
        )

    def has_active_job(self, *, job_type: str, conversation_id: str) -> bool:
        response = (
            self.supabase
            .table(self.TABLE)
            .select("job_id")
            .eq("job_type", job_type)
            .eq("conversation_id", conversation_id)
            .in_("status", ["queued", "processing"])
            .limit(1)
            .execute()
        )
        return bool(response.data)

    def mark_running(self, job: IntelligenceJob, *, attempt_number: int) -> None:
        self._update(
            job.job_id,
            {
                "status": "processing",
                "attempt_count": attempt_number,
                "started_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    def mark_retry(self, job: IntelligenceJob, *, attempt_number: int, error_category: str) -> None:
        retry_intervals = JOB_CONFIGS[job.job_type].retry_intervals_seconds
        interval_index = max(0, min(attempt_number - 1, len(retry_intervals) - 1))
        retry_delay_seconds = retry_intervals[interval_index] if retry_intervals else 0
        self._update(
            job.job_id,
            {
                "status": "failed",
                "attempt_count": attempt_number,
                "last_error_category": error_category,
                "next_retry_at": (
                    datetime.now(timezone.utc) + timedelta(seconds=retry_delay_seconds)
                ).isoformat() if retry_delay_seconds else None,
            },
        )

    def mark_success(self, job: IntelligenceJob, *, attempt_number: int) -> None:
        self._update(
            job.job_id,
            {
                "status": "success",
                "attempt_count": attempt_number,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "last_error_category": None,
            },
        )

    def mark_failed(self, job: IntelligenceJob, *, attempt_number: int, error_category: str) -> None:
        self._update(
            job.job_id,
            {
                "status": "dead",
                "attempt_count": attempt_number,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "last_error_category": error_category,
            },
        )

    def record_worker_trace(self, trace_payload: dict[str, Any]) -> None:
        self.supabase.table(self.TRACE_TABLE).insert(trace_payload).execute()

    def _update(self, job_id: str, payload: dict[str, Any]) -> None:
        (
            self.supabase
            .table(self.TABLE)
            .update({**payload, "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("job_id", job_id)
            .execute()
        )

    @staticmethod
    def _redacted_payload(job: IntelligenceJob) -> dict[str, Any]:
        payload = job.payload if isinstance(job.payload, dict) else {}
        safe: dict[str, Any] = {
            "payload_keys": sorted(str(key) for key in payload.keys()),
        }
        for key in (
            "reason",
            "include_trainer_persona",
            "route_flow",
            "route_reason",
            "risk_flags",
            "message_length",
            "assistant_message_length",
        ):
            if key in payload:
                safe[key] = payload[key]
        return safe
