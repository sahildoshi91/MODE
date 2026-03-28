from datetime import date
from typing import Any

from supabase import Client


class DailyCheckinRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_by_client_and_date(self, client_id: str, checkin_date: date) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("*")
            .eq("client_id", client_id)
            .eq("date", checkin_date.isoformat())
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def upsert_checkin(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase
            .table("daily_checkins")
            .upsert(payload, on_conflict="client_id,date")
            .execute()
        )
        return response.data[0]
