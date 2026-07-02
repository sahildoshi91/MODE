from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client

_TABLE = "app_feedback_reports"


class FeedbackRepository:
    """User-scoped repository — all reads/writes go through the caller's JWT."""

    def __init__(self, supabase: Client) -> None:
        self._db = supabase

    def insert_report(self, *, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        row = {
            "user_id": user_id,
            **data,
        }
        response = self._db.table(_TABLE).insert(row).execute()
        return response.data[0]


class FeedbackAdminRepository:
    """Service-role repository — allowlist enforcement must happen in the service layer."""

    def __init__(self, supabase: Client) -> None:
        self._db = supabase

    def list_reports(
        self,
        *,
        status: str | None,
        limit: int,
        before: str | None,
    ) -> list[dict[str, Any]]:
        query = (
            self._db.table(_TABLE)
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
        )
        if status:
            query = query.eq("status", status)
        if before:
            query = query.lt("created_at", before)
        response = query.execute()
        return response.data or []

    def get_report(self, *, report_id: str) -> dict[str, Any] | None:
        response = (
            self._db.table(_TABLE)
            .select("*")
            .eq("id", report_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def update_report(
        self,
        *,
        report_id: str,
        updates: dict[str, Any],
        reviewed_by: str,
    ) -> dict[str, Any] | None:
        now = datetime.now(tz=timezone.utc).isoformat()
        payload = {
            **updates,
            "last_reviewed_by": reviewed_by,
            "updated_at": now,
        }
        response = (
            self._db.table(_TABLE)
            .update(payload)
            .eq("id", report_id)
            .execute()
        )
        return response.data[0] if response.data else None
