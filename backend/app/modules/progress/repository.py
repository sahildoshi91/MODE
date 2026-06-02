from datetime import date
from typing import Any

from supabase import Client


class ProgressRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def list_checkins_with_inputs(
        self, client_id: str, start_date: date, end_date: date
    ) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("date,total_score,assigned_mode,inputs")
            .eq("client_id", client_id)
            .gte("date", start_date.isoformat())
            .lte("date", end_date.isoformat())
            .not_.is_("total_score", "null")
            .order("date", desc=False)
            .execute()
        )
        return response.data or []

    def list_all_checkin_dates(self, client_id: str, on_or_before: date) -> list[date]:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("date")
            .eq("client_id", client_id)
            .lte("date", on_or_before.isoformat())
            .not_.is_("total_score", "null")
            .order("date", desc=True)
            .execute()
        )
        result = []
        for row in response.data or []:
            raw = row.get("date")
            if raw:
                result.append(date.fromisoformat(raw) if isinstance(raw, str) else raw)
        return result
