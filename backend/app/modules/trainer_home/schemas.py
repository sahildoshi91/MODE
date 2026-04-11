from datetime import date, datetime

from pydantic import BaseModel, Field


class TrainerHomeTrainerSummary(BaseModel):
    trainer_id: str
    display_name: str | None = None
    trainer_onboarding_completed: bool = False


class TrainerHomeTotals(BaseModel):
    scheduled_clients: int
    checkins_completed_today: int
    workouts_completed_7d: int


class TrainerHomeWeekSummary(BaseModel):
    checkins_completed_7d: int = 0
    checkins_completed_today: bool = False
    avg_score_7d: float | None = None
    avg_mode_7d: str | None = None
    workouts_completed_7d: int = 0


class TrainerHomeClientItem(BaseModel):
    schedule_id: str
    client_id: str
    client_name: str
    session_date: date
    session_start_at: datetime | None = None
    session_end_at: datetime | None = None
    session_type: str | None = None
    notes: str | None = None
    status: str = "scheduled"
    week_summary: TrainerHomeWeekSummary
    talking_points: list[str] = Field(default_factory=list)


class TrainerHomeTodayResponse(BaseModel):
    date: date
    trainer: TrainerHomeTrainerSummary
    totals: TrainerHomeTotals
    clients: list[TrainerHomeClientItem] = Field(default_factory=list)
