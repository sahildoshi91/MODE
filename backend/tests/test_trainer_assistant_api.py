import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient  # noqa: E402

from app.api.v1.trainer_assistant import CONTROLLED_TRAINER_ASSISTANT_ERROR_DETAIL  # noqa: E402
from app.core.auth import AuthenticatedUser, require_user  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.dependencies import get_trainer_assistant_service, get_trainer_context  # noqa: E402
from app.core.tenancy import TrainerContext  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.trainer_assistant.schemas import (  # noqa: E402
    TrainerAssistantActionType,
    TrainerAssistantBackgroundResult,
    TrainerAssistantBackgroundRunResponse,
    TrainerAssistantBootstrapResponse,
    TrainerAssistantClientOption,
    TrainerAssistantDraftMutationResponse,
    TrainerAssistantExecuteResponse,
    TrainerAssistantNormalizedOutput,
    TrainerAssistantOutputSection,
    TrainerAssistantPulseInsight,
    TrainerAssistantRouteSummary,
)


def _sample_output(action_type: TrainerAssistantActionType) -> TrainerAssistantNormalizedOutput:
    return TrainerAssistantNormalizedOutput(
        action_type=action_type,
        headline="Draft Ready",
        summary="Structured draft generated.",
        sections=[TrainerAssistantOutputSection(title="Draft", text="Preview content")],
        editable_payload={"message_draft": "Preview content"},
        preview_required=True,
        client_impacting=True,
        confidence=0.81,
        next_actions=["Edit", "Approve"],
    )


class FakeTrainerAssistantService:
    def bootstrap(self, _trainer_context, preferred_client_id=None, target_date=None):
        del preferred_client_id, target_date
        return TrainerAssistantBootstrapResponse(
            generated_at=datetime.now(timezone.utc),
            active_client_id="client-1",
            requires_client_selection=False,
            clients=[
                TrainerAssistantClientOption(
                    client_id="client-1",
                    client_name="Taylor",
                    priority_tier="high",
                    scheduled_today=True,
                    risk_labels=["Missed Workouts"],
                )
            ],
            pulse_insights=[
                TrainerAssistantPulseInsight(
                    id="client-1:low_workout_completion",
                    client_id="client-1",
                    label="Taylor: Missed Workouts",
                    detail="Only one workout completed this week.",
                    severity="high",
                    action_type=TrainerAssistantActionType.ADJUST_PLAN,
                    suggested_prompt="Adjust Taylor's plan based on missed workouts.",
                )
            ],
            suggested_prompts=[
                "Adjust Taylor's plan based on missed workouts.",
                "Analyze Taylor's progress this week.",
                "Write a check-in message for Taylor.",
            ],
            context_bundle={"client_id": "client-1", "client_name": "Taylor"},
        )

    def execute(self, _trainer_context, request):
        return TrainerAssistantExecuteResponse(
            draft_id="draft-1",
            output=_sample_output(request.action_type),
            route=TrainerAssistantRouteSummary(
                reason="default_live",
                escalation_applied=False,
                fallback_applied=False,
                second_pass_applied=False,
            ),
        )

    def edit_draft(self, _trainer_context, draft_id, _request):
        return TrainerAssistantDraftMutationResponse(
            draft_id=draft_id,
            review_status="open",
            output=_sample_output(TrainerAssistantActionType.MESSAGE_CLIENT),
        )

    def approve_draft(self, _trainer_context, draft_id, _request):
        return TrainerAssistantDraftMutationResponse(
            draft_id=draft_id,
            review_status="approved",
            output=_sample_output(TrainerAssistantActionType.MESSAGE_CLIENT),
        )

    def reject_draft(self, _trainer_context, draft_id, _request):
        return TrainerAssistantDraftMutationResponse(
            draft_id=draft_id,
            review_status="rejected",
            output=_sample_output(TrainerAssistantActionType.MESSAGE_CLIENT),
        )

    def run_background(self, _trainer_context, _request):
        now = datetime.now(timezone.utc)
        return TrainerAssistantBackgroundRunResponse(
            run_started_at=now,
            run_finished_at=now,
            results=[
                TrainerAssistantBackgroundResult(
                    action_type=TrainerAssistantActionType.SUMMARIZE,
                    client_id="client-1",
                    status="completed",
                    draft_id="draft-bg-1",
                )
            ],
        )


