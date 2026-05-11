from __future__ import annotations

from typing import Any

from supabase import Client


class TrainerProgramRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def list_templates(
        self,
        trainer_id: str,
        *,
        include_archived: bool = False,
        limit: int = 120,
    ) -> list[dict[str, Any]]:
        query = (
            self.supabase
            .table("trainer_program_templates")
            .select("*")
            .eq("trainer_id", trainer_id)
        )
        if not include_archived:
            query = query.eq("is_archived", False)
        response = (
            query
            .order("updated_at", desc=True)
            .order("created_at", desc=True)
            .limit(max(1, min(limit, 250)))
            .execute()
        )
        return response.data or []

    def get_template(self, trainer_id: str, template_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_program_templates")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("id", template_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def create_template(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        response = self.supabase.table("trainer_program_templates").insert(payload).execute()
        return (response.data or [None])[0]

    def update_template(
        self,
        trainer_id: str,
        template_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_program_templates")
            .update(payload)
            .eq("trainer_id", trainer_id)
            .eq("id", template_id)
            .execute()
        )
        return (response.data or [None])[0]
