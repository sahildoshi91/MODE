from fastapi import APIRouter, Depends, Request

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_context, get_trainer_persona_service
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.modules.trainer_persona.schemas import TrainerPersona
from app.modules.trainer_persona.service import TrainerPersonaService


router = APIRouter()


def _rate_limit_trainer_personas(
    http_request: Request,
    user: AuthenticatedUser,
    trainer_context: TrainerContext,
    *,
    action: str,
) -> None:
    enforce_rate_limit(
        group="trainer_admin",
        user=user,
        request=http_request,
        context={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "action": action,
        },
    )


@router.get("", response_model=list[TrainerPersona])
async def list_personas(
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerPersonaService = Depends(get_trainer_persona_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_personas(http_request, user, trainer_context, action="personas_list")
    return service.list_personas(trainer_id)


@router.post("", response_model=TrainerPersona)
async def create_persona(
    request: TrainerPersona,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerPersonaService = Depends(get_trainer_persona_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_personas(http_request, user, trainer_context, action="persona_create")
    return service.create_persona(trainer_id, request)
