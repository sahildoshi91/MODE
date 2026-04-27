import logging

from app.modules.ai_feedback.service import AIFeedbackService
from app.modules.trainer_review.repository import TrainerReviewRepository
from app.modules.trainer_review.schemas import ReviewApprovalRequest, ReviewQueueItem


logger = logging.getLogger(__name__)


class TrainerReviewService:
    def __init__(
        self,
        repository: TrainerReviewRepository,
        ai_feedback_logger_service: AIFeedbackService | None = None,
        atlas_observer_service=None,
    ):
        self.repository = repository
        self.ai_feedback_logger_service = ai_feedback_logger_service
        self.atlas_observer_service = atlas_observer_service

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
        self._mirror_queue_item_into_output_ledger(created)
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
        self._notify_atlas_review_resolved(
            trainer_id=trainer_id,
            queue_id=queue_id,
            approved_answer=request.approved_answer,
            response_tags=request.response_tags,
        )
        return approval

    def _mirror_queue_item_into_output_ledger(self, queue_row: dict) -> None:
        if not self.ai_feedback_logger_service:
            return

        trainer_id = str(queue_row.get("trainer_id") or "").strip()
        if not trainer_id:
            return
        try:
            self.ai_feedback_logger_service.log_generated_output(
                tenant_id=str(queue_row.get("tenant_id") or ""),
                trainer_id=trainer_id,
                client_id=str(queue_row.get("client_id") or "") or None,
                source_type="chat",
                source_ref_id=str(queue_row.get("message_id") or queue_row.get("id") or "").strip() or None,
                conversation_id=str(queue_row.get("conversation_id") or "") or None,
                message_id=str(queue_row.get("message_id") or "") or None,
                output_text=queue_row.get("model_draft_answer"),
                output_json={
                    "legacy_queue_id": queue_row.get("id"),
                    "user_question": queue_row.get("user_question"),
                },
                generation_metadata={
                    "legacy_queue_mirrored": True,
                    "confidence_score": queue_row.get("confidence_score"),
                },
            )
        except Exception:
            logger.exception("Failed to mirror legacy trainer review queue row into ai_generated_outputs")

    def _notify_atlas_review_resolved(
        self,
        *,
        trainer_id: str,
        queue_id: str,
        approved_answer: str,
        response_tags: list[str],
    ) -> None:
        if not self.atlas_observer_service:
            return
        try:
            self.atlas_observer_service.observe_resolved_review_item(
                trainer_id=trainer_id,
                approved_answer=approved_answer,
                queue_id=queue_id,
                response_tags=response_tags,
            )
        except Exception:
            logger.exception("Atlas observation failed for resolved review item queue_id=%s", queue_id)
