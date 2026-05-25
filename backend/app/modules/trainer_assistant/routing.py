from __future__ import annotations

from app.ai.client import GEMINI_FLASH_LITE_MODEL as GEMINI_3_1_FLASH_LITE_MODEL
from app.modules.trainer_assistant.schemas import (
    FallbackPolicyConfig,
    ProviderModelRegistry,
    RoutingThresholdConfig,
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


GPT_5_4_MINI_MODEL = "gpt-5.4-mini"
GPT_5_4_MODEL = "gpt-5.4"
CLAUDE_SONNET_4_6_MODEL = "claude-sonnet-4.6"
CLAUDE_OPUS_4_7_MODEL = "claude-opus-4.7"


def default_provider_registry() -> ProviderModelRegistry:
    return ProviderModelRegistry(
        default_live_model=GPT_5_4_MINI_MODEL,
        complex_reasoning_model=GPT_5_4_MODEL,
        premium_review_model=CLAUDE_SONNET_4_6_MODEL,
        hardest_case_model=CLAUDE_OPUS_4_7_MODEL,
        background_model=GEMINI_3_1_FLASH_LITE_MODEL,
    )


def default_fallback_policy() -> FallbackPolicyConfig:
    return FallbackPolicyConfig(
        model_fallback_order={
            # Keep cross-provider fallbacks so live execution can survive a single-provider outage.
            GPT_5_4_MINI_MODEL: [GPT_5_4_MODEL, CLAUDE_SONNET_4_6_MODEL, GEMINI_3_1_FLASH_LITE_MODEL],
            GPT_5_4_MODEL: [CLAUDE_SONNET_4_6_MODEL, GPT_5_4_MINI_MODEL, GEMINI_3_1_FLASH_LITE_MODEL],
            CLAUDE_SONNET_4_6_MODEL: [GPT_5_4_MODEL, GPT_5_4_MINI_MODEL, GEMINI_3_1_FLASH_LITE_MODEL],
            CLAUDE_OPUS_4_7_MODEL: [
                CLAUDE_SONNET_4_6_MODEL,
                GPT_5_4_MODEL,
                GPT_5_4_MINI_MODEL,
                GEMINI_3_1_FLASH_LITE_MODEL,
            ],
            GEMINI_3_1_FLASH_LITE_MODEL: [GPT_5_4_MINI_MODEL, GPT_5_4_MODEL, CLAUDE_SONNET_4_6_MODEL],
        }
    )


class TrainerAssistantRouter:
    def __init__(
        self,
        *,
        thresholds: RoutingThresholdConfig | None = None,
        providers: ProviderModelRegistry | None = None,
        fallback: FallbackPolicyConfig | None = None,
    ):
        self.thresholds = thresholds or RoutingThresholdConfig()
        self.providers = providers or default_provider_registry()
        self.fallback = fallback or default_fallback_policy()

    def route(self, routing_input: TrainerAssistantRoutingInput) -> TrainerAssistantRoutingDecision:
        if routing_input.interaction_type == TrainerAssistantInteractionType.BACKGROUND:
            return TrainerAssistantRoutingDecision(
                model=self.providers.background_model,
                fallback_models=self.fallback.model_fallback_order.get(self.providers.background_model, []),
                reason="background_default",
                escalation_applied=False,
                second_pass_model=None,
                interaction_type=TrainerAssistantInteractionType.BACKGROUND,
            )

        score = self._score_complexity(routing_input)

        if self._requires_hardest_case(routing_input, score):
            model = self.providers.hardest_case_model
            reason = "hardest_case_escalation"
            escalation_applied = True
        elif score >= self.thresholds.gpt_5_4_escalation_min_score:
            model = self.providers.complex_reasoning_model
            reason = "complex_reasoning_escalation"
            escalation_applied = True
        else:
            model = self.providers.default_live_model
            reason = "default_live"
            escalation_applied = False

        second_pass_model = self._second_pass_model(routing_input, score)

        return TrainerAssistantRoutingDecision(
            model=model,
            fallback_models=self.fallback.model_fallback_order.get(model, []),
            reason=reason,
            escalation_applied=escalation_applied,
            second_pass_model=second_pass_model,
            interaction_type=TrainerAssistantInteractionType.LIVE,
        )

    def background_promote_model(self) -> str:
        return self.providers.default_live_model

    def _score_complexity(self, routing_input: TrainerAssistantRoutingInput) -> int:
        score = 0

        if routing_input.stakes == TrainerAssistantStakes.HIGH:
            score += 3
        elif routing_input.stakes == TrainerAssistantStakes.MEDIUM:
            score += 1

        if routing_input.complexity == TrainerAssistantComplexity.MULTI_CONSTRAINT:
            score += 2
        elif routing_input.complexity == TrainerAssistantComplexity.AMBIGUOUS:
            score += 4

        if routing_input.context_size == TrainerAssistantContextSize.LARGE:
            score += 1

        if routing_input.tone_fidelity_needed == TrainerAssistantToneFidelity.HIGH:
            score += 1

        if routing_input.previous_pass_confidence == TrainerAssistantPassConfidence.LOW:
            score += 2
        elif routing_input.previous_pass_confidence == TrainerAssistantPassConfidence.MEDIUM:
            score += 1

        if routing_input.action_type in {
            TrainerAssistantActionType.BUILD_PROGRAM,
            TrainerAssistantActionType.ADJUST_PLAN,
        }:
            score += 1

        return score

    def _requires_hardest_case(self, routing_input: TrainerAssistantRoutingInput, score: int) -> bool:
        if score < self.thresholds.opus_escalation_min_score:
            return False
        if routing_input.stakes != TrainerAssistantStakes.HIGH:
            return False
        return routing_input.complexity == TrainerAssistantComplexity.AMBIGUOUS

    def _second_pass_model(self, routing_input: TrainerAssistantRoutingInput, score: int) -> str | None:
        if routing_input.interaction_type != TrainerAssistantInteractionType.LIVE:
            return None
        if routing_input.action_type != TrainerAssistantActionType.MESSAGE_CLIENT:
            return None
        if routing_input.tone_fidelity_needed == TrainerAssistantToneFidelity.HIGH:
            return self.providers.premium_review_model
        if (
            routing_input.previous_pass_confidence == TrainerAssistantPassConfidence.LOW
            and score >= self.thresholds.second_pass_min_score
        ):
            return self.providers.premium_review_model
        return None
