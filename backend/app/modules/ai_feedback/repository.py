from __future__ import annotations

from typing import Any

from supabase import Client


class AIFeedbackRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def upsert_generated_output(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase
            .table("ai_generated_outputs")
            .upsert(payload, on_conflict="trainer_id,source_type,source_ref_id")
            .execute()
        )
        return (response.data or [None])[0] or {}

    def get_generated_output(self, trainer_id: str, output_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("ai_generated_outputs")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("id", output_id)
            .limit(1)
            .execute()
        )
        return (response.data or [None])[0]

    def list_generated_outputs(
        self,
        trainer_id: str,
        *,
        status: str | None = None,
        source_type: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        query = (
            self.supabase
            .table("ai_generated_outputs")
            .select("*")
            .eq("trainer_id", trainer_id)
        )
        if status:
            query = query.eq("review_status", status)
        if source_type:
            query = query.eq("source_type", source_type)

        response = (
            query
            .order("created_at", desc=True)
            .range(max(0, offset), max(0, offset) + max(1, limit) - 1)
            .execute()
        )
        return response.data or []

    def update_generated_output(self, trainer_id: str, output_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase
            .table("ai_generated_outputs")
            .update(payload)
            .eq("trainer_id", trainer_id)
            .eq("id", output_id)
            .execute()
        )
        return (response.data or [None])[0] or {}

    def insert_feedback_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("ai_feedback_events").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def list_feedback_events(self, output_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("ai_feedback_events")
            .select("*")
            .eq("output_id", output_id)
            .order("created_at", desc=True)
            .execute()
        )
        return response.data or []

    def find_memory_by_key(self, trainer_id: str, client_id: str, memory_key: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("coach_memory")
            .select("id, trainer_id, client_id, memory_type, memory_key, value_json, created_at, updated_at")
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .eq("memory_key", memory_key)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
        return (response.data or [None])[0]

    def insert_memory(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("coach_memory").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def update_memory(self, trainer_id: str, client_id: str, memory_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase
            .table("coach_memory")
            .update(payload)
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .eq("id", memory_id)
            .execute()
        )
        return (response.data or [None])[0] or {}
