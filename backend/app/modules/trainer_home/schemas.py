from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class TrainerHomeTrainerSummary(BaseModel):
    trainer_id: str
    display_name: str | None = None
    trainer_onboarding_completed: bool = False


class TrainerHomeTotals(BaseModel):
    scheduled_clients: int
    checkins_completed_today: int
    workouts_completed_7d: int


class TrainerHomeCheckinDailyResponse(BaseModel):
    date: date
    score: int | None = None


class TrainerHomeCheckinQuestionSummary(BaseModel):
    key: str
    label: str
    average_7d: float | None = None
    responses_7d: int = 0
    low_days_7d: int = 0
    latest_score: int | None = None
    latest_date: date | None = None
    status: Literal["low", "watch", "steady", "no_data"] = "no_data"
    daily_responses: list[TrainerHomeCheckinDailyResponse] = Field(default_factory=list)


class TrainerHomeWeekSummary(BaseModel):
    checkins_completed_7d: int = 0
    checkins_completed_today: bool = False
    avg_score_7d: float | None = None
    avg_mode_7d: str | None = None
    workouts_completed_7d: int = 0
    question_summaries: list[TrainerHomeCheckinQuestionSummary] = Field(default_factory=list)


class TrainerHomeClientItem(BaseModel):
    schedule_id: str
    client_id: str
    client_name: str
    session_date: date
    session_start_at: datetime | None = None
    session_end_at: datetime | None = None
    session_type: str | None = None
    meeting_location: str | None = None
    notes: str | None = None
    status: str = "scheduled"
    week_summary: TrainerHomeWeekSummary
    talking_points: list[str] = Field(default_factory=list)


class TrainerHomeTodayResponse(BaseModel):
    date: date
    trainer: TrainerHomeTrainerSummary
    totals: TrainerHomeTotals
    clients: list[TrainerHomeClientItem] = Field(default_factory=list)


class TrainerHomeRiskFlag(BaseModel):
    code: str
    label: str
    severity: Literal["low", "medium", "high"] = "medium"
    detail: str | None = None


class TrainerHomeTalkingPointSet(BaseModel):
    points: list[str] = Field(default_factory=list)
    generation_strategy: str = "deterministic"
    generated_at: datetime | None = None
    expires_at: datetime | None = None
    cache_hit: bool = False


class TrainerHomeCommandCenterClientItem(BaseModel):
    client_id: str
    client_name: str
    priority_score: float = 0.0
    priority_tier: Literal["low", "medium", "high", "critical"] = "low"
    scheduled_today: bool = False
    session_start_at: datetime | None = None
    session_end_at: datetime | None = None
    session_type: str | None = None
    session_status: str | None = None
    meeting_location: str | None = None
    recurring_weekdays: list[int] = Field(default_factory=list)
    preferred_meeting_location: str | None = None
    auto_use_trainer_default_location: bool = True
    selected_date_exception_type: Literal["skip", "add"] | None = None
    selected_date_meeting_location_override: str | None = None
    week_summary: TrainerHomeWeekSummary
    risk_flags: list[TrainerHomeRiskFlag] = Field(default_factory=list)
    talking_points: TrainerHomeTalkingPointSet = Field(default_factory=TrainerHomeTalkingPointSet)
    last_checkin_date: date | None = None
    days_since_last_checkin: int | None = None


class TrainerHomeCommandCenterTotals(BaseModel):
    assigned_clients: int = 0
    scheduled_today: int = 0
    checkins_completed_today: int = 0
    high_priority_clients: int = 0
    critical_priority_clients: int = 0


class TrainerHomeCommandCenterResponse(BaseModel):
    date: date
    trainer: TrainerHomeTrainerSummary
    totals: TrainerHomeCommandCenterTotals
    clients: list[TrainerHomeCommandCenterClientItem] = Field(default_factory=list)
