from fastapi import APIRouter, Depends

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_context, get_trainer_persona_service
from app.core.tenancy import TrainerContext
from app.modules.trainer_persona.schemas import TrainerPersona
from app.modules.trainer_persona.service import TrainerPersonaService


router = APIRouter()


@router.get("", response_model=list[TrainerPersona])
async def list_personas(
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerPersonaService = Depends(get_trainer_persona_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    return service.list_personas(trainer_id)


@router.post("", response_model=TrainerPersona)
async def create_persona(
    request: TrainerPersona,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerPersonaService = Depends(get_trainer_persona_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    return service.create_persona(trainer_id, request)
