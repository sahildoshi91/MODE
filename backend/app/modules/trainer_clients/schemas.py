from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


TrainerMemoryType = Literal["note", "preference", "constraint"]
TrainerMemoryVisibility = Literal["internal_only", "ai_usable"]
TrainerScheduleExceptionType = Literal["skip", "add"]
ConnectionRequestStatus = Literal["pending", "approved", "rejected", "cancelled"]


class TrainerClientIdentity(BaseModel):
    client_id: str
    client_name: str
    tenant_id: str | None = None
    user_id: str | None = None
    created_at: datetime | None = None
    is_assigned_to_trainer: bool = True
    is_pending_user: bool = False


class TrainerClientListResponse(BaseModel):
    items: list[TrainerClientIdentity] = Field(default_factory=list)
    count: int = 0
    limit: int = 50
    offset: int = 0
    search: str | None = None


class TrainerClientConnectionRequestRecord(BaseModel):
    id: str
    client_id: str
    client_name: str | None = None
    trainer_id: str
    requested_by_user_id: str
    request_text: str
    status: ConnectionRequestStatus = "pending"
    trainer_response_note: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    resolved_at: datetime | None = None


class TrainerClientConnectionRequestListResponse(BaseModel):
    items: list[TrainerClientConnectionRequestRecord] = Field(default_factory=list)
    count: int = 0
    status: ConnectionRequestStatus | None = "pending"


class TrainerClientConnectionRequestDecisionRequest(BaseModel):
    trainer_response_note: str | None = None


class TrainerClientUpdateRequest(BaseModel):
    client_name: str


class TrainerClientInviteCodeRecord(BaseModel):
    """Metadata-only view returned by GET and DELETE. Never includes plaintext code or hash."""
    id: str
    trainer_id: str
    tenant_id: str
    status: str = "active"
    is_active: bool = True
    expires_at: datetime | None = None
    used_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime | None = None


class TrainerClientInviteCodeCreateResponse(BaseModel):
    """Returned only by POST /invite-codes. Includes the plaintext code shown once."""
    id: str
    code: str
    trainer_id: str
    tenant_id: str
    expires_at: datetime | None = None
    created_at: datetime | None = None


class TrainerClientInviteCodeListResponse(BaseModel):
    items: list[TrainerClientInviteCodeRecord] = Field(default_factory=list)
    count: int = 0
    limit: int = 50
    offset: int = 0


class TrainerClientInviteCodeCreateRequest(BaseModel):
    pass


class TrainerClientCheckinDailyResponse(BaseModel):
    date: date
    score: int | None = None


class TrainerClientCheckinQuestionSummary(BaseModel):
    key: str
    label: str
    average_7d: float | None = None
    responses_7d: int = 0
    low_days_7d: int = 0
    latest_score: int | None = None
    latest_date: date | None = None
    status: Literal["low", "watch", "steady", "no_data"] = "no_data"
    daily_responses: list[TrainerClientCheckinDailyResponse] = Field(default_factory=list)


class TrainerClientActivitySummary(BaseModel):
    checkins_completed_7d: int = 0
    workouts_completed_7d: int = 0
    avg_score_7d: float | None = None
    avg_mode_7d: str | None = None
    latest_checkin_date: date | None = None
    latest_mode: str | None = None
    days_since_last_checkin: int | None = None
    question_summaries: list[TrainerClientCheckinQuestionSummary] = Field(default_factory=list)
    scheduled_today: bool = False
    session_status: str | None = None
    session_type: str | None = None
    session_start_at: datetime | None = None
    session_end_at: datetime | None = None
    meeting_location: str | None = None


class TrainerMemoryCounts(BaseModel):
    total: int = 0
    ai_usable: int = 0
    internal_only: int = 0
    archived: int = 0


class TrainerScheduleExceptionRecord(BaseModel):
    id: str | None = None
    trainer_id: str | None = None
    client_id: str
    session_date: date
    exception_type: TrainerScheduleExceptionType
    meeting_location_override: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TrainerSchedulePreferencesRecord(BaseModel):
    trainer_id: str | None = None
    client_id: str
    recurring_weekdays: list[int] = Field(default_factory=list)
    preferred_meeting_location: str | None = None
    auto_use_trainer_default_location: bool = True
    trainer_default_meeting_location: str | None = None
    trainer_auto_fill_meeting_location: bool = True
    selected_date: date | None = None
    selected_date_exception_type: TrainerScheduleExceptionType | None = None
    selected_date_meeting_location_override: str | None = None
    upcoming_exceptions: list[TrainerScheduleExceptionRecord] = Field(default_factory=list)


class TrainerClientDetailResponse(BaseModel):
    client: TrainerClientIdentity
    profile_snapshot: dict[str, Any] = Field(default_factory=dict)
    activity_summary: TrainerClientActivitySummary
    memory_counts: TrainerMemoryCounts
    schedule_preferences: TrainerSchedulePreferencesRecord | None = None


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


class TrainerMeetingLocationUpdateRequest(BaseModel):
    session_date: date
    meeting_location: str | None = None


class TrainerMeetingLocationRecord(BaseModel):
    schedule_id: str
    client_id: str
    session_date: date
    meeting_location: str | None = None


class TrainerSchedulePreferencesUpdateRequest(BaseModel):
    recurring_weekdays: list[int] | None = None
    preferred_meeting_location: str | None = None
    auto_use_trainer_default_location: bool | None = None


class TrainerScheduleExceptionCreateRequest(BaseModel):
    session_date: date
    exception_type: TrainerScheduleExceptionType
    meeting_location_override: str | None = None


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


class ClientTrainerScheduleResponse(BaseModel):
    client_id: str
    trainer_id: str | None = None
    trainer_display_name: str | None = None
    recurring_weekdays: list[int] = Field(default_factory=list)
    upcoming_exceptions: list[TrainerScheduleExceptionRecord] = Field(default_factory=list)
    resolved_default_meeting_location: str | None = None
