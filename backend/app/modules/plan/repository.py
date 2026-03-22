from typing import Any

from supabase import Client


class PlanRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def find_templates(self, trainer_id: str, frequency: int | None, goal_type: str | None) -> list[dict[str, Any]]:
        query = (
            self.supabase
            .table("trainer_program_templates")
            .select("id, name, frequency, goal_type, experience_level, equipment_access, template_json")
            .eq("trainer_id", trainer_id)
        )
        if frequency is not None:
            query = query.eq("frequency", frequency)
        if goal_type:
            query = query.eq("goal_type", goal_type)
        response = query.limit(5).execute()
        return response.data or []
