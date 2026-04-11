from __future__ import annotations

from typing import Any

from supabase import Client


class TrainerIntelligenceRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_default_persona(self, trainer_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_personas")
            .select("id, persona_name, tone_description, coaching_philosophy, communication_rules, fallback_behavior")
            .eq("trainer_id", trainer_id)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        return (response.data or [None])[0]

    def list_active_rules(self, trainer_id: str, *, limit: int) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_rules")
            .select("id, category, rule_text, confidence, updated_at")
            .eq("trainer_id", trainer_id)
            .eq("is_archived", False)
            .order("updated_at", desc=True)
            .limit(max(1, limit))
            .execute()
        )
        return response.data or []

    def list_recent_knowledge_documents(self, trainer_id: str, *, limit: int) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_knowledge_documents")
            .select("id, title, document_type, raw_text, metadata, created_at")
            .eq("trainer_id", trainer_id)
            .order("created_at", desc=True)
            .limit(max(1, limit))
            .execute()
        )
        return response.data or []

    def list_client_memory(self, trainer_id: str, client_id: str, *, limit: int) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("coach_memory")
            .select("id, memory_type, memory_key, value_json, updated_at")
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .order("updated_at", desc=True)
            .limit(max(1, limit))
            .execute()
        )
        return response.data or []

    def get_profile(self, client_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("user_fitness_profiles")
            .select("client_id, primary_goal, experience_level, equipment_access, onboarding_status, preferred_session_length")
            .eq("client_id", client_id)
            .limit(1)
            .execute()
        )
        return (response.data or [None])[0]

    def list_recent_checkins(self, client_id: str, *, limit: int) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("date, total_score, assigned_mode")
            .eq("client_id", client_id)
            .order("date", desc=True)
            .limit(max(1, limit))
            .execute()
        )
        return response.data or []

    def list_recent_completed_workouts(self, user_id: str, *, limit: int) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("workouts")
            .select("id, created_at, duration, feel_rating")
            .eq("user_id", user_id)
            .eq("completed", True)
            .order("created_at", desc=True)
            .limit(max(1, limit))
            .execute()
        )
        return response.data or []
