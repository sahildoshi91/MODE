from fastapi import APIRouter, Depends, HTTPException, Request
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_workout_service
from app.core.rate_limit import enforce_rate_limit
from app.modules.workout.schemas import WorkoutRequest, WorkoutResponse
from app.modules.workout.service import WorkoutService

router = APIRouter()


@router.post("/generate", response_model=WorkoutResponse)
async def generate_workout(
    request: WorkoutRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    service: WorkoutService = Depends(get_workout_service),
):
    enforce_rate_limit(group="chat", user=user, request=http_request)
    try:
        return service.generate_workout(user.id, request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid workout request") from e
    except Exception as e:
        raise HTTPException(status_code=500, detail="Workout generation failed") from e
