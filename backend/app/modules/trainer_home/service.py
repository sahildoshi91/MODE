from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from app.core.tenancy import TrainerContext
from app.modules.trainer_home.repository import TrainerHomeRepository
from app.modules.trainer_home.schemas import (
    TrainerHomeClientItem,
    TrainerHomeTodayResponse,
    TrainerHomeTotals,
    TrainerHomeTrainerSummary,
    TrainerHomeWeekSummary,
)


LEGACY_TO_CANONICAL_MODE = {
    "GREEN": "BEAST",
    "YELLOW": "BUILD",
    "BLUE": "RECOVER",
    "RED": "REST",
}


class TrainerHomeService:
    def __init__(self, repository: TrainerHomeRepository):
        self.repository = repository

    def build_today_dashboard(self, trainer_context: TrainerContext, target_date: date) -> TrainerHomeTodayResponse:
        if not trainer_context.trainer_id:
            raise ValueError("No trainer context found")

        schedule_rows = self.repository.list_schedule_for_day(trainer_context.trainer_id, target_date)
        scheduled_client_ids = {row.get("client_id") for row in schedule_rows if row.get("client_id")}

        client_rows = self.repository.list_clients_for_trainer(trainer_context.trainer_id)
        client_map = {
            row["id"]: row
            for row in client_rows
            if row.get("id") in scheduled_client_ids
        }

        week_start = target_date - timedelta(days=6)
        checkin_rows = self.repository.list_checkins_between(week_start, target_date)
        checkins_by_client: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in checkin_rows:
            client_id = row.get("client_id")
            if client_id in scheduled_client_ids:
                checkins_by_client[client_id].append(row)

        user_ids = {
            row.get("user_id")
            for row in client_map.values()
            if row.get("user_id")
        }
        start_time = datetime.combine(week_start, time.min, tzinfo=timezone.utc)
        end_time = datetime.combine(target_date, time.max, tzinfo=timezone.utc)
        workout_rows = self.repository.list_completed_workouts_between(start_time, end_time)
        workouts_by_user: dict[str, int] = defaultdict(int)
        for row in workout_rows:
            user_id = row.get("user_id")
            if user_id in user_ids:
                workouts_by_user[user_id] += 1

        today_checkin_clients: set[str] = set()
        client_items: list[TrainerHomeClientItem] = []

        for row in schedule_rows:
            client_id = row.get("client_id")
            if not client_id:
                continue
            client_profile = client_map.get(client_id) or {}
            client_name = self._client_name(client_profile, client_id)
            client_checkins = checkins_by_client.get(client_id, [])
            checkins_completed_today = self._has_today_checkin(client_checkins, target_date)
            if checkins_completed_today:
                today_checkin_clients.add(client_id)

            client_user_id = client_profile.get("user_id")
            workouts_completed_7d = workouts_by_user.get(client_user_id, 0) if client_user_id else 0

            week_summary = self._build_week_summary(
                client_checkins=client_checkins,
                target_date=target_date,
                workouts_completed_7d=workouts_completed_7d,
            )
            talking_points = self._build_talking_points(
                week_summary=week_summary,
                schedule_status=row.get("status"),
            )
            client_items.append(
                TrainerHomeClientItem(
                    schedule_id=str(row.get("id") or ""),
                    client_id=client_id,
                    client_name=client_name,
                    session_date=self._coerce_date(row.get("session_date"), target_date),
                    session_start_at=self._coerce_datetime(row.get("session_start_at")),
                    session_end_at=self._coerce_datetime(row.get("session_end_at")),
                    session_type=row.get("session_type"),
                    notes=row.get("notes"),
                    status=row.get("status") or "scheduled",
                    week_summary=week_summary,
                    talking_points=talking_points,
                )
            )

        total_workouts_completed = 0
        for client_id in scheduled_client_ids:
            client_user_id = (client_map.get(client_id) or {}).get("user_id")
            if client_user_id:
                total_workouts_completed += workouts_by_user.get(client_user_id, 0)

        totals = TrainerHomeTotals(
            scheduled_clients=len(scheduled_client_ids),
            checkins_completed_today=len(today_checkin_clients),
            workouts_completed_7d=total_workouts_completed,
        )
        trainer = TrainerHomeTrainerSummary(
            trainer_id=trainer_context.trainer_id,
            display_name=trainer_context.trainer_display_name,
            trainer_onboarding_completed=bool(trainer_context.trainer_onboarding_completed),
        )
        return TrainerHomeTodayResponse(
            date=target_date,
            trainer=trainer,
            totals=totals,
            clients=client_items,
        )

    def _build_week_summary(
        self,
        *,
        client_checkins: list[dict[str, Any]],
        target_date: date,
        workouts_completed_7d: int,
    ) -> TrainerHomeWeekSummary:
        scores = []
        modes: list[str] = []
        for row in client_checkins:
            score = row.get("total_score")
            if score is not None:
                try:
                    scores.append(float(score))
                except (TypeError, ValueError):
                    continue
            normalized_mode = self._normalize_mode(row.get("assigned_mode"))
            if normalized_mode:
                modes.append(normalized_mode)

        avg_score = round(sum(scores) / len(scores), 2) if scores else None
        avg_mode = self._dominant_mode(modes, avg_score)
        return TrainerHomeWeekSummary(
            checkins_completed_7d=len(client_checkins),
            checkins_completed_today=self._has_today_checkin(client_checkins, target_date),
            avg_score_7d=avg_score,
            avg_mode_7d=avg_mode,
            workouts_completed_7d=workouts_completed_7d,
        )

    def _build_talking_points(
        self,
        *,
        week_summary: TrainerHomeWeekSummary,
        schedule_status: str | None,
    ) -> list[str]:
        points: list[str] = []
        if not week_summary.checkins_completed_today:
            points.append("No check-in logged today. Start the session by confirming readiness and energy.")
        if week_summary.avg_score_7d is not None and week_summary.avg_score_7d < 15:
            points.append("Readiness trended low this week. Prioritize recovery, sleep, and controlled intensity.")
        if week_summary.checkins_completed_7d <= 2:
            points.append("Check-in consistency is low this week. Agree on a simple daily accountability trigger.")
        if week_summary.workouts_completed_7d == 0:
            points.append("No completed workouts logged in 7 days. Rebuild momentum with one achievable session.")
        if week_summary.avg_score_7d is not None and week_summary.avg_score_7d >= 20:
            points.append("Readiness has been strong this week. Consider progressive overload if movement quality is high.")

        status = (schedule_status or "").strip().lower()
        if status == "cancelled":
            points.append("Today's session is marked cancelled. Send a short fallback plan they can still complete.")
        elif status == "no_show":
            points.append("Recent no-show signal. Lead with empathy, then reset a concrete 72-hour action plan.")

        if not points:
            points.append("Week is stable. Reinforce wins and lock one specific performance target for next session.")
        return points[:3]

    def _has_today_checkin(self, rows: list[dict[str, Any]], target_date: date) -> bool:
        for row in rows:
            if self._coerce_date(row.get("date"), None) == target_date:
                return True
        return False

    def _client_name(self, client_row: dict[str, Any], client_id: str) -> str:
        name = client_row.get("client_name") if isinstance(client_row, dict) else None
        if isinstance(name, str) and name.strip():
            return name.strip()
        return f"Client {client_id[:6]}"

    def _dominant_mode(self, modes: list[str], avg_score: float | None) -> str | None:
        if modes:
            return Counter(modes).most_common(1)[0][0]
        if avg_score is None:
            return None
        if avg_score >= 21:
            return "BEAST"
        if avg_score >= 16:
            return "BUILD"
        if avg_score >= 11:
            return "RECOVER"
        return "REST"

    def _normalize_mode(self, mode: Any) -> str | None:
        if not mode:
            return None
        mode_text = str(mode).strip().upper()
        return LEGACY_TO_CANONICAL_MODE.get(mode_text, mode_text)

    def _coerce_date(self, value: Any, fallback: date | None) -> date | None:
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        if isinstance(value, str):
            try:
                return date.fromisoformat(value)
            except ValueError:
                return fallback
        return fallback

    def _coerce_datetime(self, value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
        return None
