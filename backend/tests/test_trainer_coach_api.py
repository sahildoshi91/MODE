import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.config import settings
from app.core.dependencies import get_trainer_coach_service, get_trainer_context
from app.core.rate_limit import _rate_limiter
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.ai_feedback.schemas import AIGeneratedOutput
from app.modules.trainer_coach.schemas import (
    CoachEventsResponse,
    CoachQueueItem,
    CoachQueueMutationResponse,
    CoachQueueResponse,
    CoachSummaryState,
    CoachSystemEventRecord,
    CoachSyncState,
    CoachWorkspaceResponse,
)


class FakeTrainerCoachService:
    def __init__(self):
        self.events_by_key = {}
        self.now = datetime.now(timezone.utc)

    def build_workspace(self, trainer_context, target_date=None):
        del target_date
        return CoachWorkspaceResponse(
            generated_at=self.now,
            summary=CoachSummaryState(
                state="drafts_pending",
                title="1 drafts pending review",
                subtitle="Resolve pending drafts.",
                actions=[],
                counts={"drafts_pending": 1},
            ),
            queue=[self._queue_item(trainer_context.trainer_id)],
            events=[],
            sync=CoachSyncState(pending_operation_count=0, failed_operation_count=0),
        )

    def list_queue(self, trainer_context, target_date=None, limit=100):
        del target_date, limit
        return CoachQueueResponse(
            generated_at=self.now,
            count=1,
            items=[self._queue_item(trainer_context.trainer_id)],
        )

    def list_events(self, trainer_context, limit=80):
        del limit
        rows = [
            row for (trainer_id, _event_key), row in self.events_by_key.items()
            if trainer_id == trainer_context.trainer_id
        ]
        return CoachEventsResponse(
            generated_at=self.now,
            count=len(rows),
            items=rows,
        )

    def create_event(self, trainer_context, request):
        if request.client_id == "cross-tenant-client":
            raise ValueError("Client not found for trainer")
        key = (trainer_context.trainer_id, request.event_key)
        if key in self.events_by_key:
            return self.events_by_key[key]
        row = CoachSystemEventRecord(
            id=f"evt-{len(self.events_by_key) + 1}",
            event_type=request.event_type,
            message=request.message,
            severity=request.severity,
            visibility=request.visibility,
            status=request.status,
            output_id=request.output_id,
            client_id=request.client_id,
            payload=request.payload,
            created_at=self.now,
            updated_at=self.now,
        )
        self.events_by_key[key] = row
        return row

    def approve_queue_item(self, trainer_context, output_id, request):
        del request
        return self._mutation(trainer_context.trainer_id, output_id, "draft_approved", "approved")

    def edit_queue_item(self, trainer_context, output_id, request):
        del request
        return self._mutation(trainer_context.trainer_id, output_id, "draft_edited", "open")

    def reject_queue_item(self, trainer_context, output_id, request):
        del request
        return self._mutation(trainer_context.trainer_id, output_id, "draft_rejected", "rejected")

    def _queue_item(self, trainer_id: str) -> CoachQueueItem:
        return CoachQueueItem(
            output_id="output-1",
            trainer_id=trainer_id,
            client_id="client-1",
            client_name="Taylor",
            source_type="chat",
            review_status="open",
            queue_state="pending",
            priority_tier="high",
            queue_priority=9,
            delivery_state="draft",
            action_type="adjust_plan",
            headline="Adjust plan",
            summary="Lower intensity by 10%.",
            output_text="Lower intensity by 10%.",
            output_json={"summary": "Lower intensity by 10%."},
            reviewed_output_text=None,
            reviewed_output_json=None,
            created_at=self.now,
            updated_at=self.now,
        )

    def _mutation(self, trainer_id: str, output_id: str, event_type: str, review_status: str) -> CoachQueueMutationResponse:
        return CoachQueueMutationResponse(
            output=AIGeneratedOutput(
                id=output_id,
                tenant_id="tenant-1",
                trainer_id=trainer_id,
                client_id="client-1",
                source_type="chat",
                source_ref_id="msg-1",
                output_text="Updated output",
                review_status=review_status,
                output_json={"summary": "Updated output"},
            ),
            feedback_event=None,
            events=[
                CoachSystemEventRecord(
                    id=f"evt-{event_type}",
                    event_type=event_type,
                    message=event_type,
                    severity="success",
                    visibility="system",
                    status="confirmed",
                    output_id=output_id,
                    client_id="client-1",
                    payload={},
                    created_at=self.now,
                    updated_at=self.now,
                )
            ],
            memory_applied_count=0,
            delivery={},
            queue_count=0 if review_status in {"approved", "rejected"} else 1,
        )