class TrainerAssistantApiTests(unittest.TestCase):
    def setUp(self):
        self._original_flag = settings.trainer_assistant_v1_enabled
        settings.trainer_assistant_v1_enabled = True

        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="trainer-user-1",
            email="trainer@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Riley",
            client_id=None,
        )
        app.dependency_overrides[get_trainer_assistant_service] = lambda: FakeTrainerAssistantService()
        self.client = TestClient(app)

    def tearDown(self):
        settings.trainer_assistant_v1_enabled = self._original_flag
        app.dependency_overrides.clear()

    def test_bootstrap_returns_client_context_and_prompts(self):
        response = self.client.get(
            "/api/v1/trainer-assistant/bootstrap",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["active_client_id"], "client-1")
        self.assertFalse(payload["requires_client_selection"])
        self.assertEqual(len(payload["suggested_prompts"]), 3)
        self.assertEqual(payload["context_bundle"]["client_name"], "Taylor")

    def test_execute_returns_structured_output_preview(self):
        response = self.client.post(
            "/api/v1/trainer-assistant/execute",
            headers={"Authorization": "Bearer ignored-by-override"},
            json={
                "client_id": "client-1",
                "action_type": "message_client",
                "message": "Write a short check-in note.",
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["draft_id"], "draft-1")
        self.assertEqual(payload["output"]["format_version"], "v1")
        self.assertEqual(payload["output"]["action_type"], "message_client")
        self.assertTrue(payload["output"]["preview_required"])
        self.assertIn("reason", payload["route"])

    def test_draft_mutation_endpoints_return_review_status(self):
        edit = self.client.post(
            "/api/v1/trainer-assistant/drafts/draft-1/edit",
            headers={"Authorization": "Bearer ignored-by-override"},
            json={"edited_output_json": _sample_output(TrainerAssistantActionType.MESSAGE_CLIENT).model_dump(mode="json")},
        )
        approve = self.client.post(
            "/api/v1/trainer-assistant/drafts/draft-1/approve",
            headers={"Authorization": "Bearer ignored-by-override"},
            json={},
        )
        reject = self.client.post(
            "/api/v1/trainer-assistant/drafts/draft-1/reject",
            headers={"Authorization": "Bearer ignored-by-override"},
            json={"reason": "Not aligned yet."},
        )

        self.assertEqual(edit.status_code, 200)
        self.assertEqual(approve.status_code, 200)
        self.assertEqual(reject.status_code, 200)
        self.assertEqual(edit.json()["review_status"], "open")
        self.assertEqual(approve.json()["review_status"], "approved")
        self.assertEqual(reject.json()["review_status"], "rejected")

    def test_requires_trainer_actor(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="client-user-1",
            email="client@example.com",
            access_token="token-123",
        )
        response = self.client.get(
            "/api/v1/trainer-assistant/bootstrap",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Trainer-only endpoint")

    def test_feature_flag_disables_endpoints(self):
        settings.trainer_assistant_v1_enabled = False
        response = self.client.get(
            "/api/v1/trainer-assistant/bootstrap",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 404)

    def test_execute_maps_unexpected_errors_to_controlled_json_error(self):
        class _BrokenTrainerAssistantService(FakeTrainerAssistantService):
            def execute(self, _trainer_context, _request):
                raise RuntimeError("database exploded")

        app.dependency_overrides[get_trainer_assistant_service] = lambda: _BrokenTrainerAssistantService()
        response = self.client.post(
            "/api/v1/trainer-assistant/execute",
            headers={"Authorization": "Bearer ignored-by-override"},
            json={
                "client_id": "client-1",
                "action_type": "message_client",
                "message": "Write a quick note.",
            },
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], CONTROLLED_TRAINER_ASSISTANT_ERROR_DETAIL)
        self.assertEqual(response.json()["status"], 502)
        self.assertEqual(response.json()["request_path"], "/api/v1/trainer-assistant/execute")
        self.assertTrue(response.json()["error_id"])

    def test_execute_maps_source_type_constraint_failures_with_migration_hint(self):
        class _ConstraintFailureService(FakeTrainerAssistantService):
            def execute(self, _trainer_context, _request):
                raise RuntimeError(
                    {
                        "code": "23514",
                        "message": (
                            'new row for relation "ai_generated_outputs" violates check constraint '
                            '"ai_generated_outputs_source_type_check"'
                        ),
                        "hint": None,
                        "details": (
                            "Failing row contains source_type=trainer_assistant_draft and "
                            "violates ai_generated_outputs_source_type_check."
                        ),
                    }
                )

        app.dependency_overrides[get_trainer_assistant_service] = lambda: _ConstraintFailureService()
        response = self.client.post(
            "/api/v1/trainer-assistant/execute",
            headers={"Authorization": "Bearer ignored-by-override"},
            json={
                "client_id": "client-1",
                "action_type": "message_client",
                "message": "Write a quick note.",
            },
        )

        self.assertEqual(response.status_code, 502)
        payload = response.json()
        self.assertEqual(payload["detail"], CONTROLLED_TRAINER_ASSISTANT_ERROR_DETAIL)
        self.assertEqual(payload["status"], 502)
        self.assertEqual(payload["request_path"], "/api/v1/trainer-assistant/execute")
        self.assertTrue(payload["error_id"])


if __name__ == "__main__":
    unittest.main()
