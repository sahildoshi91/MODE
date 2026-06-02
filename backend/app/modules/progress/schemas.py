from datetime import date

from pydantic import BaseModel


class SignalEntry(BaseModel):
    dimension: str
    label: str
    current_value: int | None = None
    current_value_label: str | None = None
    period_avg: float | None = None
    week_note: str | None = None


class MetricDimension(BaseModel):
    surface_value: str
    surface_value_raw: float
    trend_direction: str
    trend_label: str
    status: str
    signals: list[SignalEntry]
    sparkline: list[float | None]
    coach_insight_triggered: bool
    coach_insight_reason: str | None = None


class StreakBlock(BaseModel):
    current_weeks: int
    days_this_week: int
    days_target: int
    milestone_next: int | None = None
    personal_best_weeks: int


class ProgressMetricsResponse(BaseModel):
    metrics: dict[str, MetricDimension]
    streak: StreakBlock
    as_of_date: date
    period_days: int
