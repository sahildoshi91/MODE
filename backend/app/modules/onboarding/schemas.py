from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


UserRoleValue = Literal["client", "trainer"]
OnboardingStatusValue = Literal["not_started", "in_progress", "completed"]


class OnboardingBootstrapResponse(BaseModel):
    role: UserRoleValue | None = None
    onboarding_status: OnboardingStatusValue = "not_started"
    onboarding_step: str | None = None
    onboarding_payload: dict[str, Any] = Field(default_factory=dict)
    onboarding_complete: bool = False

    user_account_id: str
    client_id: str | None = None
    has_client_profile: bool = False
    trainer_attached: bool = False
    assigned_trainer_id: str | None = None
    assigned_trainer_display_name: str | None = None

    is_legacy_trainer: bool = False
    is_self_guided: bool = False
    is_feedback_admin: bool = False


class OnboardingRoleRequest(BaseModel):
    role: UserRoleValue


class OnboardingStatePatchRequest(BaseModel):
    status: OnboardingStatusValue | None = None
    current_step: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class OnboardingCompleteRequest(BaseModel):
    current_step: str | None = "system_ready"
    payload: dict[str, Any] = Field(default_factory=dict)


class TrainerStubProfileRequest(BaseModel):
    trainer_name: str | None = None
    contact_email: str | None = None
    notes: str | None = None


class OnboardingEventPayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    event_timestamp: datetime | None = None
    session_id: str | None = Field(default=None, max_length=128)
    properties: dict[str, Any] = Field(default_factory=dict)


class AnalyticsEventsRequest(BaseModel):
    events: list[OnboardingEventPayload] = Field(default_factory=list, max_length=100)


class AnalyticsEventsResponse(BaseModel):
    accepted: int
