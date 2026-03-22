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
