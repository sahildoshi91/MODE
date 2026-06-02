from datetime import date, timedelta

from app.modules.progress.repository import ProgressRepository
from app.modules.progress.schemas import (
    MetricDimension,
    ProgressMetricsResponse,
    SignalEntry,
    StreakBlock,
)

_DIMENSION_FIELDS: dict[str, str] = {
    "sleep": "sleep",
    "recovery": "soreness",
    "energy_mood": "motivation",
    "stress": "stress",
    "nutrition": "nutrition",
}

_DIMENSION_LABELS: dict[str, str] = {
    "sleep": "Sleep",
    "recovery": "Recovery",
    "energy_mood": "Energy & mood",
    "stress": "Calm",
    "nutrition": "Nutrition",
}

_STREAK_MILESTONES = [2, 4, 8, 12]

_COACH_INSIGHT_REASONS = [
    "low_sleep_3_days",
    "low_recovery_3_days",
    "low_energy_3_days",
    "low_calm_3_days",
    "nutrition_below_target_7d",
    "readiness_sharp_drop",
]


def _score_label(avg: float) -> str:
    if avg >= 4.5:
        return "Great"
    if avg >= 3.5:
        return "Good"
    if avg >= 2.5:
        return "Moderate"
    if avg >= 1.5:
        return "Low"
    return "Very low"


def _value_label(value: int) -> str:
    return _score_label(float(value))


def _status(avg: float | None, *, is_readiness: bool = False) -> str:
    if avg is None:
        return "watch"
    if is_readiness:
        if avg >= 17:
            return "good"
        if avg >= 12:
            return "watch"
        return "flagged"
    if avg >= 3.5:
        return "good"
    if avg >= 2.5:
        return "watch"
    return "flagged"


def _average(values: list[float]) -> float | None:
    filtered = [v for v in values if v is not None]
    if not filtered:
        return None
    return round(sum(filtered) / len(filtered), 2)


def _trend(current_avg: float | None, prior_avg: float | None) -> tuple[str, str]:
    if current_avg is None or prior_avg is None:
        return "stable", "→ stable"
    delta = current_avg - prior_avg
    if delta > 0.2:
        return "up", "↑ improving"
    if delta < -0.2:
        return "down", "↓ declining"
    return "stable", "→ stable"


def _week_note(current_avg: float | None, prior_avg: float | None) -> str | None:
    if current_avg is None or prior_avg is None:
        return None
    delta = current_avg - prior_avg
    if delta > 0.2:
        return "↑ vs last week"
    if delta < -0.2:
        return "↓ vs last week"
    return None


def _calculate_streak_days(completed_dates: set[date], as_of_date: date) -> int:
    streak = 0
    cursor = as_of_date
    while cursor in completed_dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _calculate_max_streak_days(all_dates: list[date]) -> int:
    if not all_dates:
        return 0
    sorted_dates = sorted(set(all_dates))
    max_streak = 1
    current = 1
    for i in range(1, len(sorted_dates)):
        if (sorted_dates[i] - sorted_dates[i - 1]).days == 1:
            current += 1
            max_streak = max(max_streak, current)
        else:
            current = 1
    return max_streak


