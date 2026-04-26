from fastapi import APIRouter, Depends, HTTPException

from app.core.dependencies import (
    get_profile_service,
    get_trainer_client_service,
    get_trainer_context,
)
from app.core.tenancy import TrainerContext
from app.modules.profile.schemas import FitnessProfile, ProfilePatchRequest
from app.modules.profile.service import ProfileService
from app.modules.trainer_clients.schemas import ClientTrainerScheduleResponse
from app.modules.trainer_clients.service import TrainerClientService


router = APIRouter()


@router.get("/me", response_model=FitnessProfile)
async def get_my_profile(
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ProfileService = Depends(get_profile_service),
):
    if not trainer_context.client_id:
        raise HTTPException(status_code=400, detail="No client assignment found")
    return service.get_profile_model(trainer_context.client_id)


@router.patch("/me", response_model=FitnessProfile)
async def patch_my_profile(
    request: ProfilePatchRequest,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ProfileService = Depends(get_profile_service),
):
    if not trainer_context.client_id:
        raise HTTPException(status_code=400, detail="No client assignment found")
    return service.upsert_profile_patch(trainer_context.client_id, request.fields)


@router.get("/me/trainer-schedule", response_model=ClientTrainerScheduleResponse)
async def get_my_trainer_schedule(
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    try:
        return service.get_client_visible_schedule(trainer_context)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid trainer schedule request") from exc
