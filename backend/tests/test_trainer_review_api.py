import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import (
    get_ai_feedback_service,
    get_trainer_context,
    get_trainer_review_service,
)
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.ai_feedback.schemas import (
    AIFeedbackEvent,
    AIGeneratedOutput,
    AIOutputDetailResponse,
    AIOutputListResponse,
    AIOutputMutationResponse,
)
from app.modules.trainer_review.schemas import ReviewQueueItem


class FakeTrainerReviewService:
    def list_open_queue(self, trainer_id):
        return [
            ReviewQueueItem(
                id="queue-1",
                trainer_id=trainer_id,
                client_id="client-1",
                conversation_id="conversation-1",
                message_id="message-1",
                user_question="How do I stay consistent?",
                model_draft_answer="Start with smaller daily actions.",
                confidence_score=0.42,
                status="open",
            )
        ]

    def approve_answer(self, queue_id, trainer_id, request):
        return {
            "id": "approval-1",
            "queue_id": queue_id,
            "trainer_id": trainer_id,
            "approved_answer": request.approved_answer,
            "response_tags": request.response_tags,
        }


class FakeAIFeedbackService:
    def list_outputs(self, trainer_id, status=None, source_type=None, limit=50, offset=0):
        del status, source_type, limit, offset
        return AIOutputListResponse(
            items=[
                AIGeneratedOutput(
                    id="output-1",
                    tenant_id="tenant-1",
                    trainer_id=trainer_id,
                    client_id="client-1",
                    source_type="chat",
                    source_ref_id="message-1",
                    output_text="Keep your sessions short and frequent.",
                )
            ],
            count=1,
        )

    def get_output_detail(self, trainer_id, output_id):
        return AIOutputDetailResponse(
            output=AIGeneratedOutput(
                id=output_id,
                tenant_id="tenant-1",
                trainer_id=trainer_id,
                client_id="client-1",
                source_type="chat",
                source_ref_id="message-1",
                output_text="Keep your sessions short and frequent.",
            ),
            feedback_events=[
                AIFeedbackEvent(
                    id="event-1",
                    tenant_id="tenant-1",
                    trainer_id=trainer_id,
                    client_id="client-1",
                    output_id=output_id,
                    event_type="approved",
                    apply_status="applied",
                )
            ],
        )

    def edit_output(self, trainer_id, output_id, request):
        del request
        return self._build_mutation_response(trainer_id, output_id, "edited")

    def approve_output(self, trainer_id, output_id, request):
        del request
        return self._build_mutation_response(trainer_id, output_id, "approved")

    def reject_output(self, trainer_id, output_id, request):
        del request
        return self._build_mutation_response(trainer_id, output_id, "rejected")

    def _build_mutation_response(self, trainer_id, output_id, event_type):
        return AIOutputMutationResponse(
            output=AIGeneratedOutput(
                id=output_id,
                tenant_id="tenant-1",
                trainer_id=trainer_id,
                client_id="client-1",
                source_type="chat",
                source_ref_id="message-1",
                output_text="Keep your sessions short and frequent.",
                review_status=event_type if event_type in {"approved", "rejected"} else "open",
            ),
            feedback_event=AIFeedbackEvent(
                id=f"event-{event_type}",
                tenant_id="tenant-1",
                trainer_id=trainer_id,
                client_id="client-1",
                output_id=output_id,
                event_type=event_type,
                apply_status="applied" if event_type != "rejected" else "not_applicable",
            ),
            auto_applied_count=1 if event_type != "rejected" else 0,
        )


class TrainerReviewApiTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="trainer-user-1",
            email="trainer@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id=None,
        )
        app.dependency_overrides[get_trainer_review_service] = lambda: FakeTrainerReviewService()
        app.dependency_overrides[get_ai_feedback_service] = lambda: FakeAIFeedbackService()
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_get_queue_still_supported(self):
        response = self.client.get(
            "/api/v1/trainer-review/queue",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["id"], "queue-1")

    def test_get_outputs_returns_additive_review_surface(self):
        response = self.client.get(
            "/api/v1/trainer-review/outputs?status=open&source_type=chat",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["items"][0]["source_type"], "chat")

    def test_approve_output_endpoint(self):
        response = self.client.post(
            "/api/v1/trainer-review/outputs/output-1/approve",
            json={"edited_output_text": "Approved response", "auto_apply_deltas": True},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["output"]["review_status"], "approved")
        self.assertEqual(payload["feedback_event"]["event_type"], "approved")


if __name__ == "__main__":
    unittest.main()
