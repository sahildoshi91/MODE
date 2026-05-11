from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.v1.trainer_auth import require_trainer_actor
from app.core.auth import AuthenticatedUser, CurrentUser
from app.core.dependencies import (
    get_ai_feedback_service,
    get_trainer_context,
    get_trainer_review_service,
)
from app.core.rate_limit import enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.modules.ai_feedback.schemas import (
    AIOutputApproveRequest,
    AIOutputDetailResponse,
    AIOutputEditRequest,
    AIOutputListResponse,
    AIOutputMutationResponse,
    AIOutputRejectRequest,
)
from app.modules.ai_feedback.service import AIFeedbackService
from app.modules.trainer_review.schemas import ReviewApprovalRequest, ReviewQueueItem
from app.modules.trainer_review.service import TrainerReviewService


router = APIRouter()


def _rate_limit_trainer_review(
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


@router.get("/queue", response_model=list[ReviewQueueItem])
async def get_review_queue(
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerReviewService = Depends(get_trainer_review_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_review(http_request, user, trainer_context, action="queue_list")
    return service.list_open_queue(trainer_id)


@router.post("/queue/{queue_id}/approve")
async def approve_queue_item(
    queue_id: str,
    request: ReviewApprovalRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerReviewService = Depends(get_trainer_review_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_review(http_request, user, trainer_context, action="queue_approve")
    return service.approve_answer(queue_id, trainer_id, request)


@router.get("/outputs", response_model=AIOutputListResponse)
async def get_review_outputs(
    http_request: Request,
    status: str | None = Query(default="open"),
    source_type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: AIFeedbackService = Depends(get_ai_feedback_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_review(http_request, user, trainer_context, action="outputs_list")
    normalized_status = status.strip().lower() if isinstance(status, str) and status.strip() else None
    if normalized_status and normalized_status not in {"open", "approved", "rejected"}:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    normalized_source_type = source_type.strip().lower() if isinstance(source_type, str) and source_type.strip() else None
    if normalized_source_type and normalized_source_type not in {
        "chat",
        "talking_points",
        "generated_checkin_plan",
        "trainer_assistant_draft",
    }:
        raise HTTPException(status_code=400, detail="Invalid source_type filter")
    return service.list_outputs(
        trainer_id,
        status=normalized_status,
        source_type=normalized_source_type,
        limit=limit,
        offset=offset,
    )


@router.get("/outputs/{output_id}", response_model=AIOutputDetailResponse)
async def get_review_output_detail(
    output_id: str,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: AIFeedbackService = Depends(get_ai_feedback_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_review(http_request, user, trainer_context, action="output_detail")
    try:
        return service.get_output_detail(trainer_id, output_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Not found") from exc


@router.post("/outputs/{output_id}/edit", response_model=AIOutputMutationResponse)
async def edit_review_output(
    output_id: str,
    request: AIOutputEditRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: AIFeedbackService = Depends(get_ai_feedback_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_review(http_request, user, trainer_context, action="output_edit")
    try:
        return service.edit_output(trainer_id, output_id, request)
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail="Not found") from exc
        raise HTTPException(status_code=400, detail="Invalid review output edit request") from exc


@router.post("/outputs/{output_id}/approve", response_model=AIOutputMutationResponse)
async def approve_review_output(
    output_id: str,
    request: AIOutputApproveRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: AIFeedbackService = Depends(get_ai_feedback_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_review(http_request, user, trainer_context, action="output_approve")
    try:
        return service.approve_output(trainer_id, output_id, request)
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail="Not found") from exc
        raise HTTPException(status_code=400, detail="Invalid review output approve request") from exc


@router.post("/outputs/{output_id}/reject", response_model=AIOutputMutationResponse)
async def reject_review_output(
    output_id: str,
    request: AIOutputRejectRequest,
    http_request: Request,
    user: AuthenticatedUser = CurrentUser,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: AIFeedbackService = Depends(get_ai_feedback_service),
):
    trainer_id = require_trainer_actor(user, trainer_context)
    _rate_limit_trainer_review(http_request, user, trainer_context, action="output_reject")
    try:
        return service.reject_output(trainer_id, output_id, request)
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail="Not found") from exc
        raise HTTPException(status_code=400, detail="Invalid review output reject request") from exc
