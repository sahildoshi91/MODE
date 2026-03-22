from fastapi import APIRouter, Depends, HTTPException

from app.core.dependencies import get_trainer_context, get_trainer_review_service
from app.core.tenancy import TrainerContext
from app.modules.trainer_review.schemas import ReviewApprovalRequest, ReviewQueueItem
from app.modules.trainer_review.service import TrainerReviewService


router = APIRouter()


@router.get("/queue", response_model=list[ReviewQueueItem])
async def get_review_queue(
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerReviewService = Depends(get_trainer_review_service),
):
    if not trainer_context.trainer_id:
        raise HTTPException(status_code=400, detail="No trainer context found")
    return service.list_open_queue(trainer_context.trainer_id)


@router.post("/queue/{queue_id}/approve")
async def approve_queue_item(
    queue_id: str,
    request: ReviewApprovalRequest,
    trainer_context: TrainerContext = Depends(get_trainer_context),
    service: TrainerReviewService = Depends(get_trainer_review_service),
):
    if not trainer_context.trainer_id:
        raise HTTPException(status_code=400, detail="No trainer context found")
    return service.approve_answer(queue_id, trainer_context.trainer_id, request)
