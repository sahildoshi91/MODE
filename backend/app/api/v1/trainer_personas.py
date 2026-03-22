from fastapi import APIRouter, Depends, HTTPException

from app.core.dependencies import get_trainer_context, get_trainer_persona_service
from app.core.tenancy import TrainerContext
from app.modules.trainer_persona.schemas import TrainerPersona
from app.modules.trainer_persona.service import TrainerPersonaService


router = APIRouter()


@router.get("", response_model=list[TrainerPersona])
async def list_personas(
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerPersonaService = Depends(get_trainer_persona_service),
):
    if not trainer_context.trainer_id:
        raise HTTPException(status_code=400, detail="No trainer context found")
    return service.list_personas(trainer_context.trainer_id)


@router.post("", response_model=TrainerPersona)
async def create_persona(
    request: TrainerPersona,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerPersonaService = Depends(get_trainer_persona_service),
):
    if not trainer_context.trainer_id:
        raise HTTPException(status_code=400, detail="No trainer context found")
    return service.create_persona(trainer_context.trainer_id, request)
