from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


JobType = Literal[
    "memory_write",
    "cache_invalidate",
    "chat_trace_log_emit",
    "trainer_escalation_notification",
    "conversation_summarization",
    "safety_flag_persistence",
    "account_deletion",
]

JobPriority = Literal["high", "normal", "low"]


class IntelligenceJob(BaseModel):
    job_id: str = Field(default_factory=lambda: str(uuid4()))
    job_type: JobType
    trainer_id: str
    client_id: str
    conversation_id: str
    payload: dict[str, Any] = Field(default_factory=dict)
    enqueued_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    trace_id: str


class MemoryExtract(BaseModel):
    memory_type: Literal["behavioral_note", "safety", "injury", "goal", "constraint", "preference", "note"]
    category: Literal["injury", "goal", "constraint", "preference"]
    text: str = Field(min_length=12, max_length=1000)
    reason: str = Field(min_length=1, max_length=500)


class ConversationSummary(BaseModel):
    conversation_id: str
    trainer_id: str
    client_id: str
    summary_text: str = Field(min_length=20, max_length=2000)
    key_insights: list[str] = Field(default_factory=list, max_length=12)
    message_range: tuple[int, int]
    generated_at: str


@dataclass(frozen=True)
class JobConfig:
    priority: JobPriority
    max_attempts: int
    retry_intervals_seconds: tuple[int, ...]


JOB_CONFIGS: dict[JobType, JobConfig] = {
    "memory_write": JobConfig(priority="normal", max_attempts=3, retry_intervals_seconds=(2, 10)),
    "cache_invalidate": JobConfig(priority="high", max_attempts=5, retry_intervals_seconds=(1, 3, 10, 30)),
    "chat_trace_log_emit": JobConfig(priority="low", max_attempts=3, retry_intervals_seconds=(2, 10)),
    "trainer_escalation_notification": JobConfig(priority="high", max_attempts=5, retry_intervals_seconds=(1, 3, 10, 30)),
    "conversation_summarization": JobConfig(priority="low", max_attempts=2, retry_intervals_seconds=(10,)),
    "safety_flag_persistence": JobConfig(priority="high", max_attempts=5, retry_intervals_seconds=(1, 3, 10, 30)),
    "account_deletion": JobConfig(priority="high", max_attempts=3, retry_intervals_seconds=(5, 30)),
}


class EnqueueResult(BaseModel):
    ok: bool
    job_id: str | None = None
    queue_name: str | None = None
    latency_ms: int | None = None
    error_category: str | None = None


@dataclass(frozen=True)
class WorkerJobTrace:
    job_id: str
    job_type: str
    trainer_id: str
    client_id: str
    trace_id: str
    status: str
    attempt_number: int
    duration_ms: int
    error_category: str | None
    completed_at: str
