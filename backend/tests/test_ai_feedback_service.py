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

from app.modules.ai_feedback.service import AIFeedbackService


class FakeDeltaExtractor:
    def extract(self, *, original_text, edited_text, max_deltas=6):
        del original_text, edited_text, max_deltas
        return (
            [
                {
                    "memory_type": "preference",
                    "text": "Client prefers morning sessions.",
                    "memory_key": "preference_morning_sessions",
                    "tags": ["schedule"],
                }
            ],
            {"strategy": "deterministic", "deltas_count": 1},
        )


class FakeAIFeedbackRepository:
    def __init__(self):
        self.outputs = {}
        self.feedback_events = []
        self.memory_rows = {}
        self.next_output_id = 1
        self.next_event_id = 1
        self.next_memory_id = 1

    def upsert_generated_output(self, payload):
        key = (payload["trainer_id"], payload["source_type"], payload["source_ref_id"])
        existing = self.outputs.get(key)
        if existing:
            existing.update(payload)
            return existing
        created = {"id": f"output-{self.next_output_id}", **payload}
        self.next_output_id += 1
        self.outputs[key] = created
        return created

    def get_generated_output(self, trainer_id, output_id):
        del trainer_id
        for row in self.outputs.values():
            if row["id"] == output_id:
                return row
        return None

    def list_generated_outputs(self, trainer_id, status=None, source_type=None, limit=50, offset=0):
        rows = [row for row in self.outputs.values() if row["trainer_id"] == trainer_id]
        if status:
            rows = [row for row in rows if row.get("review_status") == status]
        if source_type:
            rows = [row for row in rows if row.get("source_type") == source_type]
        rows.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
        return rows[offset : offset + limit]

    def update_generated_output(self, trainer_id, output_id, payload):
        row = self.get_generated_output(trainer_id, output_id)
        if not row:
            return {}
        row.update(payload)
        return row

    def insert_feedback_event(self, payload):
        created = {"id": f"event-{self.next_event_id}", **payload}
        self.next_event_id += 1
        self.feedback_events.append(created)
        return created

    def list_feedback_events(self, output_id):
        return [row for row in self.feedback_events if row["output_id"] == output_id]

    def find_memory_by_key(self, trainer_id, client_id, memory_key):
        return self.memory_rows.get((trainer_id, client_id, memory_key))

    def insert_memory(self, payload):
        created = {"id": f"memory-{self.next_memory_id}", **payload}
        self.next_memory_id += 1
        self.memory_rows[(payload["trainer_id"], payload["client_id"], payload["memory_key"])] = created
        return created

    def update_memory(self, trainer_id, client_id, memory_id, payload):
        del memory_id
        target_key = None
        for key, row in self.memory_rows.items():
            if key[0] == trainer_id and key[1] == client_id:
                target_key = key
                row.update(payload)
                return row
        if target_key is None:
            return {}
        return self.memory_rows[target_key]


class AIFeedbackServiceTests(unittest.TestCase):
    def setUp(self):
        self.repository = FakeAIFeedbackRepository()
        self.service = AIFeedbackService(
            self.repository,
            delta_extractor=FakeDeltaExtractor(),
        )
        self.created_output = self.service.log_generated_output(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            client_id="client-1",
            source_type="chat",
            source_ref_id="message-1",
            conversation_id="conversation-1",
            message_id="message-1",
            output_text="You should train at 7 AM for better consistency.",
            output_json={"task_type": "qa_quick"},
            generation_metadata={"provider": "gemini"},
        )

    def test_approve_output_auto_applies_client_memory_deltas(self):
        response = self.service.approve_output(
            "trainer-1",
            self.created_output.id,
            request=type(
                "ApproveRequest",
                (),
                {
                    "edited_output_text": "Client prefers morning sessions.",
                    "edited_output_json": None,
                    "response_tags": ["schedule"],
                    "auto_apply_deltas": True,
                },
            )(),
        )

        self.assertEqual(response.output.review_status, "approved")
        self.assertGreaterEqual(response.auto_applied_count, 1)
        memory = self.repository.find_memory_by_key(
            "trainer-1",
            "client-1",
            "preference_morning_sessions",
        )
        self.assertIsNotNone(memory)
        self.assertEqual(memory["memory_type"], "preference")
        self.assertEqual(memory["value_json"]["visibility"], "ai_usable")
        self.assertFalse(memory["value_json"]["is_archived"])
        self.assertEqual(memory["value_json"]["provenance"]["source"], "ai_review_auto_delta")

    def test_reject_output_does_not_apply_deltas(self):
        response = self.service.reject_output(
            "trainer-1",
            self.created_output.id,
            request=type(
                "RejectRequest",
                (),
                {
                    "reason": "tone mismatch",
                    "edited_output_text": "Try a different approach.",
                    "edited_output_json": None,
                },
            )(),
        )

        self.assertEqual(response.output.review_status, "rejected")
        self.assertEqual(response.auto_applied_count, 0)
        self.assertEqual(len(self.repository.memory_rows), 0)

    def test_approve_output_skips_auto_apply_when_feature_flag_disabled(self):
        with patch("app.modules.ai_feedback.service.settings.trainer_ai_review_auto_apply_enabled", False):
            response = self.service.approve_output(
                "trainer-1",
                self.created_output.id,
                request=type(
                    "ApproveRequest",
                    (),
                    {
                        "edited_output_text": "Client prefers morning sessions.",
                        "edited_output_json": None,
                        "response_tags": ["schedule"],
                        "auto_apply_deltas": True,
                    },
                )(),
            )

        self.assertEqual(response.output.review_status, "approved")
        self.assertEqual(response.auto_applied_count, 0)
        self.assertEqual(len(self.repository.memory_rows), 0)
        self.assertEqual(response.feedback_event.apply_status, "not_applicable")


if __name__ == "__main__":
    unittest.main()