class ProgressService:
    def __init__(self, repository: ProgressRepository):
        self.repository = repository

    def get_metrics(
        self, client_id: str, as_of_date: date, period_days: int
    ) -> ProgressMetricsResponse:
        end_date = as_of_date
        start_date = end_date - timedelta(days=period_days - 1)
        prior_end = start_date - timedelta(days=1)
        prior_start = prior_end - timedelta(days=period_days - 1)

        current_rows = self.repository.list_checkins_with_inputs(client_id, start_date, end_date)
        prior_rows = self.repository.list_checkins_with_inputs(client_id, prior_start, prior_end)
        all_dates = self.repository.list_all_checkin_dates(client_id, as_of_date)

        date_to_row: dict[date, dict] = {}
        for row in current_rows:
            raw_date = row.get("date")
            if not raw_date:
                continue
            d = date.fromisoformat(raw_date) if isinstance(raw_date, str) else raw_date
            date_to_row[d] = row

        prior_date_to_row: dict[date, dict] = {}
        for row in prior_rows:
            raw_date = row.get("date")
            if not raw_date:
                continue
            d = date.fromisoformat(raw_date) if isinstance(raw_date, str) else raw_date
            prior_date_to_row[d] = row

        calendar = [start_date + timedelta(days=i) for i in range(period_days)]

        metrics: dict[str, MetricDimension] = {}

        metrics["readiness"] = self._build_readiness_dimension(
            calendar, date_to_row, prior_date_to_row
        )

        for dim_key, input_field in _DIMENSION_FIELDS.items():
            metrics[dim_key] = self._build_single_dimension(
                dim_key, input_field, calendar, date_to_row, prior_date_to_row, period_days
            )

        streak = self._build_streak(all_dates, as_of_date)

        return ProgressMetricsResponse(
            metrics=metrics,
            streak=streak,
            as_of_date=as_of_date,
            period_days=period_days,
        )

    def _build_readiness_dimension(
        self,
        calendar: list[date],
        date_to_row: dict[date, dict],
        prior_date_to_row: dict[date, dict],
    ) -> MetricDimension:
        sparkline: list[float | None] = []
        for d in calendar:
            row = date_to_row.get(d)
            sparkline.append(float(row["total_score"]) if row and row.get("total_score") is not None else None)

        current_vals = [v for v in sparkline if v is not None]
        current_avg = _average(current_vals)

        prior_vals = [
            float(row["total_score"])
            for row in prior_date_to_row.values()
            if row.get("total_score") is not None
        ]
        prior_avg = _average(prior_vals)

        trend_dir, trend_label = _trend(current_avg, prior_avg)
        status = _status(current_avg, is_readiness=True)

        surface_raw = round(current_avg, 2) if current_avg is not None else 0.0
        surface_value = f"{round(surface_raw)}/25" if current_avg is not None else "—"

        signals = self._build_readiness_signals(calendar, date_to_row, prior_date_to_row)

        coach_triggered, coach_reason = self._detect_readiness_insight(
            calendar, date_to_row, current_avg
        )

        return MetricDimension(
            surface_value=surface_value,
            surface_value_raw=surface_raw,
            trend_direction=trend_dir,
            trend_label=trend_label,
            status=status,
            signals=signals,
            sparkline=sparkline,
            coach_insight_triggered=coach_triggered,
            coach_insight_reason=coach_reason,
        )

    def _build_readiness_signals(
        self,
        calendar: list[date],
        date_to_row: dict[date, dict],
        prior_date_to_row: dict[date, dict],
    ) -> list[SignalEntry]:
        entries = []
        sub_dims = [
            ("sleep", "sleep", "Sleep"),
            ("recovery", "soreness", "Recovery"),
            ("energy_mood", "motivation", "Energy & mood"),
            ("stress", "stress", "Calm"),
            ("nutrition", "nutrition", "Nutrition"),
        ]
        for dim_key, input_field, label in sub_dims:
            current_vals = self._extract_dim_values(input_field, calendar, date_to_row)
            prior_vals = self._extract_dim_values(input_field, list(prior_date_to_row.keys()), prior_date_to_row)
            current_avg = _average(current_vals)
            prior_avg = _average(prior_vals)

            most_recent = self._most_recent_value(input_field, calendar, date_to_row)
            current_label = _value_label(most_recent) if most_recent is not None else None

            entries.append(SignalEntry(
                dimension=dim_key,
                label=label,
                current_value=most_recent,
                current_value_label=current_label,
                period_avg=current_avg,
                week_note=_week_note(current_avg, prior_avg),
            ))
        return entries

    def _build_single_dimension(
        self,
        dim_key: str,
        input_field: str,
        calendar: list[date],
        date_to_row: dict[date, dict],
        prior_date_to_row: dict[date, dict],
        period_days: int,
    ) -> MetricDimension:
        sparkline: list[float | None] = []
        for d in calendar:
            row = date_to_row.get(d)
            if row and isinstance(row.get("inputs"), dict):
                val = row["inputs"].get(input_field)
                sparkline.append(float(val) if val is not None else None)
            else:
                sparkline.append(None)

        current_vals = [v for v in sparkline if v is not None]
        current_avg = _average(current_vals)

        prior_vals = [
            float(row["inputs"][input_field])
            for row in prior_date_to_row.values()
            if isinstance(row.get("inputs"), dict) and row["inputs"].get(input_field) is not None
        ]
        prior_avg = _average(prior_vals)

        trend_dir, trend_label = _trend(current_avg, prior_avg)
        status = _status(current_avg)

        surface_raw = round(current_avg, 2) if current_avg is not None else 0.0
        surface_value = _score_label(surface_raw) if current_avg is not None else "—"

        most_recent = self._most_recent_value(input_field, calendar, date_to_row)

        signals = self._build_recent_signals(
            dim_key, input_field, _DIMENSION_LABELS[dim_key], calendar, date_to_row, prior_date_to_row
        )

        coach_triggered, coach_reason = self._detect_single_dim_insight(
            dim_key, input_field, calendar, date_to_row, current_avg, period_days
        )

        return MetricDimension(
            surface_value=surface_value,
            surface_value_raw=surface_raw,
            trend_direction=trend_dir,
            trend_label=trend_label,
            status=status,
            signals=signals,
            sparkline=sparkline,
            coach_insight_triggered=coach_triggered,
            coach_insight_reason=coach_reason,
        )

    def _build_recent_signals(
        self,
        dim_key: str,
        input_field: str,
        label: str,
        calendar: list[date],
        date_to_row: dict[date, dict],
        prior_date_to_row: dict[date, dict],
    ) -> list[SignalEntry]:
        current_vals = self._extract_dim_values(input_field, calendar, date_to_row)
        prior_vals = self._extract_dim_values(input_field, list(prior_date_to_row.keys()), prior_date_to_row)
        current_avg = _average(current_vals)
        prior_avg = _average(prior_vals)

        most_recent = self._most_recent_value(input_field, calendar, date_to_row)
        current_label = _value_label(most_recent) if most_recent is not None else None

        return [
            SignalEntry(
                dimension=dim_key,
                label=label,
                current_value=most_recent,
                current_value_label=current_label,
                period_avg=current_avg,
                week_note=_week_note(current_avg, prior_avg),
            )
        ]

    def _extract_dim_values(
        self, input_field: str, days: list[date], date_to_row: dict[date, dict]
    ) -> list[float]:
        result = []
        for d in days:
            row = date_to_row.get(d)
            if row and isinstance(row.get("inputs"), dict):
                val = row["inputs"].get(input_field)
                if val is not None:
                    result.append(float(val))
        return result

    def _most_recent_value(
        self, input_field: str, calendar: list[date], date_to_row: dict[date, dict]
    ) -> int | None:
        for d in reversed(calendar):
            row = date_to_row.get(d)
            if row and isinstance(row.get("inputs"), dict):
                val = row["inputs"].get(input_field)
                if val is not None:
                    return int(val)
        return None

    def _detect_readiness_insight(
        self,
        calendar: list[date],
        date_to_row: dict[date, dict],
        period_avg: float | None,
    ) -> tuple[bool, str | None]:
        recent_rows = [date_to_row[d] for d in reversed(calendar) if d in date_to_row]
        recent_3 = recent_rows[:3]

        if len(recent_3) >= 3 and period_avg is not None:
            recent_scores = [float(r["total_score"]) for r in recent_3 if r.get("total_score") is not None]
            recent_avg_3 = _average(recent_scores)
            if recent_avg_3 is not None and recent_avg_3 < (period_avg - 4):
                return True, "readiness_sharp_drop"

        return False, None

    def _detect_single_dim_insight(
        self,
        dim_key: str,
        input_field: str,
        calendar: list[date],
        date_to_row: dict[date, dict],
        period_avg: float | None,
        period_days: int,
    ) -> tuple[bool, str | None]:
        recent_rows = [date_to_row[d] for d in reversed(calendar) if d in date_to_row]
        recent_3_vals = []
        for row in recent_rows[:3]:
            if isinstance(row.get("inputs"), dict):
                val = row["inputs"].get(input_field)
                if val is not None:
                    recent_3_vals.append(int(val))

        consecutive_low_reasons = {
            "sleep": "low_sleep_3_days",
            "recovery": "low_recovery_3_days",
            "energy_mood": "low_energy_3_days",
            "stress": "low_calm_3_days",
        }

        if dim_key in consecutive_low_reasons and len(recent_3_vals) == 3 and all(v < 3 for v in recent_3_vals):
            return True, consecutive_low_reasons[dim_key]

        if dim_key == "nutrition" and period_days == 7 and period_avg is not None and period_avg < 3.0:
            return True, "nutrition_below_target_7d"

        return False, None

    def _build_streak(self, all_dates: list[date], as_of_date: date) -> StreakBlock:
        date_set = set(all_dates)

        streak_days = _calculate_streak_days(date_set, as_of_date)
        current_weeks = streak_days // 7

        iso_weekday = as_of_date.isoweekday()
        week_start = as_of_date - timedelta(days=iso_weekday - 1)
        days_this_week = sum(1 for d in all_dates if week_start <= d <= as_of_date)

        max_streak_days = _calculate_max_streak_days(all_dates)
        personal_best_weeks = max_streak_days // 7

        milestone_next = next(
            (m for m in _STREAK_MILESTONES if m > current_weeks), None
        )

        return StreakBlock(
            current_weeks=current_weeks,
            days_this_week=days_this_week,
            days_target=7,
            milestone_next=milestone_next,
            personal_best_weeks=personal_best_weeks,
        )
