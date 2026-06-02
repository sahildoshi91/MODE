from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.authorization import authorize_actor_access
from app.core.dependencies import get_progress_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.modules.progress.schemas import ProgressMetricsResponse
from app.modules.progress.service import ProgressService

router = APIRouter()


def _resolve_client_id(trainer_context: TrainerContext) -> str:
    if not trainer_context.client_id:
        raise HTTPException(status_code=400, detail="No client assignment found")
    return trainer_context.client_id


def _validate_client_read_access(user: AuthenticatedUser, trainer_context: TrainerContext) -> None:
    if not trainer_context.client_id:
        raise HTTPException(status_code=400, detail="No client assignment found")
    if not trainer_context.client_user_id:
        raise HTTPException(status_code=400, detail="Client account is missing an owning user")
    authorize_actor_access(
        actor=user,
        trainer_id=trainer_context.trainer_id,
        client_id=trainer_context.client_id,
        resource_owner={
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": trainer_context.client_id,
            "client_user_id": trainer_context.client_user_id,
        },
        require_client_owner=True,
        expected_tenant_id=trainer_context.tenant_id,
    )


@router.get("/metrics", response_model=ProgressMetricsResponse)
async def get_progress_metrics(
    period_days: int = Query(default=7, ge=7, le=30),
    as_of_date: date | None = None,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: ProgressService = Depends(get_progress_service),
):
    _validate_client_read_access(user, trainer_context)
    client_id = _resolve_client_id(trainer_context)
    target_date = as_of_date or datetime.now(timezone.utc).date()
    return service.get_metrics(client_id, target_date, period_days)
