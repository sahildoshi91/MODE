from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from app.core.tenancy import TrainerContext
from app.modules.trainer_clients.repository import TrainerClientRepository
from app.modules.trainer_clients.schemas import (
    TrainerAIContextMemoryItem,
    TrainerAIContextResponse,
    TrainerClientActivitySummary,
    TrainerClientDetailResponse,
    TrainerClientIdentity,
    TrainerMemoryCounts,
    TrainerMemoryCreateRequest,
    TrainerMemoryRecord,
    TrainerMemoryUpdateRequest,
    TrainerRuleSummaryItem,
)

LEGACY_TO_CANONICAL_MODE = {
    "GREEN": "BEAST",
    "YELLOW": "BUILD",
    "BLUE": "RECOVER",
    "RED": "REST",
}


class TrainerClientService:
    def __init__(self, repository: TrainerClientRepository):
        self.repository = repository

    def get_client_detail(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        *,
        target_date: date | None = None,
    ) -> TrainerClientDetailResponse:
        client_row = self._require_client_assignment(trainer_context, client_id)
        resolved_date = target_date or datetime.now(timezone.utc).date()
        profile_snapshot = self._get_or_create_profile(client_id)
        activity_summary = self._build_activity_summary(
            trainer_id=trainer_context.trainer_id or "",
            client_row=client_row,
            target_date=resolved_date,
        )
        memory_rows = self.repository.list_memory(
            trainer_context.trainer_id or "",
            client_id,
            include_archived=True,
        )
        memory_counts = self._memory_counts(memory_rows)

        return TrainerClientDetailResponse(
            client=TrainerClientIdentity(
                client_id=client_row["id"],
                client_name=self._client_name(client_row),
                tenant_id=client_row.get("tenant_id"),
                user_id=client_row.get("user_id"),
            ),
            profile_snapshot=profile_snapshot,
            activity_summary=activity_summary,
            memory_counts=memory_counts,
        )

    def list_memory(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        *,
        include_archived: bool = False,
    ) -> list[TrainerMemoryRecord]:
        self._require_client_assignment(trainer_context, client_id)
        rows = self.repository.list_memory(
            trainer_context.trainer_id or "",
            client_id,
            include_archived=include_archived,
        )
        return [self._to_memory_record(row) for row in rows]

    def create_memory(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        request: TrainerMemoryCreateRequest,
    ) -> TrainerMemoryRecord:
        trainer_id = trainer_context.trainer_id or ""
        self._require_client_assignment(trainer_context, client_id)

        memory_key = request.memory_key.strip() if isinstance(request.memory_key, str) else ""
        if not memory_key:
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
            memory_key = f"{request.memory_type}_{timestamp}"

        text = request.text.strip() if isinstance(request.text, str) else None
        if not text and not request.structured_data:
            raise ValueError("Memory entry requires text or structured_data")

        payload = {
            "trainer_id": trainer_id,
            "client_id": client_id,
            "memory_type": request.memory_type,
            "memory_key": memory_key,
            "value_json": {
                "visibility": request.visibility,
                "is_archived": False,
                "text": text,
                "tags": self._normalize_tags(request.tags),
                "structured_data": request.structured_data or {},
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        created = self.repository.insert_memory(payload)
        if not created:
            raise ValueError("Memory create failed")
        return self._to_memory_record(created)

    def update_memory(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        memory_id: str,
        request: TrainerMemoryUpdateRequest,
    ) -> TrainerMemoryRecord:
        trainer_id = trainer_context.trainer_id or ""
        self._require_client_assignment(trainer_context, client_id)
        existing = self.repository.get_memory(trainer_id, client_id, memory_id)
        if not existing:
            raise ValueError("Memory not found")

        value_json = existing.get("value_json")
        value = value_json if isinstance(value_json, dict) else {}
        next_value = dict(value)

        if request.visibility is not None:
            next_value["visibility"] = request.visibility
        if request.text is not None:
            text = request.text.strip()
            next_value["text"] = text or None
        if request.tags is not None:
            next_value["tags"] = self._normalize_tags(request.tags)
        if request.structured_data is not None:
            next_value["structured_data"] = request.structured_data
        if request.is_archived is not None:
            next_value["is_archived"] = bool(request.is_archived)

        updates: dict[str, Any] = {
            "value_json": next_value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if request.memory_type is not None:
            updates["memory_type"] = request.memory_type
        if request.memory_key is not None:
            memory_key = request.memory_key.strip()
            if not memory_key:
                raise ValueError("Memory key cannot be empty")
            updates["memory_key"] = memory_key

        updated = self.repository.update_memory(trainer_id, client_id, memory_id, updates)
        if not updated:
            raise ValueError("Memory update failed")
        return self._to_memory_record(updated)

    def archive_memory(
        self,
        trainer_context: TrainerContext,
        client_id: str,
        memory_id: str,
    ) -> TrainerMemoryRecord:
        return self.update_memory(
            trainer_context,
            client_id,
            memory_id,
            TrainerMemoryUpdateRequest(is_archived=True),
        )

    def get_ai_context(
        self,
        trainer_context: TrainerContext,
        client_id: str,
    ) -> TrainerAIContextResponse:
        client_row = self._require_client_assignment(trainer_context, client_id)
        profile_snapshot = self._get_or_create_profile(client_id)
        memory_rows = self.repository.list_memory(
            trainer_context.trainer_id or "",
            client_id,
            include_archived=False,
        )
        records = [self._to_memory_record(row) for row in memory_rows]
        ai_usable = [row for row in records if row.visibility == "ai_usable" and not row.is_archived]
        internal_only_count = sum(
            1
            for row in records
            if row.visibility == "internal_only" and not row.is_archived
        )

        rule_rows = self.repository.list_active_trainer_rules(trainer_context.trainer_id or "")
        category_counts: Counter[str] = Counter()
        for rule_row in rule_rows:
            category = str(rule_row.get("category") or "general_coaching").strip().lower()
            category_counts[category] += 1

        summary_items = [
            TrainerRuleSummaryItem(category=category, rule_count=count)
            for category, count in category_counts.most_common(6)
        ]
        context_preview_text = self._build_context_preview_text(
            client_name=self._client_name(client_row),
            profile_snapshot=profile_snapshot,
            ai_usable=ai_usable,
            internal_only_count=internal_only_count,
            summary_items=summary_items,
        )

        return TrainerAIContextResponse(
            client_id=client_id,
            applied_ai_usable_memory=[
                TrainerAIContextMemoryItem(
                    id=record.id,
                    memory_type=record.memory_type,
                    memory_key=record.memory_key,
                    text=record.text,
                    tags=record.tags,
                    structured_data=record.structured_data,
                )
                for record in ai_usable
            ],
            internal_only_memory_count=internal_only_count,
            profile_snapshot=profile_snapshot,
            trainer_rule_summary=summary_items,
            context_preview_text=context_preview_text,
        )

    def _require_client_assignment(self, trainer_context: TrainerContext, client_id: str) -> dict[str, Any]:
        trainer_id = trainer_context.trainer_id
        if not trainer_id:
            raise ValueError("No trainer context found")
        client_row = self.repository.get_client_for_trainer(trainer_id, client_id)
        if not client_row:
            raise ValueError("Client not found for trainer")
        return client_row

    def _get_or_create_profile(self, client_id: str) -> dict[str, Any]:
        profile = self.repository.get_profile(client_id)
        if profile:
            return profile
        return self.repository.create_empty_profile(client_id)

    def _build_activity_summary(
        self,
        *,
        trainer_id: str,
        client_row: dict[str, Any],
        target_date: date,
    ) -> TrainerClientActivitySummary:
        client_id = str(client_row.get("id"))
        week_start = target_date - timedelta(days=6)
        checkins = self.repository.list_checkins_between(client_id, week_start, target_date)
        latest_checkin = self.repository.get_latest_checkin(client_id)

        score_values: list[float] = []
        mode_values: list[str] = []
        for checkin in checkins:
            score = checkin.get("total_score")
            if score is not None:
                try:
                    score_values.append(float(score))
                except (TypeError, ValueError):
                    pass
            mode = self._normalize_mode(checkin.get("assigned_mode"))
            if mode:
                mode_values.append(mode)

        avg_score = round(sum(score_values) / len(score_values), 2) if score_values else None
        avg_mode = Counter(mode_values).most_common(1)[0][0] if mode_values else None
        latest_date = self._coerce_date((latest_checkin or {}).get("date"), None)
        latest_mode = self._normalize_mode((latest_checkin or {}).get("assigned_mode"))
        days_since_last = (target_date - latest_date).days if latest_date else None

        workouts_completed_7d = 0
        user_id = client_row.get("user_id")
        if user_id:
            workouts = self.repository.list_completed_workouts_between(
                user_id,
                datetime.combine(week_start, time.min, tzinfo=timezone.utc),
                datetime.combine(target_date, time.max, tzinfo=timezone.utc),
            )
            workouts_completed_7d = len(workouts)

        today_schedule = self.repository.get_schedule_for_day(trainer_id, client_id, target_date)
        return TrainerClientActivitySummary(
            checkins_completed_7d=len(checkins),
            workouts_completed_7d=workouts_completed_7d,
            avg_score_7d=avg_score,
            avg_mode_7d=avg_mode,
            latest_checkin_date=latest_date,
            latest_mode=latest_mode,
            days_since_last_checkin=days_since_last,
            scheduled_today=bool(today_schedule),
            session_status=(today_schedule or {}).get("status"),
            session_type=(today_schedule or {}).get("session_type"),
            session_start_at=self._coerce_datetime((today_schedule or {}).get("session_start_at")),
            session_end_at=self._coerce_datetime((today_schedule or {}).get("session_end_at")),
        )

    def _memory_counts(self, rows: list[dict[str, Any]]) -> TrainerMemoryCounts:
        counts = TrainerMemoryCounts(total=len(rows))
        for row in rows:
            value_json = row.get("value_json")
            value = value_json if isinstance(value_json, dict) else {}
            visibility = str(value.get("visibility") or "internal_only").strip().lower()
            is_archived = bool(value.get("is_archived"))
            if is_archived:
                counts.archived += 1
            if visibility == "ai_usable":
                counts.ai_usable += 1
            else:
                counts.internal_only += 1
        return counts

    def _to_memory_record(self, row: dict[str, Any]) -> TrainerMemoryRecord:
        value_json = row.get("value_json")
        value = value_json if isinstance(value_json, dict) else {}
        visibility = str(value.get("visibility") or "internal_only").strip().lower()
        if visibility not in {"internal_only", "ai_usable"}:
            visibility = "internal_only"
        text = value.get("text")
        normalized_text = text.strip() if isinstance(text, str) and text.strip() else None
        return TrainerMemoryRecord(
            id=str(row.get("id")),
            trainer_id=str(row.get("trainer_id")),
            client_id=str(row.get("client_id")),
            memory_type=self._normalize_memory_type(row.get("memory_type")),
            memory_key=str(row.get("memory_key") or ""),
            visibility=visibility,  # type: ignore[arg-type]
            is_archived=bool(value.get("is_archived")),
            text=normalized_text,
            tags=self._normalize_tags(value.get("tags")),
            structured_data=self._normalize_structured_data(value.get("structured_data")),
            value_json=value,
            created_at=self._coerce_datetime(row.get("created_at")),
            updated_at=self._coerce_datetime(row.get("updated_at")),
        )

    def _build_context_preview_text(
        self,
        *,
        client_name: str,
        profile_snapshot: dict[str, Any],
        ai_usable: list[TrainerMemoryRecord],
        internal_only_count: int,
        summary_items: list[TrainerRuleSummaryItem],
    ) -> str:
        goal = str(profile_snapshot.get("primary_goal") or "unspecified").strip()
        onboarding_status = str(profile_snapshot.get("onboarding_status") or "unknown").strip()
        top_rule_categories = ", ".join(item.category for item in summary_items[:3]) or "general_coaching"
        ai_memory_snippet = "; ".join(
            item.text.strip()
            for item in ai_usable
            if isinstance(item.text, str) and item.text.strip()
        )
        if len(ai_memory_snippet) > 240:
            ai_memory_snippet = f"{ai_memory_snippet[:240].rstrip()}..."
        if not ai_memory_snippet:
            ai_memory_snippet = "No AI-usable trainer memory has been captured yet."

        return (
            f"{client_name} context uses primary goal '{goal}' with onboarding status '{onboarding_status}'. "
            f"Applied trainer rule categories: {top_rule_categories}. "
            f"AI-usable memory highlights: {ai_memory_snippet} "
            f"(internal-only memories excluded: {internal_only_count})."
        )

    def _normalize_memory_type(self, value: Any) -> str:
        text = str(value or "").strip().lower()
        if text in {"note", "preference", "constraint"}:
            return text
        return "note"

    def _normalize_tags(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        tags: list[str] = []
        for item in value:
            text = str(item or "").strip()
            if text:
                tags.append(text)
        return tags

    def _normalize_structured_data(self, value: Any) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    def _normalize_mode(self, mode: Any) -> str | None:
        if not mode:
            return None
        text = str(mode).strip().upper()
        return LEGACY_TO_CANONICAL_MODE.get(text, text)

    def _client_name(self, client_row: dict[str, Any]) -> str:
        name = client_row.get("client_name") if isinstance(client_row, dict) else None
        if isinstance(name, str) and name.strip():
            return name.strip()
        client_id = str(client_row.get("id") or "")
        if client_id:
            return f"Client {client_id[:6]}"
        return "Client"

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
