from app.modules.trainer_review.repository import TrainerReviewRepository
from app.modules.trainer_review.schemas import ReviewApprovalRequest, ReviewQueueItem


class TrainerReviewService:
    def __init__(self, repository: TrainerReviewRepository):
        self.repository = repository

    def queue_unanswered_question(
        self,
        trainer_id: str,
        client_id: str | None,
        conversation_id: str | None,
        message_id: str | None,
        user_question: str,
        model_draft_answer: str | None,
        confidence_score: float | None,
    ) -> ReviewQueueItem:
        created = self.repository.queue_item(
            {
                "trainer_id": trainer_id,
                "client_id": client_id,
                "conversation_id": conversation_id,
                "message_id": message_id,
                "user_question": user_question,
                "model_draft_answer": model_draft_answer,
                "confidence_score": confidence_score,
            }
        )
        return ReviewQueueItem(**created)

    def list_open_queue(self, trainer_id: str) -> list[ReviewQueueItem]:
        return [ReviewQueueItem(**row) for row in self.repository.list_open(trainer_id)]

    def approve_answer(self, queue_id: str, trainer_id: str, request: ReviewApprovalRequest) -> dict:
        approval = self.repository.create_approval(
            {
                "queue_id": queue_id,
                "trainer_id": trainer_id,
                "approved_answer": request.approved_answer,
                "response_tags": request.response_tags,
            }
        )
        self.repository.mark_resolved(queue_id)
        return approval
