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
            .select("id, user_id, client_name, assigned_trainer_id")
            .eq("assigned_trainer_id", trainer_id)
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
