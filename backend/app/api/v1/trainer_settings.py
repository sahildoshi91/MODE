from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_context, get_trainer_settings_service
from app.core.tenancy import TrainerContext
from app.modules.trainer_settings.schemas import TrainerSettingsPatchRequest, TrainerSettingsResponse
from app.modules.trainer_settings.service import TrainerSettingsService


router = APIRouter()


def _handle_service_error(exc: ValueError) -> None:
    detail = str(exc)
    if detail.lower() == "trainer not found":
        raise HTTPException(status_code=404, detail=detail) from exc
    raise HTTPException(status_code=400, detail=detail) from exc


@router.get("/me", response_model=TrainerSettingsResponse)
async def get_my_trainer_settings(
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerSettingsService = Depends(get_trainer_settings_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.get_settings(trainer_context)
    except ValueError as exc:
        _handle_service_error(exc)


@router.patch("/me", response_model=TrainerSettingsResponse)
async def patch_my_trainer_settings(
    request: TrainerSettingsPatchRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerSettingsService = Depends(get_trainer_settings_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.patch_settings(trainer_context, request)
    except ValueError as exc:
        _handle_service_error(exc)

