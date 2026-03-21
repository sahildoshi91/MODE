from typing import Dict, Any, Optional
from app.db.client import get_supabase_client


class WorkoutRepository:
    def __init__(self):
        self.supabase = get_supabase_client()

    def get_user_profile(self, user_id: str) -> Optional[Dict[str, Any]]:
        response = self.supabase.table('profiles').select('*').eq('id', user_id).execute()
        return response.data[0] if response.data else None

    def save_workout_plan(self, plan_data: Dict[str, Any]) -> str:
        result = self.supabase.table('workout_plans').insert(plan_data).execute()
        return result.data[0]['id']

    def save_workout_session(self, session_data: Dict[str, Any]) -> None:
        self.supabase.table('workouts').insert(session_data).execute()