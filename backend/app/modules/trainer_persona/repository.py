from typing import Any

from supabase import Client


class TrainerPersonaRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def list_by_trainer(self, trainer_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_personas")
            .select("*")
            .eq("trainer_id", trainer_id)
            .execute()
        )
        return response.data or []

    def get_default_by_trainer(self, trainer_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_personas")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self.supabase.table("trainer_personas").insert(payload).execute()
        return result.data[0]

    def update(self, persona_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        result = (
            self.supabase
            .table("trainer_personas")
            .update(payload)
            .eq("id", persona_id)
            .execute()
        )
        return result.data[0]
