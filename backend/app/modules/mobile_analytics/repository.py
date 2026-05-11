from __future__ import annotations

from typing import Any

from supabase import Client


class MobileAnalyticsRepository:
    def __init__(self, supabase_admin: Client):
        self.supabase_admin = supabase_admin

    def insert_events(self, *, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        response = (
            self.supabase_admin
            .table("mobile_analytics_events")
            .insert(rows)
            .execute()
        )
        return len(response.data or [])
