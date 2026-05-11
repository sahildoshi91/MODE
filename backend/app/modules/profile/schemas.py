from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

AlgorithmMemorySource = Literal["user", "trainer", "ai"]
AlgorithmMemoryType = Literal["note", "preference", "constraint"]


class FitnessProfile(BaseModel):
    client_id: str
    primary_goal: str | None = None
    user_why: str | None = None
    algorithm_summary: str | None = None
    algorithm_summary_updated_at: datetime | None = None
    is_training_for_event: bool | None = None
    event_type: str | None = None
    event_name: str | None = None
    event_date: str | None = None
    injuries_present: bool | None = None
    injury_notes: str | None = None
    equipment_access: str | None = None
    workout_frequency_target: int | None = None
    experience_level: str | None = None
    preferred_session_length: int | None = None
    current_mode: str | None = None
    training_location: str | None = None
    minimum_win: str | None = None
    weekly_availability: int | None = None
    onboarding_status: str = "not_started"
    onboarding_completed_at: str | None = None
    onboarding_last_step: str | None = None
    profile_version: int = 1


class ProfilePatchRequest(BaseModel):
    fields: dict[str, Any] = Field(default_factory=dict)


class ProfileWhyPatchRequest(BaseModel):
    user_why: str | None = None


class AlgorithmMemoryRecord(BaseModel):
    id: str
    text: str
    memory_type: AlgorithmMemoryType = "note"
    memory_key: str | None = None
    category: str | None = None
    source: AlgorithmMemorySource = "user"
    ai_usable: bool = True
    client_visible: bool = True
    can_edit: bool = False
    tags: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AlgorithmHomeResponse(BaseModel):
    client_id: str
    summary_text: str
    user_why: str | None = None
    algorithm_summary_updated_at: datetime | None = None
    memories: list[AlgorithmMemoryRecord] = Field(default_factory=list)


class AlgorithmMemoryCreateRequest(BaseModel):
    text: str
    category: str | None = None
    memory_type: AlgorithmMemoryType = "note"
    ai_usable: bool = True
    tags: list[str] = Field(default_factory=list)


class AlgorithmMemoryUpdateRequest(BaseModel):
    text: str | None = None
    category: str | None = None
    memory_type: AlgorithmMemoryType | None = None
    ai_usable: bool | None = None
    tags: list[str] | None = None
