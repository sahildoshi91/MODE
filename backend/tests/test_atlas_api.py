import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import (
    get_atlas_review_queue_service,
    get_trainer_ai_review_queue_service,
    get_trainer_context,
)
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.atlas.schemas import AtlasKnowledgeItem, AtlasReviewQueueItem, TrainerAiKnowledgeItem, TrainerAiReviewQueueItem


class FakeTrainerAiReviewQueueService:
    def __init__(self):
        self.seen_trainer_ids = []

    def list_queue(self, trainer_id, reviewer_status="pending", limit=100):
        self.seen_trainer_ids.append(trainer_id)
        return [
            TrainerAiReviewQueueItem(
                id="trainer-review-1",
                trainer_id=trainer_id,
                proposed_rule="This trainer prefers concise check-ins.",
                reason_detected="Atlas observed a trainer correction.",
                confidence_score=0.78,
                reviewer_status="pending",
            )
        ]

    def approve(self, trainer_id, queue_id):
        self.seen_trainer_ids.append(trainer_id)
        return TrainerAiKnowledgeItem(
            id="trainer-knowledge-1",
            trainer_id=trainer_id,
            knowledge_type="tone_pattern",
            learned_rule=f"Approved from {queue_id}",
            confidence_score=0.8,
            status="approved",
        )

    def update(self, trainer_id, queue_id, payload):
        self.seen_trainer_ids.append(trainer_id)
        return TrainerAiReviewQueueItem(
            id=queue_id,
            trainer_id=trainer_id,
            proposed_rule=payload.get("proposed_rule") or "Edited rule",
            reason_detected="Edited",
            reviewer_status="edited",
        )

    def reject(self, trainer_id, queue_id, reviewer_notes=None):
        self.seen_trainer_ids.append(trainer_id)
        return TrainerAiReviewQueueItem(
            id=queue_id,
            trainer_id=trainer_id,
            proposed_rule="Rejected rule",
            reason_detected=reviewer_notes or "Rejected",
            reviewer_status="rejected",
        )

    def delete_queue_item(self, trainer_id, queue_id):
        self.seen_trainer_ids.append(trainer_id)
        return {"deleted": True, "id": queue_id}

    def list_knowledge(self, trainer_id, status="approved", limit=100):
        self.seen_trainer_ids.append(trainer_id)
        return [
            TrainerAiKnowledgeItem(
                id="trainer-knowledge-1",
                trainer_id=trainer_id,
                knowledge_type="tone_pattern",
                learned_rule="This trainer prefers concise check-ins.",
                status="approved",
            )
        ]

    def retire_knowledge(self, trainer_id, knowledge_id):
        self.seen_trainer_ids.append(trainer_id)
        return TrainerAiKnowledgeItem(
            id=knowledge_id,
            trainer_id=trainer_id,
            knowledge_type="tone_pattern",
            learned_rule="Retired rule",
            status="retired",
        )


class FakeAtlasReviewQueueService:
    def list_queue(self, reviewer_status="pending", limit=100):
        return [
            AtlasReviewQueueItem(
                id="atlas-review-1",
                proposed_learning="When adherence drops, choose one small next action.",
                knowledge_type="adherence_strategy",
                privacy_risk_score=0.05,
                confidence_score=0.8,
                reviewer_status="pending",
            )
        ]

    def update_queue_item(self, queue_id, payload):
        return AtlasReviewQueueItem(
            id=queue_id,
            proposed_learning=payload.get("proposed_learning") or "Edited learning",
            knowledge_type="adherence_strategy",
            privacy_risk_score=0.05,
            confidence_score=0.8,
            reviewer_status="edited",
        )

    def approve_queue_item(self, queue_id, reviewer_notes=None):
        del reviewer_notes
        return AtlasKnowledgeItem(
            id="atlas-knowledge-1",
            knowledge_type="adherence_strategy",
            situation_tags=["missed_workouts"],
            client_context_tags=[],
            generalized_learning=f"Approved from {queue_id}",
            confidence_score=0.8,
            privacy_risk_score=0.05,
            status="approved",
        )

    def reject_queue_item(self, queue_id, reviewer_notes=None):
        del reviewer_notes
        return AtlasReviewQueueItem(
            id=queue_id,
            proposed_learning="Rejected learning",
            knowledge_type="adherence_strategy",
            privacy_risk_score=0.05,
            confidence_score=0.8,
            reviewer_status="rejected",
        )

    def list_knowledge(self, status="approved", limit=100):
        return [
            AtlasKnowledgeItem(
                id="atlas-knowledge-1",
                knowledge_type="adherence_strategy",
                situation_tags=[],
                client_context_tags=[],
                generalized_learning="Approved generalized learning.",
                confidence_score=0.8,
                privacy_risk_score=0.05,
                status="approved",
            )
        ]


class AtlasApiTests(unittest.TestCase):
    def setUp(self):
        self.trainer_service = FakeTrainerAiReviewQueueService()
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
        app.dependency_overrides[get_trainer_ai_review_queue_service] = lambda: self.trainer_service
        app.dependency_overrides[get_atlas_review_queue_service] = lambda: FakeAtlasReviewQueueService()
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_trainer_ai_review_queue_is_trainer_scoped(self):
        response = self.client.get(
            "/api/v1/atlas/trainer-ai/review-queue",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["trainer_id"], "trainer-1")
        self.assertEqual(self.trainer_service.seen_trainer_ids, ["trainer-1"])

    def test_trainer_can_approve_trainer_ai_learning(self):
        response = self.client.post(
            "/api/v1/atlas/trainer-ai/review-queue/trainer-review-1/approve",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "approved")
        self.assertEqual(payload["trainer_id"], "trainer-1")

    def test_admin_me_denies_empty_allowlist(self):
        with patch("app.api.v1.atlas.settings.atlas_admin_email_allowlist", ""):
            response = self.client.get(
                "/api/v1/atlas/admin/me",
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["allowed"])

    def test_admin_queue_requires_allowlisted_email(self):
        with patch("app.api.v1.atlas.settings.atlas_admin_email_allowlist", ""):
            denied = self.client.get(
                "/api/v1/atlas/admin/review-queue",
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(denied.status_code, 403)

        with patch("app.api.v1.atlas.settings.atlas_admin_email_allowlist", "trainer@example.com"):
            allowed = self.client.get(
                "/api/v1/atlas/admin/review-queue",
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.json()[0]["id"], "atlas-review-1")

    def test_admin_approval_returns_approved_atlas_knowledge_without_identity(self):
        with patch("app.api.v1.atlas.settings.atlas_admin_email_allowlist", "trainer@example.com"):
            response = self.client.post(
                "/api/v1/atlas/admin/review-queue/atlas-review-1/approve",
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "approved")
        self.assertNotIn("trainer_id", payload)
        self.assertNotIn("client_id", payload)


if __name__ == "__main__":
    unittest.main()
