import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.config import settings  # noqa: E402
from app.ai.client import TextCompletion, TokenUsage  # noqa: E402
from app.modules.trainer_assistant.routing import GEMINI_2_5_FLASH_LITE_MODEL, GPT_5_4_MINI_MODEL  # noqa: E402
from app.modules.trainer_assistant.schemas import (  # noqa: E402
    TrainerAssistantActionType,
    TrainerAssistantComplexity,
    TrainerAssistantContextSize,
    TrainerAssistantInteractionType,
    TrainerAssistantPassConfidence,
    TrainerAssistantRoutingDecision,
    TrainerAssistantRoutingInput,
    TrainerAssistantStakes,
    TrainerAssistantToneFidelity,
)
from app.modules.trainer_assistant.service import TrainerAssistantService, _PromptPackage  # noqa: E402


class _NoopRepo:
    pass


class _NoopHomeService:
    pass


class _NoopClientService:
    pass


class _NoopFeedbackService:
    pass


class _BackgroundRetryService(TrainerAssistantService):
    def __init__(self):
        super().__init__(
            repository=_NoopRepo(),
            trainer_home_service=_NoopHomeService(),
            trainer_client_service=_NoopClientService(),
            ai_feedback_service=_NoopFeedbackService(),
        )
        self.attempted_models: list[str] = []

    def _execute_model(self, model, prompt):  # noqa: ANN001
        del prompt
        self.attempted_models.append(model)
        if model == GEMINI_2_5_FLASH_LITE_MODEL:
            raise RuntimeError("gemini_unavailable")
        return (
            TextCompletion(
                text='{"format_version":"v1","action_type":"summarize","headline":"ok","summary":"ok","sections":[],"editable_payload":{},"preview_required":true,"client_impacting":false,"confidence":0.8,"next_actions":[]}',  # noqa: E501
                token_usage=TokenUsage(prompt_tokens=10, completion_tokens=20, total_tokens=30),
            ),
            model,
        )


class TrainerAssistantOutputContractTests(unittest.TestCase):
    def setUp(self):
        self._openai_key = settings.openai_api_key
        self._anthropic_key = settings.anthropic_api_key
        self._gemini_key = settings.gemini_api_key
        settings.openai_api_key = None
        settings.anthropic_api_key = None
        settings.gemini_api_key = None
        self.service = TrainerAssistantService(
            repository=_NoopRepo(),
            trainer_home_service=_NoopHomeService(),
            trainer_client_service=_NoopClientService(),
            ai_feedback_service=_NoopFeedbackService(),
        )

    def tearDown(self):
        settings.openai_api_key = self._openai_key
        settings.anthropic_api_key = self._anthropic_key
        settings.gemini_api_key = self._gemini_key

    def test_normalize_message_output_repairs_missing_contract_fields(self):
        output = self.service._normalize_output_from_payload(  # noqa: SLF001
            {
                "action_type": "message_client",
                "headline": "Message Ready",
                "editable_payload": {},
            },
            fallback_action_type=TrainerAssistantActionType.MESSAGE_CLIENT,
        )

        self.assertEqual(output.format_version, "v1")
        self.assertEqual(output.action_type, TrainerAssistantActionType.MESSAGE_CLIENT)
        self.assertIn("message_draft", output.editable_payload)
        self.assertTrue(output.preview_required)
        self.assertTrue(output.client_impacting)
        self.assertGreaterEqual(len(output.sections), 1)

    def test_normalize_adjust_plan_output_enforces_structured_keys(self):
        output = self.service._normalize_output_from_payload(  # noqa: SLF001
            {
                "action_type": "adjust_plan",
                "editable_payload": {
                    "what_changed": "Reduced volume in high fatigue blocks",
                    "reason": "recovery friction",
                },
            },
            fallback_action_type=TrainerAssistantActionType.ADJUST_PLAN,
        )

        self.assertEqual(output.action_type, TrainerAssistantActionType.ADJUST_PLAN)
        self.assertIn("what_changed", output.editable_payload)
        self.assertIn("exercise_swaps", output.editable_payload)
        self.assertIn("sets_reps_intensity_changes", output.editable_payload)
        self.assertIn("reason", output.editable_payload)
        self.assertIsInstance(output.editable_payload["what_changed"], list)

    def test_malformed_text_falls_back_to_safe_template(self):
        output = self.service._normalize_output_from_text(  # noqa: SLF001
            "not valid json",
            action_type=TrainerAssistantActionType.ANALYZE_CLIENT,
            fallback_context={"client_name": "Taylor"},
        )

        self.assertEqual(output.action_type, TrainerAssistantActionType.ANALYZE_CLIENT)
        self.assertTrue(output.preview_required)
        self.assertTrue(output.client_impacting)
        self.assertIn("key_issue", output.editable_payload)

    def test_background_retry_then_promote_for_essential_job(self):
        service = _BackgroundRetryService()
        decision = TrainerAssistantRoutingDecision(
            model=GEMINI_2_5_FLASH_LITE_MODEL,
            fallback_models=[],
            reason="background_default",
            escalation_applied=False,
            second_pass_model=None,
            interaction_type=TrainerAssistantInteractionType.BACKGROUND,
        )
        routing_input = TrainerAssistantRoutingInput(
            interaction_type=TrainerAssistantInteractionType.BACKGROUND,
            stakes=TrainerAssistantStakes.LOW,
            complexity=TrainerAssistantComplexity.SIMPLE,
            context_size=TrainerAssistantContextSize.SMALL,
            tone_fidelity_needed=TrainerAssistantToneFidelity.LOW,
            previous_pass_confidence=TrainerAssistantPassConfidence.HIGH,
            action_type=TrainerAssistantActionType.SUMMARIZE,
        )
        result = service._execute_prompt_with_routing(  # noqa: SLF001
            decision=decision,
            prompt=_PromptPackage(system_prompt="system", user_prompt="user"),
            routing_input=routing_input,
            essential_background_job=True,
        )

        self.assertEqual(service.attempted_models, [GEMINI_2_5_FLASH_LITE_MODEL, GEMINI_2_5_FLASH_LITE_MODEL, GPT_5_4_MINI_MODEL])
        self.assertEqual(result.execution_model, GPT_5_4_MINI_MODEL)
        self.assertTrue(result.fallback_applied)
        self.assertEqual(result.fallback_reason, "gemini_background_retry")


if __name__ == "__main__":
    unittest.main()
