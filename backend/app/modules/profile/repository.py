from datetime import datetime, timezone
from typing import Any

from supabase import Client


class ProfileRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_by_client_id(self, client_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("user_fitness_profiles")
            .select("*")
            .eq("client_id", client_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def create_empty(self, client_id: str) -> dict[str, Any]:
        result = self.supabase.table("user_fitness_profiles").insert({"client_id": client_id}).execute()
        return result.data[0]

    def update_fields(self, client_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        result = (
            self.supabase
            .table("user_fitness_profiles")
            .update(fields)
            .eq("client_id", client_id)
            .execute()
        )
        return result.data[0] if result.data else fields

    def list_algorithm_memories(
        self,
        *,
        trainer_id: str,
        client_id: str,
    ) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("coach_memory")
            .select("id, trainer_id, client_id, memory_type, memory_key, value_json, created_at, updated_at")
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .order("updated_at", desc=True)
            .execute()
        )
        return response.data or []

    def insert_algorithm_memory(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("coach_memory").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def get_algorithm_memory(
        self,
        *,
        trainer_id: str,
        client_id: str,
        memory_id: str,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("coach_memory")
            .select("id, trainer_id, client_id, memory_type, memory_key, value_json, created_at, updated_at")
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .eq("id", memory_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def update_algorithm_memory(
        self,
        *,
        trainer_id: str,
        client_id: str,
        memory_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        next_payload = {
            **payload,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        response = (
            self.supabase
            .table("coach_memory")
            .update(next_payload)
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .eq("id", memory_id)
            .execute()
        )
        return (response.data or [None])[0] or {}

    def list_recent_checkins(self, client_id: str, *, limit: int = 5) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("date, inputs, total_score, assigned_mode")
            .eq("client_id", client_id)
            .order("date", desc=True)
            .limit(max(1, min(limit, 14)))
            .execute()
        )
        return response.data or []
