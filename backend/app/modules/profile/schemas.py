from typing import Any

from pydantic import BaseModel, Field


class FitnessProfile(BaseModel):
    client_id: str
    primary_goal: str | None = None
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
    onboarding_status: str = "not_started"
    profile_version: int = 1


class ProfilePatchRequest(BaseModel):
    fields: dict[str, Any] = Field(default_factory=dict)
