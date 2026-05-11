from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.modules.ai_feedback.schemas import AIFeedbackEvent, AIGeneratedOutput


CoachSummaryStateType = Literal[
    "calibration_incomplete",
    "drafts_pending",
    "clients_need_attention",
    "all_on_track",
    "sync_pending",
]
CoachEventVisibility = Literal["trainer_private", "system", "client_public"]
CoachEventSeverity = Literal["info", "success", "warning", "error"]
CoachEventStatus = Literal["pending", "confirmed", "failed"]


class CoachSummaryAction(BaseModel):
    id: str
    label: str
    target: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class CoachSummaryState(BaseModel):
    state: CoachSummaryStateType
    title: str
    subtitle: str | None = None
    actions: list[CoachSummaryAction] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)


class CoachQueueItem(BaseModel):
    output_id: str
    trainer_id: str
    client_id: str | None = None
    client_name: str | None = None
    source_type: str
    review_status: str
    queue_state: str
    priority_tier: str = "normal"
    queue_priority: int = 0
    delivery_state: str = "draft"
    action_type: str | None = None
    headline: str | None = None
    summary: str | None = None
    output_text: str | None = None
    output_json: dict[str, Any] = Field(default_factory=dict)
    reviewed_output_text: str | None = None
    reviewed_output_json: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CoachSystemEventRecord(BaseModel):
    id: str
    event_type: str
    message: str
    severity: CoachEventSeverity = "info"
    visibility: CoachEventVisibility = "system"
    status: CoachEventStatus = "confirmed"
    output_id: str | None = None
    client_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CoachSyncState(BaseModel):
    pending_operation_count: int = 0
    failed_operation_count: int = 0


class CoachWorkspaceResponse(BaseModel):
    generated_at: datetime
    summary: CoachSummaryState
    queue: list[CoachQueueItem] = Field(default_factory=list)
    events: list[CoachSystemEventRecord] = Field(default_factory=list)
    sync: CoachSyncState = Field(default_factory=CoachSyncState)


class CoachQueueResponse(BaseModel):
    generated_at: datetime
    count: int
    items: list[CoachQueueItem] = Field(default_factory=list)


class CoachEventsResponse(BaseModel):
    generated_at: datetime
    count: int
    items: list[CoachSystemEventRecord] = Field(default_factory=list)


class CoachCreateEventRequest(BaseModel):
    event_key: str = Field(min_length=4, max_length=220)
    event_type: str = Field(min_length=2, max_length=80)
    message: str = Field(min_length=1, max_length=500)
    severity: CoachEventSeverity = "info"
    visibility: CoachEventVisibility = "system"
    status: CoachEventStatus = "confirmed"
    output_id: str | None = None
    client_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class CoachQueueApproveRequest(BaseModel):
    edited_output_text: str | None = None
    edited_output_json: dict[str, Any] | None = None
    apply_bundle: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=8, max_length=220)


class CoachQueueEditRequest(BaseModel):
    edited_output_text: str | None = None
    edited_output_json: dict[str, Any] | None = None
    notes: str | None = None


class CoachQueueRejectRequest(BaseModel):
    reason: str | None = None
    edited_output_text: str | None = None
    edited_output_json: dict[str, Any] | None = None


class CoachQueueMutationResponse(BaseModel):
    output: AIGeneratedOutput
    feedback_event: AIFeedbackEvent | None = None
    events: list[CoachSystemEventRecord] = Field(default_factory=list)
    memory_applied_count: int = 0
    delivery: dict[str, Any] = Field(default_factory=dict)
    program_template: dict[str, Any] = Field(default_factory=dict)
    queue_count: int = 0
