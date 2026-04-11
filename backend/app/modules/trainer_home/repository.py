from datetime import date, datetime
from typing import Any

from supabase import Client


class TrainerHomeRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def list_schedule_for_day(self, trainer_id: str, session_date: date) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_daily_schedule")
            .select("id, trainer_id, client_id, session_date, session_start_at, session_end_at, session_type, notes, status")
            .eq("trainer_id", trainer_id)
            .eq("session_date", session_date.isoformat())
            .order("session_start_at")
            .order("id")
            .execute()
        )
        return response.data or []

    def list_clients_for_trainer(self, trainer_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("clients")
            .select("id, tenant_id, user_id, client_name, assigned_trainer_id")
            .eq("assigned_trainer_id", trainer_id)
            .execute()
        )
        return response.data or []

    def list_schedule_between(self, trainer_id: str, start_date: date, end_date: date) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_daily_schedule")
            .select("id, trainer_id, client_id, session_date, session_start_at, session_end_at, session_type, notes, status")
            .eq("trainer_id", trainer_id)
            .gte("session_date", start_date.isoformat())
            .lte("session_date", end_date.isoformat())
            .order("session_date", desc=True)
            .order("session_start_at")
            .execute()
        )
        return response.data or []

    def list_checkins_between(self, start_date: date, end_date: date) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("client_id, date, total_score, assigned_mode")
            .gte("date", start_date.isoformat())
            .lte("date", end_date.isoformat())
            .execute()
        )
        return response.data or []

    def list_completed_workouts_between(self, start_time: datetime, end_time: datetime) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("workouts")
            .select("id, user_id, completed, created_at")
            .eq("completed", True)
            .gte("created_at", start_time.isoformat())
            .lte("created_at", end_time.isoformat())
            .execute()
        )
        return response.data or []

    def get_talking_points_cache(self, trainer_id: str, client_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_talking_points")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def upsert_talking_points_cache(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase
            .table("trainer_talking_points")
            .upsert(payload, on_conflict="trainer_id,client_id")
            .execute()
        )
        return (response.data or [None])[0] or {}

    def list_coach_memory_for_trainer(self, trainer_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("coach_memory")
            .select("id, trainer_id, client_id, memory_type, memory_key, value_json, created_at, updated_at")
            .eq("trainer_id", trainer_id)
            .order("updated_at", desc=True)
            .execute()
        )
        return response.data or []

    def list_active_trainer_rules(self, trainer_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_rules")
            .select("id, category, rule_text")
            .eq("trainer_id", trainer_id)
            .eq("is_archived", False)
            .order("updated_at", desc=True)
            .execute()
        )
        return response.data or []
