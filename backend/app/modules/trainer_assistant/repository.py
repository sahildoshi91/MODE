from __future__ import annotations

from typing import Any

from supabase import Client


class TrainerAssistantRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_last_selected_client_id(self, trainer_id: str) -> str | None:
        response = (
            self.supabase
            .table("trainers")
            .select("assistant_last_client_id")
            .eq("id", trainer_id)
            .limit(1)
            .execute()
        )
        row = (response.data or [None])[0]
        if not isinstance(row, dict):
            return None
        value = row.get("assistant_last_client_id")
        return str(value).strip() if value else None

    def set_last_selected_client_id(self, trainer_id: str, client_id: str | None) -> None:
        (
            self.supabase
            .table("trainers")
            .update({"assistant_last_client_id": client_id})
            .eq("id", trainer_id)
            .execute()
        )

    def insert_router_event(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_assistant_router_events")
            .insert(payload)
            .execute()
        )
        return (response.data or [None])[0]

    def get_generated_output(self, trainer_id: str, draft_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("ai_generated_outputs")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("id", draft_id)
            .limit(1)
            .execute()
        )
        return (response.data or [None])[0]
