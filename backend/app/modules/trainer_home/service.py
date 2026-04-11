from __future__ import annotations

import json
import logging
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from app.ai.client import GPT_5_4_MINI_MODEL, OpenAIClient
from app.core.config import settings
from app.core.tenancy import TrainerContext
from app.modules.ai_feedback.service import AIFeedbackService
from app.modules.trainer_home.repository import TrainerHomeRepository
from app.modules.trainer_home.schemas import (
    TrainerHomeCommandCenterClientItem,
    TrainerHomeCommandCenterResponse,
    TrainerHomeCommandCenterTotals,
    TrainerHomeClientItem,
    TrainerHomeRiskFlag,
    TrainerHomeTalkingPointSet,
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

logger = logging.getLogger(__name__)


class TrainerHomeService:
    TALKING_POINT_CACHE_TTL_HOURS = 12

    def __init__(
        self,
        repository: TrainerHomeRepository,
        openai_client: OpenAIClient | None = None,
        ai_feedback_logger_service: AIFeedbackService | None = None,
    ):
        self.repository = repository
        self.openai_client = openai_client if openai_client is not None else self._init_openai_client()
        self.ai_feedback_logger_service = ai_feedback_logger_service

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

    def build_command_center(
        self,
        trainer_context: TrainerContext,
        target_date: date,
        *,
        refresh_talking_points: bool = False,
    ) -> TrainerHomeCommandCenterResponse:
        if not trainer_context.trainer_id:
            raise ValueError("No trainer context found")

        trainer_id = trainer_context.trainer_id
        client_rows = self.repository.list_clients_for_trainer(trainer_id)
        client_map = {
            row.get("id"): row
            for row in client_rows
            if row.get("id")
        }
        client_ids = list(client_map.keys())

        trainer = TrainerHomeTrainerSummary(
            trainer_id=trainer_context.trainer_id,
            display_name=trainer_context.trainer_display_name,
            trainer_onboarding_completed=bool(trainer_context.trainer_onboarding_completed),
        )
        if not client_ids:
            return TrainerHomeCommandCenterResponse(
                date=target_date,
                trainer=trainer,
                totals=TrainerHomeCommandCenterTotals(),
                clients=[],
            )

        schedule_today_rows = self.repository.list_schedule_for_day(trainer_id, target_date)
        schedule_today_by_client = self._map_preferred_schedule_rows(schedule_today_rows)

        schedule_history_rows = self.repository.list_schedule_between(
            trainer_id,
            target_date - timedelta(days=13),
            target_date,
        )
        schedule_history_by_client: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in schedule_history_rows:
            client_id = row.get("client_id")
            if client_id in client_map:
                schedule_history_by_client[client_id].append(row)

        week_start = target_date - timedelta(days=6)
        checkin_rows = self.repository.list_checkins_between(week_start, target_date)
        checkins_by_client: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in checkin_rows:
            client_id = row.get("client_id")
            if client_id in client_map:
                checkins_by_client[client_id].append(row)

        user_ids = {
            row.get("user_id")
            for row in client_rows
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

        memory_rows = self.repository.list_coach_memory_for_trainer(trainer_id)
        ai_memory_by_client = self._group_ai_usable_memory(memory_rows, client_ids=client_ids)

        client_items: list[TrainerHomeCommandCenterClientItem] = []
        for client_id in client_ids:
            client_row = client_map.get(client_id) or {}
            client_checkins = checkins_by_client.get(client_id, [])
            client_schedule_today = schedule_today_by_client.get(client_id)
            client_schedule_history = schedule_history_by_client.get(client_id, [])

            workouts_completed_7d = workouts_by_user.get(client_row.get("user_id"), 0)
            week_summary = self._build_week_summary(
                client_checkins=client_checkins,
                target_date=target_date,
                workouts_completed_7d=workouts_completed_7d,
            )
            last_checkin_date = self._latest_checkin_date(client_checkins)
            days_since_last_checkin = self._days_since(target_date, last_checkin_date)
            status_counts = self._schedule_status_counts(client_schedule_history)
            risk_flags = self._build_risk_flags(
                week_summary=week_summary,
                scheduled_today=bool(client_schedule_today),
                schedule_status=(client_schedule_today or {}).get("status"),
                status_counts=status_counts,
                days_since_last_checkin=days_since_last_checkin,
            )
            priority_score = self._priority_score(
                week_summary=week_summary,
                scheduled_today=bool(client_schedule_today),
                status_counts=status_counts,
                days_since_last_checkin=days_since_last_checkin,
            )
            talking_points = self._get_or_generate_talking_points(
                trainer_context=trainer_context,
                client_row=client_row,
                week_summary=week_summary,
                risk_flags=risk_flags,
                ai_usable_memory=ai_memory_by_client.get(client_id, []),
                refresh_talking_points=refresh_talking_points,
            )

            client_items.append(
                TrainerHomeCommandCenterClientItem(
                    client_id=client_id,
                    client_name=self._client_name(client_row, client_id),
                    priority_score=round(priority_score, 2),
                    priority_tier=self._priority_tier(priority_score),
                    scheduled_today=bool(client_schedule_today),
                    session_start_at=self._coerce_datetime((client_schedule_today or {}).get("session_start_at")),
                    session_end_at=self._coerce_datetime((client_schedule_today or {}).get("session_end_at")),
                    session_type=(client_schedule_today or {}).get("session_type"),
                    session_status=(client_schedule_today or {}).get("status"),
                    week_summary=week_summary,
                    risk_flags=risk_flags,
                    talking_points=talking_points,
                    last_checkin_date=last_checkin_date,
                    days_since_last_checkin=days_since_last_checkin,
                )
            )

        client_items.sort(key=self._command_center_sort_key)
        totals = TrainerHomeCommandCenterTotals(
            assigned_clients=len(client_ids),
            scheduled_today=sum(1 for item in client_items if item.scheduled_today),
            checkins_completed_today=sum(1 for item in client_items if item.week_summary.checkins_completed_today),
            high_priority_clients=sum(1 for item in client_items if item.priority_tier in {"high", "critical"}),
            critical_priority_clients=sum(1 for item in client_items if item.priority_tier == "critical"),
        )
        return TrainerHomeCommandCenterResponse(
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

    def _build_risk_flags(
        self,
        *,
        week_summary: TrainerHomeWeekSummary,
        scheduled_today: bool,
        schedule_status: str | None,
        status_counts: dict[str, int],
        days_since_last_checkin: int | None,
    ) -> list[TrainerHomeRiskFlag]:
        flags: list[TrainerHomeRiskFlag] = []

        if scheduled_today and not week_summary.checkins_completed_today:
            flags.append(
                TrainerHomeRiskFlag(
                    code="missing_today_checkin",
                    label="No Check-In Today",
                    severity="high",
                    detail="Client is scheduled today without a readiness check-in.",
                )
            )

        if week_summary.avg_score_7d is not None and week_summary.avg_score_7d < 15:
            flags.append(
                TrainerHomeRiskFlag(
                    code="low_7d_readiness",
                    label="Low 7-Day Readiness",
                    severity="high" if week_summary.avg_score_7d < 13 else "medium",
                    detail=f"Average readiness is {week_summary.avg_score_7d:.1f}/25 over the last 7 days.",
                )
            )

        if week_summary.workouts_completed_7d <= 1:
            flags.append(
                TrainerHomeRiskFlag(
                    code="low_workout_completion",
                    label="Low Workout Completion",
                    severity="medium",
                    detail=f"Only {week_summary.workouts_completed_7d} workouts logged in 7 days.",
                )
            )

        if status_counts.get("no_show", 0) > 0:
            flags.append(
                TrainerHomeRiskFlag(
                    code="recent_no_show",
                    label="Recent No-Show",
                    severity="high",
                    detail="At least one no-show signal in the recent schedule window.",
                )
            )
        elif status_counts.get("cancelled", 0) > 0:
            flags.append(
                TrainerHomeRiskFlag(
                    code="recent_cancelled_session",
                    label="Recent Cancellation",
                    severity="medium",
                    detail="Recent cancellation signal detected.",
                )
            )

        if schedule_status and str(schedule_status).strip().lower() == "cancelled":
            flags.append(
                TrainerHomeRiskFlag(
                    code="today_cancelled",
                    label="Today Cancelled",
                    severity="medium",
                    detail="Today's session is marked cancelled.",
                )
            )

        if days_since_last_checkin is None:
            flags.append(
                TrainerHomeRiskFlag(
                    code="no_recent_checkins",
                    label="No Recent Check-Ins",
                    severity="high",
                    detail="No check-ins found in the recent window.",
                )
            )
        elif days_since_last_checkin >= 3:
            flags.append(
                TrainerHomeRiskFlag(
                    code="stale_checkin",
                    label="Stale Check-In",
                    severity="medium",
                    detail=f"Last check-in was {days_since_last_checkin} days ago.",
                )
            )

        return flags

    def _priority_score(
        self,
        *,
        week_summary: TrainerHomeWeekSummary,
        scheduled_today: bool,
        status_counts: dict[str, int],
        days_since_last_checkin: int | None,
    ) -> float:
        score = 0.0

        if scheduled_today and not week_summary.checkins_completed_today:
            score += 4.0

        if week_summary.avg_score_7d is None:
            score += 1.0
        elif week_summary.avg_score_7d < 13:
            score += 3.0
        elif week_summary.avg_score_7d < 16:
            score += 2.0
        elif week_summary.avg_score_7d < 18:
            score += 1.0

        if week_summary.workouts_completed_7d <= 0:
            score += 2.5
        elif week_summary.workouts_completed_7d <= 1:
            score += 2.0
        elif week_summary.workouts_completed_7d <= 2:
            score += 1.0

        if status_counts.get("no_show", 0) > 0:
            score += 3.0
        elif status_counts.get("cancelled", 0) > 0:
            score += 1.5

        if days_since_last_checkin is None:
            score += 2.0
        else:
            score += min(3.0, max(0, days_since_last_checkin - 1) * 0.5)

        return score

    def _priority_tier(self, score: float) -> str:
        if score >= 10:
            return "critical"
        if score >= 7:
            return "high"
        if score >= 4:
            return "medium"
        return "low"

    def _map_preferred_schedule_rows(self, rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        mapped: dict[str, dict[str, Any]] = {}
        for row in rows:
            client_id = row.get("client_id")
            if not client_id:
                continue

            current = mapped.get(client_id)
            if current is None:
                mapped[client_id] = row
                continue

            current_time = self._coerce_datetime(current.get("session_start_at"))
            next_time = self._coerce_datetime(row.get("session_start_at"))
            if current_time and next_time and next_time < current_time:
                mapped[client_id] = row
        return mapped

    def _schedule_status_counts(self, rows: list[dict[str, Any]]) -> dict[str, int]:
        counts: dict[str, int] = defaultdict(int)
        for row in rows:
            status = str(row.get("status") or "").strip().lower()
            if status:
                counts[status] += 1
        return counts

    def _latest_checkin_date(self, rows: list[dict[str, Any]]) -> date | None:
        latest: date | None = None
        for row in rows:
            row_date = self._coerce_date(row.get("date"), None)
            if row_date and (latest is None or row_date > latest):
                latest = row_date
        return latest

    def _days_since(self, target_date: date, source_date: date | None) -> int | None:
        if source_date is None:
            return None
        return max(0, (target_date - source_date).days)

    def _group_ai_usable_memory(
        self,
        rows: list[dict[str, Any]],
        *,
        client_ids: list[str],
    ) -> dict[str, list[dict[str, Any]]]:
        accepted_client_ids = set(client_ids)
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            client_id = row.get("client_id")
            if client_id not in accepted_client_ids:
                continue
            value_json = row.get("value_json")
            value = value_json if isinstance(value_json, dict) else {}
            if bool(value.get("is_archived")):
                continue
            visibility = str(value.get("visibility") or "internal_only").strip().lower()
            if visibility != "ai_usable":
                continue
            text = self._memory_text(row, value)
            grouped[client_id].append(
                {
                    "id": row.get("id"),
                    "memory_type": row.get("memory_type"),
                    "memory_key": row.get("memory_key"),
                    "text": text,
                    "tags": self._normalize_tags(value.get("tags")),
                }
            )
        return grouped

    def _memory_text(self, row: dict[str, Any], value: dict[str, Any]) -> str:
        if isinstance(value.get("text"), str) and value["text"].strip():
            return value["text"].strip()
        if isinstance(value.get("summary"), str) and value["summary"].strip():
            return value["summary"].strip()
        memory_key = str(row.get("memory_key") or "").strip()
        return memory_key or "Saved coaching memory"

    def _normalize_tags(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        tags: list[str] = []
        for item in value:
            tag = str(item or "").strip()
            if tag:
                tags.append(tag)
        return tags

    def _command_center_sort_key(self, item: TrainerHomeCommandCenterClientItem) -> tuple[Any, ...]:
        scheduled_weight = 0 if item.scheduled_today else 1
        session_start = item.session_start_at
        if isinstance(session_start, datetime):
            session_sort_value = session_start.timestamp()
        else:
            session_sort_value = float("inf")
        return (
            -item.priority_score,
            scheduled_weight,
            session_sort_value,
            item.client_name.lower(),
        )

    def _get_or_generate_talking_points(
        self,
        *,
        trainer_context: TrainerContext,
        client_row: dict[str, Any],
        week_summary: TrainerHomeWeekSummary,
        risk_flags: list[TrainerHomeRiskFlag],
        ai_usable_memory: list[dict[str, Any]],
        refresh_talking_points: bool,
    ) -> TrainerHomeTalkingPointSet:
        trainer_id = trainer_context.trainer_id
        client_id = client_row.get("id")
        now = datetime.now(timezone.utc)
        if not trainer_id or not client_id:
            return TrainerHomeTalkingPointSet(
                points=self._ensure_three_points([]),
                generation_strategy="deterministic",
            )

        cache_row = self.repository.get_talking_points_cache(trainer_id, client_id)
        if cache_row and not refresh_talking_points:
            cache_points = self._sanitize_points(cache_row.get("points_json"))
            cache_expires = self._coerce_datetime(cache_row.get("expires_at"))
            if len(cache_points) == 3 and cache_expires and cache_expires > now:
                return TrainerHomeTalkingPointSet(
                    points=cache_points,
                    generation_strategy=f"cache:{cache_row.get('generation_strategy') or 'deterministic'}",
                    generated_at=self._coerce_datetime(cache_row.get("generated_at")),
                    expires_at=cache_expires,
                    cache_hit=True,
                )

        deterministic_points = self._build_deterministic_talking_points(
            client_name=self._client_name(client_row, client_id),
            week_summary=week_summary,
            risk_flags=risk_flags,
            ai_usable_memory=ai_usable_memory,
        )
        strategy = "deterministic"
        points = deterministic_points

        if self.openai_client:
            try:
                llm_points = self._generate_llm_talking_points(
                    client_name=self._client_name(client_row, client_id),
                    week_summary=week_summary,
                    risk_flags=risk_flags,
                    ai_usable_memory=ai_usable_memory,
                    deterministic_points=deterministic_points,
                )
                if llm_points:
                    points = llm_points
                    strategy = "llm"
            except Exception:
                logger.exception("Command Center talking point generation failed, using deterministic fallback")
                strategy = "deterministic_fallback"
        else:
            strategy = "deterministic_fallback"

        points = self._ensure_three_points(points, fallback=deterministic_points)
        generated_at = now
        expires_at = now + timedelta(hours=self.TALKING_POINT_CACHE_TTL_HOURS)

        if trainer_context.tenant_id:
            self.repository.upsert_talking_points_cache(
                {
                    "tenant_id": trainer_context.tenant_id,
                    "trainer_id": trainer_id,
                    "client_id": client_id,
                    "points_json": points,
                    "generation_strategy": strategy,
                    "generated_at": generated_at.isoformat(),
                    "expires_at": expires_at.isoformat(),
                    "metadata": {
                        "risk_flags": [flag.code for flag in risk_flags],
                        "ai_memory_count": len(ai_usable_memory),
                    },
                    "updated_at": now.isoformat(),
                }
            )
            self._log_talking_points_output_safely(
                trainer_context=trainer_context,
                client_id=client_id,
                points=points,
                strategy=strategy,
                week_summary=week_summary,
                risk_flags=risk_flags,
                generated_at=generated_at,
                expires_at=expires_at,
                refresh_talking_points=refresh_talking_points,
            )

        return TrainerHomeTalkingPointSet(
            points=points,
            generation_strategy=strategy,
            generated_at=generated_at,
            expires_at=expires_at,
            cache_hit=False,
        )

    def _build_deterministic_talking_points(
        self,
        *,
        client_name: str,
        week_summary: TrainerHomeWeekSummary,
        risk_flags: list[TrainerHomeRiskFlag],
        ai_usable_memory: list[dict[str, Any]],
    ) -> list[str]:
        points: list[str] = []

        if ai_usable_memory:
            first_memory_text = str(ai_usable_memory[0].get("text") or "").strip()
            if first_memory_text:
                points.append(f"Anchor the session to saved context: {first_memory_text[:140]}")

        risk_point_by_code = {
            "missing_today_checkin": "Start by confirming readiness and blockers since no check-in is logged today.",
            "low_7d_readiness": "Readiness trended low; bias toward quality movement and controlled intensity.",
            "low_workout_completion": "Momentum is low; lock one realistic training win for the next 48 hours.",
            "recent_no_show": "Lead with empathy around recent no-show behavior, then reset a clear short-term plan.",
            "recent_cancelled_session": "Clarify schedule friction behind recent cancellations and co-design a fallback plan.",
            "today_cancelled": "Even with today cancelled, send a short substitute session they can complete at home.",
            "stale_checkin": "Re-establish accountability with a simple daily check-in trigger and time commitment.",
            "no_recent_checkins": "Rebuild engagement first before progression: one small action and one follow-up checkpoint.",
        }
        for flag in risk_flags:
            candidate = risk_point_by_code.get(flag.code)
            if candidate:
                points.append(candidate)

        if week_summary.avg_score_7d is not None and week_summary.avg_score_7d >= 20:
            points.append("Readiness is strong; consider progression if movement quality and recovery are both stable.")
        if week_summary.workouts_completed_7d >= 3:
            points.append("Reinforce consistency wins from this week and set one performance target for the next session.")

        if not points:
            points.append(
                f"{client_name} looks stable this week. Reinforce one clear win and set one measurable next step."
            )

        return self._ensure_three_points(points)

    def _generate_llm_talking_points(
        self,
        *,
        client_name: str,
        week_summary: TrainerHomeWeekSummary,
        risk_flags: list[TrainerHomeRiskFlag],
        ai_usable_memory: list[dict[str, Any]],
        deterministic_points: list[str],
    ) -> list[str]:
        if not self.openai_client:
            return []

        payload = {
            "client_name": client_name,
            "week_summary": week_summary.model_dump(mode="json"),
            "risk_flags": [flag.model_dump(mode="json") for flag in risk_flags],
            "ai_usable_memory": [
                {
                    "memory_type": row.get("memory_type"),
                    "memory_key": row.get("memory_key"),
                    "text": row.get("text"),
                    "tags": row.get("tags"),
                }
                for row in ai_usable_memory[:6]
            ],
            "fallback_points": deterministic_points[:3],
            "requirements": {
                "exact_points": 3,
                "style": "high-signal talking points for a trainer preparing to coach this client today",
                "constraints": [
                    "Keep each point concise and action-oriented.",
                    "Avoid medical certainty.",
                    "No markdown bullets; plain strings only.",
                ],
            },
        }

        completion = self.openai_client.create_chat_completion_with_usage(
            model=GPT_5_4_MINI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You generate trainer talking points.\n"
                        "Return strict JSON object with key `points`.\n"
                        "`points` must be an array of exactly 3 non-empty strings.\n"
                        "Do not include extra keys."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(payload),
                },
            ],
        )
        parsed = self._parse_json_object(completion.text)
        points = parsed.get("points") if isinstance(parsed, dict) else None
        normalized = self._sanitize_points(points)
        if len(normalized) < 3:
            return []
        return normalized[:3]

    def _parse_json_object(self, payload_text: str) -> dict[str, Any]:
        if not isinstance(payload_text, str):
            return {}
        raw = payload_text.strip()
        if not raw:
            return {}

        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            pass

        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(raw[start : end + 1])
                return parsed if isinstance(parsed, dict) else {}
            except json.JSONDecodeError:
                return {}
        return {}

    def _sanitize_points(self, points: Any) -> list[str]:
        if not isinstance(points, list):
            return []
        cleaned: list[str] = []
        seen: set[str] = set()
        for point in points:
            text = str(point or "").strip()
            if not text:
                continue
            while text.startswith("-") or text.startswith("*") or text.startswith("•"):
                text = text[1:].strip()
            if not text:
                continue
            normalized_key = text.lower()
            if normalized_key in seen:
                continue
            seen.add(normalized_key)
            cleaned.append(text[:220])
        return cleaned

    def _ensure_three_points(self, points: list[str], fallback: list[str] | None = None) -> list[str]:
        merged: list[str] = []
        seen: set[str] = set()

        for collection in (points, fallback or []):
            for point in collection:
                text = str(point or "").strip()
                if not text:
                    continue
                key = text.lower()
                if key in seen:
                    continue
                seen.add(key)
                merged.append(text)
                if len(merged) >= 3:
                    return merged[:3]

        defaults = [
            "Open with one specific win from the week, then confirm the highest-friction blocker.",
            "Set one clear action to complete in the next 24-48 hours and define when it will happen.",
            "Close with a confidence check and one accountability touchpoint before the next session.",
        ]
        for default_point in defaults:
            key = default_point.lower()
            if key in seen:
                continue
            seen.add(key)
            merged.append(default_point)
            if len(merged) >= 3:
                break
        return merged[:3]

    def _log_talking_points_output_safely(
        self,
        *,
        trainer_context: TrainerContext,
        client_id: str,
        points: list[str],
        strategy: str,
        week_summary: TrainerHomeWeekSummary,
        risk_flags: list[TrainerHomeRiskFlag],
        generated_at: datetime,
        expires_at: datetime,
        refresh_talking_points: bool,
    ) -> None:
        if not self.ai_feedback_logger_service:
            return
        if not trainer_context.tenant_id or not trainer_context.trainer_id:
            return
        try:
            self.ai_feedback_logger_service.log_generated_output(
                tenant_id=trainer_context.tenant_id,
                trainer_id=trainer_context.trainer_id,
                client_id=client_id,
                source_type="talking_points",
                source_ref_id=client_id,
                output_text="\n".join(points),
                output_json={
                    "points": points,
                    "risk_flags": [flag.code for flag in risk_flags],
                    "week_summary": week_summary.model_dump(mode="json"),
                },
                generation_metadata={
                    "producer": "trainer_home_command_center",
                    "generation_strategy": strategy,
                    "generated_at": generated_at.isoformat(),
                    "expires_at": expires_at.isoformat(),
                    "refresh_requested": refresh_talking_points,
                },
            )
        except Exception:
            logger.exception(
                "Failed to log command-center talking points output trainer_id=%s client_id=%s",
                trainer_context.trainer_id,
                client_id,
            )

    def _init_openai_client(self) -> OpenAIClient | None:
        if not settings.openai_api_key:
            return None
        try:
            return OpenAIClient()
        except Exception:  # pragma: no cover - exercised by runtime provider issues.
            logger.exception("Trainer home service could not initialize OpenAI client")
            return None

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
