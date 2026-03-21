from fastapi import Depends
from supabase import Client

from app.core.auth import AuthenticatedUser, require_user
from app.db.client import get_supabase_user_client
from app.modules.workout.repository import WorkoutRepository
from app.modules.workout.service import WorkoutService


def get_request_scoped_supabase_client(
    user: AuthenticatedUser = Depends(require_user),
) -> Client:
    if not user.access_token:
        raise ValueError("Authenticated user is missing access token")
    return get_supabase_user_client(user.access_token)


def get_workout_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> WorkoutRepository:
    return WorkoutRepository(supabase)


def get_workout_service(
    repository: WorkoutRepository = Depends(get_workout_repository),
) -> WorkoutService:
    return WorkoutService(repository)
