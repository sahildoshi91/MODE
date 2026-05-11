import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.modules.atlas.service import (
    AtlasObserverService,
    AtlasPiiSanitizer,
    AtlasReviewQueueService,
    AtlasTrainerDeletionObserver,
)


class FakeAtlasRepository:
    def __init__(self):
        self.trainer_ai_learning_events = []
        self.trainer_ai_review_queue = []
        self.trainer_ai_knowledge = []
        self.atlas_learning_events = []
        self.atlas_review_queue = []
        self.atlas_knowledge = []
        self.audit_logs = []
        self.next_id = 1

    def _id(self, prefix):
        value = f"{prefix}-{self.next_id}"
        self.next_id += 1
        return value

    def get_trainer_identity(self, trainer_id):
        return {"id": trainer_id, "user_id": "trainer-user-1", "display_name": "Coach Maya"} if trainer_id else None

    def get_client_identity(self, client_id):
        return {"id": client_id, "user_id": "client-user-1", "client_name": "Sarah"} if client_id else None

    def insert_audit_log(self, payload):
        row = {"id": self._id("audit"), **payload}
        self.audit_logs.append(row)
        return row

    def insert_trainer_ai_learning_event(self, payload):
        row = {"id": self._id("trainer-event"), **payload}
        self.trainer_ai_learning_events.append(row)
        return row

    def insert_trainer_ai_review_queue(self, payload):
        row = {"id": self._id("trainer-review"), **payload}
        self.trainer_ai_review_queue.append(row)
        return row

    def insert_trainer_ai_knowledge(self, payload):
        row = {"id": self._id("trainer-knowledge"), **payload}
        self.trainer_ai_knowledge.append(row)
        return row

    def insert_atlas_review_queue(self, payload):
        row = {"id": self._id("atlas-review"), **payload}
        self.atlas_review_queue.append(row)
        return row

    def insert_atlas_learning_event(self, payload):
        row = {"id": self._id("atlas-event"), **payload}
        self.atlas_learning_events.append(row)
        return row

    def get_atlas_review_queue_item(self, queue_id):
        return next((row for row in self.atlas_review_queue if row["id"] == queue_id), None)

    def update_atlas_review_queue(self, queue_id, payload):
        row = self.get_atlas_review_queue_item(queue_id)
        if not row:
            return {}
        row.update(payload)
        return row

    def insert_atlas_knowledge(self, payload):
        row = {"id": self._id("atlas-knowledge"), **payload}
        self.atlas_knowledge.append(row)
        return row

    def list_atlas_review_queue(self, reviewer_status="pending", limit=100):
        rows = self.atlas_review_queue
        if reviewer_status:
            rows = [row for row in rows if row.get("reviewer_status") == reviewer_status]
        return rows[:limit]

    def list_atlas_knowledge(self, status="approved", limit=100):
        rows = self.atlas_knowledge
        if status:
            rows = [row for row in rows if row.get("status") == status]
        return rows[:limit]

    def list_trainer_ai_knowledge_for_trainers(self, trainer_ids, limit=200):
        return [
            row for row in self.trainer_ai_knowledge
            if row.get("trainer_id") in trainer_ids and row.get("status") == "approved"
        ][:limit]


class FakeOutput:
    id = "output-1"
    tenant_id = "tenant-1"
    trainer_id = "trainer-1"
    client_id = "client-1"
    source_type = "chat"
    output_text = "Keep pushing."
    reviewed_output_text = None


class FakeFeedbackEvent:
    id = "event-1"
    event_type = "edited"
    original_output_text = "Keep pushing."
    edited_output_text = "Start with one small action today."
    metadata = {}


class FakeHighRiskFeedbackEvent:
    id = "event-2"
    event_type = "approved"
    original_output_text = "Sarah missed workouts after Monday Equinox sessions."
    edited_output_text = "Sarah should restart after Monday Equinox sessions. Email sarah@example.com."
    metadata = {}


