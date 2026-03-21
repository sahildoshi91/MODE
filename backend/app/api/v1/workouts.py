from fastapi import APIRouter, HTTPException
from app.modules.workout.schemas import WorkoutRequest, WorkoutResponse
from app.modules.workout.service import WorkoutService

router = APIRouter()
service = WorkoutService()


@router.post("/generate", response_model=WorkoutResponse)
async def generate_workout(request: WorkoutRequest):
    try:
        return service.generate_workout(request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")