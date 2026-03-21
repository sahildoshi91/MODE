from typing import Dict, Any, Optional
from supabase import Client


class WorkoutRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_user_profile(self, user_id: str) -> Optional[Dict[str, Any]]:
        response = (
            self.supabase
            .table('profiles')
            .select('id, fitness_level, equipment, goals, injuries, duration, workout_type')
            .eq('id', user_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def save_workout_plan(self, user_id: str, plan_data: Dict[str, Any]) -> str:
        result = (
            self.supabase
            .table('workout_plans')
            .insert({**plan_data, 'user_id': user_id})
            .execute()
        )
        return result.data[0]['id']

    def save_workout_session(self, user_id: str, session_data: Dict[str, Any]) -> None:
        self.supabase.table('workouts').insert({**session_data, 'user_id': user_id}).execute()