class AtlasServiceTests(unittest.TestCase):
    def test_sanitizer_redacts_pii_and_scores_risk(self):
        sanitizer = AtlasPiiSanitizer()

        result = sanitizer.sanitize(
            "Sarah missed workouts after her Monday Equinox session. Email sarah@example.com.",
            known_names=["Sarah"],
        )

        self.assertNotIn("Sarah", result.sanitized_text)
        self.assertNotIn("sarah@example.com", result.sanitized_text)
        self.assertIn("[EMAIL]", result.sanitized_text)
        self.assertIn("email", result.privacy_flags)
        self.assertGreaterEqual(result.privacy_risk_score, 0.35)

    def test_observer_routes_low_risk_feedback_to_trainer_and_atlas_review(self):
        repo = FakeAtlasRepository()
        observer = AtlasObserverService(repo)

        observer.observe_ai_feedback_event(output=FakeOutput(), feedback_event=FakeFeedbackEvent())

        self.assertEqual(len(repo.trainer_ai_review_queue), 1)
        self.assertEqual(repo.trainer_ai_review_queue[0]["trainer_id"], "trainer-1")
        self.assertEqual(len(repo.atlas_review_queue), 1)
        self.assertEqual(repo.atlas_review_queue[0]["reviewer_status"], "pending")
        self.assertNotIn("trainer_id", repo.atlas_review_queue[0])
        self.assertNotIn("client_id", repo.atlas_review_queue[0])

    def test_high_risk_atlas_candidate_is_rejected_with_audit_event(self):
        repo = FakeAtlasRepository()
        observer = AtlasObserverService(repo)

        observer.observe_ai_feedback_event(output=FakeOutput(), feedback_event=FakeHighRiskFeedbackEvent())

        self.assertEqual(len(repo.trainer_ai_review_queue), 1)
        self.assertEqual(len(repo.atlas_review_queue), 0)
        self.assertEqual(repo.atlas_learning_events[0]["status"], "rejected")
        self.assertEqual(repo.atlas_learning_events[0]["rejection_reason"], "privacy_risk_score_threshold")

    def test_atlas_approve_stores_approved_knowledge_only(self):
        repo = FakeAtlasRepository()
        service = AtlasReviewQueueService(repo)
        queue = repo.insert_atlas_review_queue(
            {
                "proposed_learning": "When adherence drops, choose one small next action.",
                "knowledge_type": "adherence_strategy",
                "situation_tags": ["missed_workouts"],
                "client_context_tags": ["beginner"],
                "privacy_flags": [],
                "privacy_risk_score": 0.05,
                "confidence_score": 0.8,
                "response_pattern": "Normalize and ask for the smallest next action.",
                "contraindications": ["Do not shame the client"],
                "reviewer_status": "pending",
            }
        )

        knowledge = service.approve_queue_item(queue["id"])

        self.assertEqual(knowledge.status, "approved")
        self.assertEqual(repo.atlas_knowledge[0]["status"], "approved")
        self.assertNotIn("trainer_id", repo.atlas_knowledge[0])

    def test_high_privacy_risk_cannot_be_approved(self):
        repo = FakeAtlasRepository()
        service = AtlasReviewQueueService(repo)
        queue = repo.insert_atlas_review_queue(
            {
                "proposed_learning": "Too specific.",
                "knowledge_type": "adherence_strategy",
                "situation_tags": [],
                "client_context_tags": [],
                "privacy_flags": ["email"],
                "privacy_risk_score": 0.4,
                "confidence_score": 0.8,
                "reviewer_status": "pending",
            }
        )

        with self.assertRaises(ValueError):
            service.approve_queue_item(queue["id"])

    def test_trainer_deletion_extraction_queues_anonymized_atlas_learning(self):
        repo = FakeAtlasRepository()
        repo.trainer_ai_knowledge.append(
            {
                "id": "trainer-knowledge-1",
                "trainer_id": "trainer-1",
                "status": "approved",
                "learned_rule": "This trainer prefers missed workouts reframed as next-step recovery.",
                "example_pattern_sanitized": "Missed workouts should become one small action.",
            }
        )
        observer = AtlasTrainerDeletionObserver(repo)

        result = observer.observe_before_trainer_deletion(
            trainer_ids=["trainer-1"],
            deletion_request_id="delete-1",
        )

        self.assertEqual(result["atlas_deletion_extractions"], 1)
        self.assertEqual(len(repo.atlas_review_queue), 1)
        self.assertNotIn("trainer_id", repo.atlas_review_queue[0])


if __name__ == "__main__":
    unittest.main()
