from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_context, get_trainer_program_service
from app.core.tenancy import TrainerContext
from app.modules.trainer_programs.schemas import (
    TrainerProgramTemplate,
    TrainerProgramTemplateCreateRequest,
    TrainerProgramTemplateListResponse,
    TrainerProgramTemplatePatchRequest,
)
from app.modules.trainer_programs.service import TrainerProgramService


router = APIRouter()


def _handle_value_error(exc: ValueError) -> None:
    detail = str(exc)
    if detail.lower() == "program template not found":
        raise HTTPException(status_code=404, detail=detail) from exc
    raise HTTPException(status_code=400, detail=detail) from exc


@router.get("/templates", response_model=TrainerProgramTemplateListResponse)
async def list_trainer_program_templates(
    include_archived: bool = Query(default=False),
    limit: int = Query(default=120, ge=1, le=250),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerProgramService = Depends(get_trainer_program_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.list_templates(
            trainer_context,
            include_archived=include_archived,
            limit=limit,
        )
    except ValueError as exc:
        _handle_value_error(exc)


@router.post("/templates", response_model=TrainerProgramTemplate)
async def create_trainer_program_template(
    request: TrainerProgramTemplateCreateRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerProgramService = Depends(get_trainer_program_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.create_template(trainer_context, request)
    except ValueError as exc:
        _handle_value_error(exc)


@router.patch("/templates/{template_id}", response_model=TrainerProgramTemplate)
async def patch_trainer_program_template(
    template_id: str,
    request: TrainerProgramTemplatePatchRequest,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerProgramService = Depends(get_trainer_program_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.update_template(trainer_context, template_id, request)
    except ValueError as exc:
        _handle_value_error(exc)


@router.post("/templates/{template_id}/archive", response_model=TrainerProgramTemplate)
async def archive_trainer_program_template(
    template_id: str,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerProgramService = Depends(get_trainer_program_service),
):
    require_trainer_actor(user, trainer_context)
    try:
        return service.archive_template(trainer_context, template_id)
    except ValueError as exc:
        _handle_value_error(exc)
