from app.modules.workout.schemas import WorkoutRequest, WorkoutResponse, WorkoutData
from app.modules.workout.repository import WorkoutRepository
from app.ai.workout_generator import generate_workout_with_ai


class WorkoutService:
    def __init__(self):
        self.repository = WorkoutRepository()

    def generate_workout(self, request: WorkoutRequest) -> WorkoutResponse:
        # Get user profile
        profile = self.repository.get_user_profile(request.user_id)
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
            request.user_id
        )

        # Save to DB
        plan = {
            "user_id": request.user_id,
            "plan_data": workout_data
        }
        plan_id = self.repository.save_workout_plan(plan)

        # Save workout session
        workout_session = {
            "user_id": request.user_id,
            "title": f"{request.workout_type} Workout",
            "duration": request.duration,
            "plan_type": request.workout_type,
            "plan_id": plan_id
        }
        self.repository.save_workout_session(workout_session)

        return WorkoutResponse(plan_id=plan_id, workout=WorkoutData(**workout_data))