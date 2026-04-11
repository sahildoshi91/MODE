from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


TrainerMemoryType = Literal["note", "preference", "constraint"]
TrainerMemoryVisibility = Literal["internal_only", "ai_usable"]


class TrainerClientIdentity(BaseModel):
    client_id: str
    client_name: str
    tenant_id: str | None = None
    user_id: str | None = None


class TrainerClientActivitySummary(BaseModel):
    checkins_completed_7d: int = 0
    workouts_completed_7d: int = 0
    avg_score_7d: float | None = None
    avg_mode_7d: str | None = None
    latest_checkin_date: date | None = None
    latest_mode: str | None = None
    days_since_last_checkin: int | None = None
    scheduled_today: bool = False
    session_status: str | None = None
    session_type: str | None = None
    session_start_at: datetime | None = None
    session_end_at: datetime | None = None


class TrainerMemoryCounts(BaseModel):
    total: int = 0
    ai_usable: int = 0
    internal_only: int = 0
    archived: int = 0


class TrainerClientDetailResponse(BaseModel):
    client: TrainerClientIdentity
    profile_snapshot: dict[str, Any] = Field(default_factory=dict)
    activity_summary: TrainerClientActivitySummary
    memory_counts: TrainerMemoryCounts


class TrainerMemoryRecord(BaseModel):
    id: str
    trainer_id: str
    client_id: str
    memory_type: TrainerMemoryType
    memory_key: str
    visibility: TrainerMemoryVisibility = "internal_only"
    is_archived: bool = False
    text: str | None = None
    tags: list[str] = Field(default_factory=list)
    structured_data: dict[str, Any] = Field(default_factory=dict)
    value_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TrainerMemoryCreateRequest(BaseModel):
    memory_type: TrainerMemoryType
    memory_key: str | None = None
    text: str | None = None
    visibility: TrainerMemoryVisibility = "internal_only"
    tags: list[str] = Field(default_factory=list)
    structured_data: dict[str, Any] = Field(default_factory=dict)


class TrainerMemoryUpdateRequest(BaseModel):
    memory_type: TrainerMemoryType | None = None
    memory_key: str | None = None
    text: str | None = None
    visibility: TrainerMemoryVisibility | None = None
    tags: list[str] | None = None
    structured_data: dict[str, Any] | None = None
    is_archived: bool | None = None


class TrainerRuleSummaryItem(BaseModel):
    category: str
    rule_count: int


class TrainerAIContextMemoryItem(BaseModel):
    id: str
    memory_type: TrainerMemoryType
    memory_key: str
    text: str | None = None
    tags: list[str] = Field(default_factory=list)
    structured_data: dict[str, Any] = Field(default_factory=dict)


class TrainerAIContextResponse(BaseModel):
    client_id: str
    applied_ai_usable_memory: list[TrainerAIContextMemoryItem] = Field(default_factory=list)
    internal_only_memory_count: int = 0
    profile_snapshot: dict[str, Any] = Field(default_factory=dict)
    trainer_rule_summary: list[TrainerRuleSummaryItem] = Field(default_factory=list)
    context_preview_text: str
