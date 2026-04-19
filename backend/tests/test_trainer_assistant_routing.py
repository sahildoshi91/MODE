import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.modules.trainer_assistant.routing import (  # noqa: E402
    CLAUDE_OPUS_4_7_MODEL,
    CLAUDE_SONNET_4_6_MODEL,
    GEMINI_2_5_FLASH_LITE_MODEL,
    GPT_5_4_MINI_MODEL,
    GPT_5_4_MODEL,
    TrainerAssistantRouter,
    default_fallback_policy,
)
from app.modules.trainer_assistant.schemas import (  # noqa: E402
    TrainerAssistantActionType,
    TrainerAssistantComplexity,
    TrainerAssistantContextSize,
    TrainerAssistantInteractionType,
    TrainerAssistantPassConfidence,
    TrainerAssistantRoutingInput,
    TrainerAssistantStakes,
    TrainerAssistantToneFidelity,
)


class TrainerAssistantRoutingTests(unittest.TestCase):
    def setUp(self):
        self.router = TrainerAssistantRouter()

    def test_default_live_route_uses_gpt_5_4_mini(self):
        decision = self.router.route(
            TrainerAssistantRoutingInput(
                interaction_type=TrainerAssistantInteractionType.LIVE,
                stakes=TrainerAssistantStakes.LOW,
                complexity=TrainerAssistantComplexity.SIMPLE,
                context_size=TrainerAssistantContextSize.SMALL,
                tone_fidelity_needed=TrainerAssistantToneFidelity.LOW,
                previous_pass_confidence=TrainerAssistantPassConfidence.HIGH,
                action_type=TrainerAssistantActionType.ANALYZE_CLIENT,
            )
        )

        self.assertEqual(decision.model, GPT_5_4_MINI_MODEL)
        self.assertEqual(decision.reason, "default_live")
        self.assertFalse(decision.escalation_applied)

    def test_complex_multi_constraint_escalates_to_gpt_5_4(self):
        decision = self.router.route(
            TrainerAssistantRoutingInput(
                interaction_type=TrainerAssistantInteractionType.LIVE,
                stakes=TrainerAssistantStakes.HIGH,
                complexity=TrainerAssistantComplexity.MULTI_CONSTRAINT,
                context_size=TrainerAssistantContextSize.LARGE,
                tone_fidelity_needed=TrainerAssistantToneFidelity.MEDIUM,
                previous_pass_confidence=TrainerAssistantPassConfidence.LOW,
                action_type=TrainerAssistantActionType.ADJUST_PLAN,
            )
        )

        self.assertEqual(decision.model, GPT_5_4_MODEL)
        self.assertEqual(decision.reason, "complex_reasoning_escalation")
        self.assertTrue(decision.escalation_applied)

    def test_ambiguous_high_stakes_escalates_to_opus(self):
        decision = self.router.route(
            TrainerAssistantRoutingInput(
                interaction_type=TrainerAssistantInteractionType.LIVE,
                stakes=TrainerAssistantStakes.HIGH,
                complexity=TrainerAssistantComplexity.AMBIGUOUS,
                context_size=TrainerAssistantContextSize.LARGE,
                tone_fidelity_needed=TrainerAssistantToneFidelity.MEDIUM,
                previous_pass_confidence=TrainerAssistantPassConfidence.LOW,
                action_type=TrainerAssistantActionType.BUILD_PROGRAM,
            )
        )

        self.assertEqual(decision.model, CLAUDE_OPUS_4_7_MODEL)
        self.assertEqual(decision.reason, "hardest_case_escalation")
        self.assertTrue(decision.escalation_applied)

    def test_message_client_high_tone_requests_second_pass_sonnet(self):
        decision = self.router.route(
            TrainerAssistantRoutingInput(
                interaction_type=TrainerAssistantInteractionType.LIVE,
                stakes=TrainerAssistantStakes.MEDIUM,
                complexity=TrainerAssistantComplexity.SIMPLE,
                context_size=TrainerAssistantContextSize.MEDIUM,
                tone_fidelity_needed=TrainerAssistantToneFidelity.HIGH,
                previous_pass_confidence=TrainerAssistantPassConfidence.HIGH,
                action_type=TrainerAssistantActionType.MESSAGE_CLIENT,
            )
        )

        self.assertEqual(decision.second_pass_model, CLAUDE_SONNET_4_6_MODEL)

    def test_background_route_uses_gemini_flash_lite(self):
        decision = self.router.route(
            TrainerAssistantRoutingInput(
                interaction_type=TrainerAssistantInteractionType.BACKGROUND,
                stakes=TrainerAssistantStakes.LOW,
                complexity=TrainerAssistantComplexity.SIMPLE,
                context_size=TrainerAssistantContextSize.SMALL,
                tone_fidelity_needed=TrainerAssistantToneFidelity.LOW,
                previous_pass_confidence=TrainerAssistantPassConfidence.HIGH,
                action_type=TrainerAssistantActionType.SUMMARIZE,
            )
        )

        self.assertEqual(decision.model, GEMINI_2_5_FLASH_LITE_MODEL)
        self.assertEqual(decision.reason, "background_default")
        self.assertEqual(decision.interaction_type, TrainerAssistantInteractionType.BACKGROUND)

    def test_fallback_policy_matches_required_order(self):
        policy = default_fallback_policy().model_fallback_order
        self.assertEqual(
            policy.get(GPT_5_4_MINI_MODEL),
            [GPT_5_4_MODEL, CLAUDE_SONNET_4_6_MODEL, GEMINI_2_5_FLASH_LITE_MODEL],
        )
        self.assertEqual(
            policy.get(GPT_5_4_MODEL),
            [CLAUDE_SONNET_4_6_MODEL, GPT_5_4_MINI_MODEL, GEMINI_2_5_FLASH_LITE_MODEL],
        )
        self.assertEqual(
            policy.get(CLAUDE_SONNET_4_6_MODEL),
            [GPT_5_4_MODEL, GPT_5_4_MINI_MODEL, GEMINI_2_5_FLASH_LITE_MODEL],
        )
        self.assertEqual(
            policy.get(CLAUDE_OPUS_4_7_MODEL),
            [CLAUDE_SONNET_4_6_MODEL, GPT_5_4_MODEL, GPT_5_4_MINI_MODEL, GEMINI_2_5_FLASH_LITE_MODEL],
        )
        self.assertEqual(
            policy.get(GEMINI_2_5_FLASH_LITE_MODEL),
            [GPT_5_4_MINI_MODEL, GPT_5_4_MODEL, CLAUDE_SONNET_4_6_MODEL],
        )


if __name__ == "__main__":
    unittest.main()
