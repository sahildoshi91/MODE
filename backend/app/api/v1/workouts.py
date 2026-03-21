from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_workout_service
from app.modules.workout.schemas import WorkoutRequest, WorkoutResponse
from app.modules.workout.service import WorkoutService

router = APIRouter()


@router.post("/generate", response_model=WorkoutResponse)
async def generate_workout(
    request: WorkoutRequest,
    user: AuthenticatedUser = CurrentUser,
    service: WorkoutService = Depends(get_workout_service),
):
    try:
        return service.generate_workout(user.id, request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")
