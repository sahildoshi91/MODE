from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.trainer_auth import require_client_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import get_plan_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.modules.plan.schemas import PlanSummary
from app.modules.plan.service import PlanService


router = APIRouter()


@router.get("/active", response_model=PlanSummary)
async def get_active_plan(
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: PlanService = Depends(get_plan_service),
):
    require_client_actor(user, trainer_context)
    try:
        return service.build_plan_summary(trainer_context.trainer_id, trainer_context.client_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid plan request") from exc


@router.post("/generate", response_model=PlanSummary)
async def generate_plan(
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: PlanService = Depends(get_plan_service),
):
    require_client_actor(user, trainer_context)
    try:
        return service.build_plan_summary(trainer_context.trainer_id, trainer_context.client_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid plan request") from exc
