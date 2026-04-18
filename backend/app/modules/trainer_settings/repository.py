from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client


class TrainerSettingsRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_trainer_settings(self, trainer_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainers")
            .select("id, default_meeting_location, auto_fill_meeting_location")
            .eq("id", trainer_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def update_trainer_settings(self, trainer_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        payload = {
            **fields,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        response = (
            self.supabase
            .table("trainers")
            .update(payload)
            .eq("id", trainer_id)
            .execute()
        )
        return response.data[0] if response.data else None

