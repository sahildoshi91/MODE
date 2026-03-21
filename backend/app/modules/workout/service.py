from app.modules.workout.schemas import WorkoutRequest, WorkoutResponse, WorkoutData
from app.modules.workout.repository import WorkoutRepository
from app.ai.workout_generator import generate_workout_with_ai


class WorkoutService:
    def __init__(self, repository: WorkoutRepository):
        self.repository = repository

    def generate_workout(self, user_id: str, request: WorkoutRequest) -> WorkoutResponse:
        # Get user profile
        profile = self.repository.get_user_profile(user_id)
        if not profile:
            raise ValueError("Profile not found")

        # Generate workout via AI
        workout_data = generate_workout_with_ai(
            request.duration,
            request.workout_type,
            profile['fitness_level'],
            profile['equipment'],
            profile['goals'],
            profile['injuries'],
            user_id
        )

        # Save to DB
        plan = {
            "plan_data": workout_data
        }
        plan_id = self.repository.save_workout_plan(user_id, plan)

        # Save workout session
        workout_session = {
            "title": f"{request.workout_type} Workout",
            "duration": request.duration,
            "plan_type": request.workout_type,
            "plan_id": plan_id
        }
        self.repository.save_workout_session(user_id, workout_session)

        return WorkoutResponse(plan_id=plan_id, workout=WorkoutData(**workout_data))
