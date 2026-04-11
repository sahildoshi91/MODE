from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


GeneratedOutputSourceType = Literal["chat", "talking_points", "generated_checkin_plan"]
GeneratedOutputStatus = Literal["open", "approved", "rejected"]
FeedbackEventType = Literal["edited", "approved", "rejected", "auto_applied"]
FeedbackApplyStatus = Literal["not_applicable", "pending", "applied", "failed"]
CoachMemoryType = Literal["note", "preference", "constraint"]


class AIGeneratedOutput(BaseModel):
    id: str
    tenant_id: str
    trainer_id: str
    client_id: str | None = None
    source_type: GeneratedOutputSourceType
    source_ref_id: str | None = None
    conversation_id: str | None = None
    message_id: str | None = None
    output_text: str | None = None
    output_json: dict[str, Any] = Field(default_factory=dict)
    generation_metadata: dict[str, Any] = Field(default_factory=dict)
    review_status: GeneratedOutputStatus = "open"
    reviewed_output_text: str | None = None
    reviewed_output_json: dict[str, Any] | None = None
    reviewed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AIFeedbackEvent(BaseModel):
    id: str
    tenant_id: str
    trainer_id: str
    client_id: str | None = None
    output_id: str
    event_type: FeedbackEventType
    original_output_text: str | None = None
    edited_output_text: str | None = None
    original_output_json: dict[str, Any] = Field(default_factory=dict)
    edited_output_json: dict[str, Any] = Field(default_factory=dict)
    extracted_deltas: list[dict[str, Any]] = Field(default_factory=list)
    apply_status: FeedbackApplyStatus = "not_applicable"
    apply_error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class AIOutputListResponse(BaseModel):
    items: list[AIGeneratedOutput] = Field(default_factory=list)
    count: int = 0


class AIOutputDetailResponse(BaseModel):
    output: AIGeneratedOutput
    feedback_events: list[AIFeedbackEvent] = Field(default_factory=list)


class AIOutputEditRequest(BaseModel):
    edited_output_text: str | None = None
    edited_output_json: dict[str, Any] | None = None
    notes: str | None = None
    auto_apply_deltas: bool = True


class AIOutputApproveRequest(BaseModel):
    edited_output_text: str | None = None
    edited_output_json: dict[str, Any] | None = None
    response_tags: list[str] = Field(default_factory=list)
    auto_apply_deltas: bool = True


class AIOutputRejectRequest(BaseModel):
    reason: str | None = None
    edited_output_text: str | None = None
    edited_output_json: dict[str, Any] | None = None


class AIOutputMutationResponse(BaseModel):
    output: AIGeneratedOutput
    feedback_event: AIFeedbackEvent
    auto_applied_count: int = 0