class TrainerCoachApiTests(unittest.TestCase):
    def setUp(self):
        self._original_rate_limit_enabled = settings.rate_limit_enabled
        self._original_rate_limit_window_seconds = settings.rate_limit_window_seconds
        self._original_rate_limit_trainer_assistant_per_window = settings.rate_limit_trainer_assistant_per_window
        settings.rate_limit_enabled = True
        settings.rate_limit_window_seconds = 60
        settings.rate_limit_trainer_assistant_per_window = 20
        _rate_limiter._windows.clear()
        self.fake_service = FakeTrainerCoachService()
        self.trainer_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach One",
            client_id=None,
        )
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="trainer-user-1",
            email="trainer1@example.com",
            access_token="token-1",
        )
        app.dependency_overrides[get_trainer_context] = lambda: self.trainer_context
        app.dependency_overrides[get_trainer_coach_service] = lambda: self.fake_service
        self.client = TestClient(app)

    def tearDown(self):
        settings.rate_limit_enabled = self._original_rate_limit_enabled
        settings.rate_limit_window_seconds = self._original_rate_limit_window_seconds
        settings.rate_limit_trainer_assistant_per_window = self._original_rate_limit_trainer_assistant_per_window
        _rate_limiter._windows.clear()
        app.dependency_overrides.clear()

    def test_workspace_and_queue_routes_return_expected_shape(self):
        workspace_response = self.client.get(
            "/api/v1/trainer-coach/workspace",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(workspace_response.status_code, 200, workspace_response.text)
        self.assertIn("summary", workspace_response.json())

        queue_response = self.client.get(
            "/api/v1/trainer-coach/queue?limit=50",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(queue_response.status_code, 200, queue_response.text)
        self.assertEqual(queue_response.json()["count"], 1)

    def test_create_event_is_idempotent_per_event_key(self):
        payload = {
            "event_key": "event-key-1",
            "event_type": "rule_updated",
            "message": "Rule updated",
            "severity": "success",
            "visibility": "system",
            "status": "confirmed",
            "client_id": "client-1",
            "payload": {"source": "test"},
        }
        first = self.client.post(
            "/api/v1/trainer-coach/events",
            json=payload,
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(first.status_code, 200, first.text)
        second = self.client.post(
            "/api/v1/trainer-coach/events",
            json=payload,
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json()["id"], second.json()["id"])

    def test_create_event_maps_cross_tenant_client_error_to_404(self):
        response = self.client.post(
            "/api/v1/trainer-coach/events",
            json={
                "event_key": "event-key-2",
                "event_type": "rule_updated",
                "message": "Rule updated",
                "client_id": "cross-tenant-client",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 404, response.text)

    def test_approve_queue_item_invalidates_client_chat_cache(self):
        with patch("app.api.v1.trainer_coach.invalidate_chat_context") as invalidate:
            response = self.client.post(
                "/api/v1/trainer-coach/queue/output-1/approve",
                json={"idempotency_key": "approve-1"},
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        invalidate.assert_called_once_with("trainer-1", "client-1", reason="trainer_note_added")

    def test_trainer_only_enforcement_blocks_client_actor(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="client-user-1",
            email="client@example.com",
            access_token="token-client",
        )
        response = self.client.post(
            "/api/v1/trainer-coach/events",
            json={
                "event_key": "event-key-3",
                "event_type": "rule_updated",
                "message": "Rule updated",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 403, response.text)

    def test_trainer_coach_endpoints_enforce_rate_limit(self):
        settings.rate_limit_trainer_assistant_per_window = 1

        first = self.client.get(
            "/api/v1/trainer-coach/workspace",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        second = self.client.get(
            "/api/v1/trainer-coach/workspace",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 429, second.text)
        payload = second.json().get("detail", {})
        self.assertEqual(payload.get("detail"), "Rate limit exceeded")
        self.assertEqual(payload.get("group"), "trainer_assistant")
        self.assertGreaterEqual(int(payload.get("retry_after_seconds", 0)), 1)


if __name__ == "__main__":
    unittest.main()
