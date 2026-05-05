from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_trainer_context, get_trainer_program_service
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.modules.trainer_programs.schemas import (
    TrainerProgramTemplate,
    TrainerProgramTemplateCreateRequest,
    TrainerProgramTemplateListResponse,
    TrainerProgramTemplatePatchRequest,
)
from app.modules.trainer_programs.service import TrainerProgramService


router = APIRouter()


def _rate_limit_trainer_programs(
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


def _handle_value_error(exc: ValueError) -> None:
    detail = str(exc)
    if detail.lower() == "program template not found":
        raise HTTPException(status_code=404, detail=detail) from exc
    raise HTTPException(status_code=400, detail=detail) from exc


@router.get("/templates", response_model=TrainerProgramTemplateListResponse)
async def list_trainer_program_templates(
    http_request: Request,
    include_archived: bool = Query(default=False),
    limit: int = Query(default=120, ge=1, le=250),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerProgramService = Depends(get_trainer_program_service),
):
    require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_programs(http_request, user, trainer_context, action="templates_list")
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
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerProgramService = Depends(get_trainer_program_service),
):
    require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_programs(http_request, user, trainer_context, action="template_create")
    try:
        return service.create_template(trainer_context, request)
    except ValueError as exc:
        _handle_value_error(exc)


@router.patch("/templates/{template_id}", response_model=TrainerProgramTemplate)
async def patch_trainer_program_template(
    template_id: str,
    request: TrainerProgramTemplatePatchRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerProgramService = Depends(get_trainer_program_service),
):
    require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_programs(http_request, user, trainer_context, action="template_patch")
    try:
        return service.update_template(trainer_context, template_id, request)
    except ValueError as exc:
        _handle_value_error(exc)


@router.post("/templates/{template_id}/archive", response_model=TrainerProgramTemplate)
async def archive_trainer_program_template(
    template_id: str,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerProgramService = Depends(get_trainer_program_service),
):
    require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_programs(http_request, user, trainer_context, action="template_archive")
    try:
        return service.archive_template(trainer_context, template_id)
    except ValueError as exc:
        _handle_value_error(exc)
