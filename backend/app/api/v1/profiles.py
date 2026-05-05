from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.trainer_auth import require_client_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import (
    get_profile_service,
    get_trainer_client_service,
    get_trainer_context,
)
from app.core.tenancy import TrainerContext
from app.modules.profile.schemas import (
    AlgorithmHomeResponse,
    AlgorithmMemoryCreateRequest,
    AlgorithmMemoryUpdateRequest,
    FitnessProfile,
    ProfilePatchRequest,
    ProfileWhyPatchRequest,
)
from app.modules.profile.service import (
    ProfilePersistenceVerificationError,
    ProfileService,
    ProfileStorageUnavailableError,
)
from app.modules.trainer_clients.schemas import ClientTrainerScheduleResponse
from app.modules.trainer_clients.service import TrainerClientService


router = APIRouter()


def _handle_profile_value_error(exc: ValueError) -> None:
    detail = str(exc)
    if detail.lower() in {"memory not found"}:
        raise HTTPException(status_code=404, detail=detail) from exc
    raise HTTPException(status_code=400, detail=detail) from exc


def _handle_profile_storage_error(exc: RuntimeError) -> None:
    raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/me", response_model=FitnessProfile)
async def get_my_profile(
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ProfileService = Depends(get_profile_service),
):
    require_client_actor(user, trainer_context)
    return service.get_profile_model(trainer_context.client_id)


@router.patch("/me", response_model=FitnessProfile)
async def patch_my_profile(
    request: ProfilePatchRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ProfileService = Depends(get_profile_service),
):
    require_client_actor(user, trainer_context)
    return service.upsert_profile_patch(trainer_context.client_id, request.fields)


@router.get("/me/algorithm", response_model=AlgorithmHomeResponse)
async def get_my_algorithm(
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ProfileService = Depends(get_profile_service),
):
    require_client_actor(user, trainer_context)
    return service.get_algorithm_home(trainer_context.client_id, trainer_context.trainer_id)


@router.patch("/me/why", response_model=AlgorithmHomeResponse)
async def patch_my_why(
    request: ProfileWhyPatchRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ProfileService = Depends(get_profile_service),
):
    require_client_actor(user, trainer_context)
    try:
        return service.update_user_why(
            client_id=trainer_context.client_id,
            trainer_id=trainer_context.trainer_id,
            user_why=request.user_why,
        )
    except ProfileStorageUnavailableError as exc:
        _handle_profile_storage_error(exc)
    except ProfilePersistenceVerificationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/me/memories", response_model=AlgorithmHomeResponse)
async def create_my_memory(
    request: AlgorithmMemoryCreateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ProfileService = Depends(get_profile_service),
):
    require_client_actor(user, trainer_context)
    try:
        return service.create_algorithm_memory(
            client_id=trainer_context.client_id,
            trainer_id=trainer_context.trainer_id,
            request=request,
        )
    except ProfilePersistenceVerificationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ValueError as exc:
        _handle_profile_value_error(exc)


@router.patch("/me/memories/{memory_id}", response_model=AlgorithmHomeResponse)
async def patch_my_memory(
    memory_id: str,
    request: AlgorithmMemoryUpdateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ProfileService = Depends(get_profile_service),
):
    require_client_actor(user, trainer_context)
    try:
        return service.update_algorithm_memory(
            client_id=trainer_context.client_id,
            trainer_id=trainer_context.trainer_id,
            memory_id=memory_id,
            request=request,
        )
    except ValueError as exc:
        _handle_profile_value_error(exc)


@router.delete("/me/memories/{memory_id}", response_model=AlgorithmHomeResponse)
async def delete_my_memory(
    memory_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ProfileService = Depends(get_profile_service),
):
    require_client_actor(user, trainer_context)
    try:
        return service.delete_algorithm_memory(
            client_id=trainer_context.client_id,
            trainer_id=trainer_context.trainer_id,
            memory_id=memory_id,
        )
    except ProfilePersistenceVerificationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ValueError as exc:
        _handle_profile_value_error(exc)


@router.get("/me/trainer-schedule", response_model=ClientTrainerScheduleResponse)
async def get_my_trainer_schedule(
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerClientService = Depends(get_trainer_client_service),
):
    require_client_actor(user, trainer_context)
    try:
        return service.get_client_visible_schedule(trainer_context)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid trainer schedule request") from exc
