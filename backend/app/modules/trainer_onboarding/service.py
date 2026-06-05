from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.ai.client import GPT_5_4_MINI_MODEL, OpenAIClient
from app.core.config import settings
from app.core.tenancy import TrainerContext
from app.modules.trainer_onboarding.repository import (
    TrainerOnboardingRepository,
    TrainerOnboardingStorageUnavailableError,
)
from app.modules.trainer_persona.repository import TrainerPersonaRepository


logger = logging.getLogger(__name__)

ONBOARDING_STATUS_NOT_STARTED = "not_started"
ONBOARDING_STATUS_IN_PROGRESS = "in_progress"
ONBOARDING_STATUS_CALIBRATION_PENDING = "calibration_pending"
ONBOARDING_STATUS_COMPLETED = "completed"

ONBOARDING_STEPS = [
    "welcome",
    "coaching_identity",
    "voice_calibration",
    "decision_engine",
    "training_philosophy",
    "boundaries",
    "personal_touch_optional",
    "final_calibration",
]
TOTAL_STEPS = len(ONBOARDING_STEPS)
LOW_CONFIDENCE_THRESHOLD = 0.58

SAMPLE_APPROVE_SIGNALS = frozenset({
    "yeah, that's me", "yeah that's me", "looks good", "that's right",
    "correct", "approved", "yes", "yep",
})
SAMPLE_EDIT_SIGNALS = frozenset({
    "i'd say it differently", "id say it differently",
    "i would change it", "i'd change this", "not quite", "not exactly",
})
SAMPLE_SKIP_SIGNALS = frozenset({
    "skip", "skip this", "never mind, skip", "pass",
})

STATE_FIELD_KEYS = (
    "onboarding_status",
    "onboarding_progress",
    "last_completed_step",
    "identity",
    "tone",
    "communication_preferences",
    "coaching_examples",
    "decision_weights",
    "scenario_rules",
    "philosophy",
    "non_negotiables",
    "boundaries",
    "media_assets",
    "calibration_examples",
)

STEP_PROMPTS: dict[str, tuple[str, list[str]]] = {
    "welcome": (
        "Case study: A brand-new client opens chat and sees your agent name before the first message. What should your coaching agent be called?",
        [
            "Mode Atlas",
            "Coach Nova",
            "Momentum Guide",
        ],
    ),
    "coaching_identity": (
        "Case study: A client says, \"I am anxious about week 1 and worried I will fail again.\" What coaching identity should your agent lead with first?",
        [
            "Supportive and direct",
            "High accountability",
            "Calm and confidence-first",
        ],
    ),
    "voice_calibration": (
        "Case study: A client missed three sessions and feels behind. How should the coach sound in that reply? Share 2-3 words to describe the style to use (examples: calm, direct, encouraging) and 1-2 words to avoid (examples: harsh, shaming).",
        [
            "Short and punchy",
            "Warm and conversational",
            "Technical but simple",
        ],
    ),
    "decision_engine": (
        "Case study: Client slept 5 hours, stress is 8/10, has mild knee pain, and only 30 minutes today. What exact priority order should your agent use to decide the session?",
        [
            "Prioritize pain and safety first",
            "Prioritize sleep and stress first",
            "Prioritize schedule adherence first",
        ],
    ),
    "training_philosophy": (
        "Case study: A client asks for a shortcut that could speed progress but risks burnout. What philosophy and non-negotiables should your agent enforce?",
        [
            "Consistency before intensity",
            "Technique before load",
            "Recovery drives progression",
        ],
    ),
    "boundaries": (
        "Case study: A client insists on pushing through sharp pain to stay on plan. Define your Hard, Guardrail, and Soft boundaries in this situation.",
        [
            "Hard: stop on sharp pain",
            "Guardrail: pivot to pain-free alternatives",
            "Soft: shorten session on high stress",
        ],
    ),
    "personal_touch_optional": (
        "Case study (optional): A client needs a confidence boost before training. What signature phrase, short story, or media cue should your agent use? Reply 'skip' to pass.",
        [
            "Skip this",
            "Use my accountability phrase",
            "I will share a quick story",
        ],
    ),
}

CLARIFIER_PROMPTS: dict[str, str] = {
    "welcome": "Give me a clear agent name (2-4 words), for example: Coach Nova.",
    "coaching_identity": "In one sentence, what coaching identity should the agent project in that anxious week-1 scenario?",
    "voice_calibration": "In plain language, how should the coach sound here? Share 2-3 style words to use (example: calm, direct, encouraging) and 1-2 to avoid (example: harsh, shaming).",
    "decision_engine": "List your top 3 factors in strict order for that mixed-readiness scenario.",
    "training_philosophy": "State 1-3 non-negotiables your agent should enforce in that shortcut scenario.",
    "boundaries": "State one Hard boundary, one Guardrail boundary, and one Soft boundary for that pain-push scenario.",
    "personal_touch_optional": "You can add one personal phrase, or reply 'skip'.",
}

STEP_ALIAS: dict[str, str] = {
    "agent name": "welcome",
    "name": "welcome",
    "identity": "coaching_identity",
    "coaching identity": "coaching_identity",
    "voice": "voice_calibration",
    "voice calibration": "voice_calibration",
    "decision": "decision_engine",
    "decision engine": "decision_engine",
    "philosophy": "training_philosophy",
    "training philosophy": "training_philosophy",
    "boundaries": "boundaries",
    "personal touch": "personal_touch_optional",
    "personal": "personal_touch_optional",
    "calibration": "final_calibration",
    "final calibration": "final_calibration",
}

STEP_SCENARIO_SUMMARY: dict[str, str] = {
    "coaching_identity": "Client is anxious before week 1 and afraid of failing again.",
    "voice_calibration": "Client missed sessions and feels behind.",
    "decision_engine": "Client has low sleep, high stress, mild pain, and limited time.",
    "training_philosophy": "Client asks for a shortcut that risks burnout.",
    "boundaries": "Client wants to push through sharp pain to stay on plan.",
    "personal_touch_optional": "Client needs a confidence boost before training.",
}

DISALLOWED_AGENT_NAMES = {
    "start",
    "continue",
    "resume",
    "retrain",
    "yes",
    "ok",
    "okay",
    "go",
    "skip",
    "pass",
}

STEP_TITLES = {
    "welcome": "Agent Naming",
    "coaching_identity": "Coaching Identity",
    "voice_calibration": "Voice Calibration",
    "decision_engine": "Decision Engine",
    "training_philosophy": "Training Philosophy",
    "boundaries": "Boundaries",
    "personal_touch_optional": "Personal Touch (Optional)",
    "final_calibration": "Final Calibration",
    "complete": "Complete",
}

VAGUE_MARKERS = (
    "not sure",
    "idk",
    "i don't know",
    "whatever",
    "anything",
    "maybe",
)

DECISION_FACTOR_ALIASES: dict[str, tuple[str, ...]] = {
    "sleep": ("sleep", "slept", "rest"),
    "stress": ("stress",),
    "pain": ("pain", "ache", "sore", "soreness"),
    "injury": ("injury", "injured", "strain", "sprain"),
    "schedule": ("schedule", "adherence", "consistency", "routine"),
    "time": ("time", "minutes", "availability", "available"),
    "motivation": ("motivation", "motivated", "drive"),
    "recovery": ("recovery", "fatigue", "readiness"),
    "equipment": ("equipment", "gym access", "home gym", "machine"),
}

URL_REGEX = re.compile(r"https?://\S+", re.IGNORECASE)
APPROVE_REGEX = re.compile(r"^approve\s*(?:#|sample\s*)?(\d+)?$", re.IGNORECASE)
REJECT_REGEX = re.compile(r"^reject\s*(?:#|sample\s*)?(\d+)$", re.IGNORECASE)
EDIT_SAMPLE_REGEX = re.compile(r"^edit\s*(?:#|sample\s*)?(\d+)\s*:\s*(.+)$", re.IGNORECASE | re.DOTALL)


@dataclass
class TrainerOnboardingTurnResult:
    assistant_message: str
    quick_replies: list[str]
    current_stage: str
    onboarding_complete: bool
    onboarding_status: str
    onboarding_progress: dict[str, Any]
    calibration_pending: bool
    profile_patch: dict[str, Any] = field(default_factory=dict)


class TrainerOnboardingService:
    def __init__(
        self,
        repository: TrainerOnboardingRepository,
        trainer_persona_repository: TrainerPersonaRepository,
        openai_client: OpenAIClient | None = None,
    ):
        self.repository = repository
        self.trainer_persona_repository = trainer_persona_repository
        self.openai_client = openai_client if openai_client is not None else self._init_openai_client()

    def storage_preflight(self) -> dict[str, Any]:
        return self.repository.storage_preflight()

    def handle_launch(
        self,
        trainer_context: TrainerContext,
        *,
        conversation_id: str,
        action: str | None,
        source_message_id: str | None = None,
    ) -> TrainerOnboardingTurnResult:
        trainer_id = trainer_context.trainer_id
        tenant_id = trainer_context.tenant_id
        if not trainer_id or not tenant_id:
            return TrainerOnboardingTurnResult(
                assistant_message="I could not resolve your trainer context. Please try again.",
                quick_replies=[],
                current_stage="welcome",
                onboarding_complete=False,
                onboarding_status=ONBOARDING_STATUS_NOT_STARTED,
                onboarding_progress=self._default_progress(),
                calibration_pending=False,
            )

        normalized_action = str(action or "continue").strip().lower()
        profile = self._get_or_create_profile(trainer_context)

        if normalized_action == "review":
            self._create_event(
                trainer_context,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                step_key="complete",
                action_type="captured",
                extracted_patch={"launch_action": "review"},
                confidence_score=1.0,
                actor_role="system",
            )
            return self._build_review_turn_result(trainer_context, profile)

        if normalized_action == "retrain":
            profile, state = self._start_retrain_draft(profile, trainer_context)
            self._create_event(
                trainer_context,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                step_key="welcome",
                action_type="edited",
                extracted_patch={"launch_action": "retrain"},
                confidence_score=1.0,
                actor_role="system",
            )
            prompt, quick_replies = STEP_PROMPTS["welcome"]
            return TrainerOnboardingTurnResult(
                assistant_message=(
                    "Retraining started. You are now retraining your coaching agent.\n"
                    "We will do this one question at a time.\n\n"
                    f"Step 1 of {TOTAL_STEPS}: {self._humanize_step('welcome')}\n{prompt}"
                ),
                quick_replies=quick_replies,
                current_stage="welcome",
                onboarding_complete=False,
                onboarding_status=ONBOARDING_STATUS_IN_PROGRESS,
                onboarding_progress=self._normalize_progress(state.get("onboarding_progress")),
                calibration_pending=False,
            )

        use_retrain_draft = self._has_retrain_draft(profile)
        state = self._state_from_profile(profile, use_retrain_draft=use_retrain_draft)
        current_step = self._normalize_progress(state.get("onboarding_progress")).get("current_step") or "welcome"

        self._create_event(
            trainer_context,
            conversation_id=conversation_id,
            source_message_id=source_message_id,
            step_key=current_step,
            action_type="captured",
            extracted_patch={"launch_action": normalized_action},
            confidence_score=1.0,
            actor_role="system",
        )

        if current_step == "final_calibration":
            return self._build_calibration_turn_result(state)

        if current_step == "complete":
            return self._build_complete_turn_result(state, include_edit_hint=True)

        if current_step not in STEP_PROMPTS:
            updated_progress = self._advance_progress(
                self._normalize_progress(state.get("onboarding_progress")),
                completed_step=None,
                next_step="welcome",
            )
            _profile, state = self._persist_state_patch(
                str(trainer_id),
                profile,
                state,
                {
                    "onboarding_status": ONBOARDING_STATUS_IN_PROGRESS,
                    "onboarding_progress": updated_progress,
                },
                use_retrain_draft=use_retrain_draft,
                force_retrain_started=use_retrain_draft,
            )
            prompt, quick_replies = STEP_PROMPTS["welcome"]
            return TrainerOnboardingTurnResult(
                assistant_message=f"Let's continue.\n\nStep 1 of {TOTAL_STEPS}: {self._humanize_step('welcome')}\n{prompt}",
                quick_replies=quick_replies,
                current_stage="welcome",
                onboarding_complete=False,
                onboarding_status=ONBOARDING_STATUS_IN_PROGRESS,
                onboarding_progress=self._normalize_progress(state.get("onboarding_progress")),
                calibration_pending=False,
            )

        prompt, quick_replies = STEP_PROMPTS[current_step]
        step_number = ONBOARDING_STEPS.index(current_step) + 1
        return TrainerOnboardingTurnResult(
            assistant_message=f"Resumed.\n\nStep {step_number} of {TOTAL_STEPS}: {self._humanize_step(current_step)}\n{prompt}",
            quick_replies=quick_replies,
            current_stage=current_step,
            onboarding_complete=False,
            onboarding_status=self._normalize_status(state.get("onboarding_status")),
            onboarding_progress=self._normalize_progress(state.get("onboarding_progress")),
            calibration_pending=bool(self._normalize_status(state.get("onboarding_status")) == ONBOARDING_STATUS_CALIBRATION_PENDING),
        )

    def process_turn(
        self,
        trainer_context: TrainerContext,
        *,
        conversation_id: str,
        user_message: str,
        source_message_id: str | None,
        force_restart: bool = False,
    ) -> TrainerOnboardingTurnResult:
        trainer_id = trainer_context.trainer_id
        tenant_id = trainer_context.tenant_id
        if not trainer_id or not tenant_id:
            return TrainerOnboardingTurnResult(
                assistant_message="I could not resolve your trainer context. Please try again.",
                quick_replies=[],
                current_stage="welcome",
                onboarding_complete=False,
                onboarding_status=ONBOARDING_STATUS_NOT_STARTED,
                onboarding_progress=self._default_progress(),
                calibration_pending=False,
            )

        profile = self._get_or_create_profile(trainer_context)
        use_retrain_draft = self._has_retrain_draft(profile)

        if force_restart:
            profile, state = self._start_retrain_draft(profile, trainer_context)
            use_retrain_draft = True
        else:
            state = self._state_from_profile(profile, use_retrain_draft=use_retrain_draft)

        progress = self._normalize_progress(state.get("onboarding_progress"))
        current_step = progress.get("current_step") or "welcome"
        cleaned_message = (user_message or "").strip()
        overlay_profile = self._state_overlay_profile(profile, state)

        sample_review_state = progress.get("sample_review_state")
        if sample_review_state == "pre_calibration_summary":
            return self._handle_pre_calibration_summary_turn(
                trainer_context,
                profile,
                state,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                use_retrain_draft=use_retrain_draft,
            )

        if sample_review_state in ("pending", "awaiting_edit"):
            return self._handle_sample_review_response(
                trainer_context,
                profile,
                state,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                message=cleaned_message,
                use_retrain_draft=use_retrain_draft,
            )

        if current_step == "final_calibration":
            return self._handle_final_calibration_step(
                trainer_context,
                profile,
                state,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                message=cleaned_message,
                use_retrain_draft=use_retrain_draft,
            )

        step_edit_target = self._parse_step_edit_intent(cleaned_message)
        if step_edit_target:
            return self._jump_to_step(
                trainer_context,
                profile,
                state,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                target_step=step_edit_target,
                use_retrain_draft=use_retrain_draft,
            )

        if current_step == "complete":
            self._create_event(
                trainer_context,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                step_key="complete",
                action_type="captured",
                extracted_patch={"message": cleaned_message},
                confidence_score=1.0 if cleaned_message else 0.8,
            )
            return self._build_complete_turn_result(state, include_edit_hint=True)

        if current_step not in STEP_PROMPTS:
            updated_progress = self._advance_progress(progress, completed_step=None, next_step="welcome")
            profile, state = self._persist_state_patch(
                str(trainer_id),
                profile,
                state,
                {
                    "onboarding_status": ONBOARDING_STATUS_IN_PROGRESS,
                    "onboarding_progress": updated_progress,
                },
                use_retrain_draft=use_retrain_draft,
                force_retrain_started=use_retrain_draft,
            )
            prompt, quick_replies = STEP_PROMPTS["welcome"]
            del profile
            return TrainerOnboardingTurnResult(
                assistant_message=f"Let's continue.\n\nStep 1 of {TOTAL_STEPS}: {self._humanize_step('welcome')}\n{prompt}",
                quick_replies=quick_replies,
                current_stage="welcome",
                onboarding_complete=False,
                onboarding_status=ONBOARDING_STATUS_IN_PROGRESS,
                onboarding_progress=self._normalize_progress(state.get("onboarding_progress")),
                calibration_pending=False,
            )

        if current_step == "personal_touch_optional" and self._is_skip_intent(cleaned_message):
            updated_progress = self._advance_progress(
                progress,
                completed_step="personal_touch_optional",
                next_step="final_calibration",
            )
            updated_progress["sample_review_state"] = "pre_calibration_summary"
            calibration_examples = self._generate_calibration_examples(overlay_profile)
            profile, state = self._persist_state_patch(
                str(trainer_id),
                profile,
                state,
                {
                    "onboarding_status": ONBOARDING_STATUS_CALIBRATION_PENDING,
                    "onboarding_progress": updated_progress,
                    "last_completed_step": "personal_touch_optional",
                    "calibration_examples": calibration_examples,
                },
                use_retrain_draft=use_retrain_draft,
                force_retrain_started=use_retrain_draft,
            )
            self._create_event(
                trainer_context,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                step_key="personal_touch_optional",
                action_type="skipped",
                extracted_patch={"skipped": True},
                confidence_score=1.0,
            )
            del profile
            return self._build_pre_calibration_summary_result(state)

        patch, confidence = self._extract_patch(current_step, cleaned_message, overlay_profile)
        if patch:
            profile, state = self._persist_state_patch(
                str(trainer_id),
                profile,
                state,
                patch,
                use_retrain_draft=use_retrain_draft,
                force_retrain_started=use_retrain_draft,
            )
            overlay_profile = self._state_overlay_profile(profile, state)

        if confidence < LOW_CONFIDENCE_THRESHOLD:
            clarifier = CLARIFIER_PROMPTS.get(current_step) or "Can you give a bit more detail?"
            clarifier_progress = {**progress, "current_step": current_step}
            profile, state = self._persist_state_patch(
                str(trainer_id),
                profile,
                state,
                {
                    "onboarding_status": ONBOARDING_STATUS_IN_PROGRESS,
                    "onboarding_progress": clarifier_progress,
                },
                use_retrain_draft=use_retrain_draft,
                force_retrain_started=use_retrain_draft,
            )
            self._create_event(
                trainer_context,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                step_key=current_step,
                action_type="clarified",
                extracted_patch=patch,
                confidence_score=confidence,
            )
            _, quick_replies = STEP_PROMPTS[current_step]
            del profile
            return TrainerOnboardingTurnResult(
                assistant_message=f"Thanks. I need one clearer signal before I lock this in.\n\n{clarifier}",
                quick_replies=quick_replies,
                current_stage=current_step,
                onboarding_complete=False,
                onboarding_status=ONBOARDING_STATUS_IN_PROGRESS,
                onboarding_progress=self._normalize_progress(state.get("onboarding_progress")),
                calibration_pending=False,
            )

        step_preview = self._build_step_preview_payload(current_step, overlay_profile)
        has_preview = bool(step_preview and step_preview.get("sample_response"))

        if has_preview:
            review_progress = {**progress, "sample_review_state": "pending"}
            profile, state = self._persist_state_patch(
                str(trainer_id),
                profile,
                state,
                {
                    "onboarding_status": ONBOARDING_STATUS_IN_PROGRESS,
                    "onboarding_progress": review_progress,
                    "last_completed_step": progress.get("last_completed_step"),
                },
                use_retrain_draft=use_retrain_draft,
                force_retrain_started=use_retrain_draft,
            )
            self._create_event(
                trainer_context,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                step_key=current_step,
                action_type="captured",
                extracted_patch=patch,
                confidence_score=confidence,
            )
            del profile
            return TrainerOnboardingTurnResult(
                assistant_message=(
                    f"Here's how your coach would sound in that situation:\n\n"
                    f"\"{step_preview['sample_response']}\"\n\n"
                    f"Does that sound like you?"
                ),
                quick_replies=["Yeah, that's me", "I'd say it differently", "Skip"],
                current_stage=current_step,
                onboarding_complete=False,
                onboarding_status=ONBOARDING_STATUS_IN_PROGRESS,
                onboarding_progress=self._normalize_progress(state.get("onboarding_progress")),
                calibration_pending=False,
                profile_patch=self._build_onboarding_profile_patch(step_preview=step_preview),
            )

        # No preview available — advance immediately
        next_step = self._next_step(current_step)
        updated_progress = self._advance_progress(progress, completed_step=current_step, next_step=next_step)

        if next_step == "final_calibration":
            updated_progress["sample_review_state"] = "pre_calibration_summary"
            calibration_examples = self._generate_calibration_examples(overlay_profile)
            profile, state = self._persist_state_patch(
                str(trainer_id),
                profile,
                state,
                {
                    "onboarding_status": ONBOARDING_STATUS_CALIBRATION_PENDING,
                    "onboarding_progress": updated_progress,
                    "last_completed_step": current_step,
                    "calibration_examples": calibration_examples,
                },
                use_retrain_draft=use_retrain_draft,
                force_retrain_started=use_retrain_draft,
            )
            self._create_event(
                trainer_context,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                step_key=current_step,
                action_type="captured",
                extracted_patch=patch,
                confidence_score=confidence,
            )
            del profile
            return self._build_pre_calibration_summary_result(state)

        profile, state = self._persist_state_patch(
            str(trainer_id),
            profile,
            state,
            {
                "onboarding_status": ONBOARDING_STATUS_IN_PROGRESS,
                "onboarding_progress": updated_progress,
                "last_completed_step": current_step,
            },
            use_retrain_draft=use_retrain_draft,
            force_retrain_started=use_retrain_draft,
        )
        self._create_event(
            trainer_context,
            conversation_id=conversation_id,
            source_message_id=source_message_id,
            step_key=current_step,
            action_type="captured",
            extracted_patch=patch,
            confidence_score=confidence,
        )
        prompt, quick_replies = STEP_PROMPTS[next_step]
        step_number = ONBOARDING_STEPS.index(next_step) + 1
        del profile
        return TrainerOnboardingTurnResult(
            assistant_message=f"Step {step_number} of {TOTAL_STEPS}: {self._humanize_step(next_step)}\n{prompt}",
            quick_replies=quick_replies,
            current_stage=next_step,
            onboarding_complete=False,
            onboarding_status=ONBOARDING_STATUS_IN_PROGRESS,
            onboarding_progress=self._normalize_progress(state.get("onboarding_progress")),
            calibration_pending=False,
        )

    def _handle_sample_review_response(
        self,
        trainer_context: TrainerContext,
        profile: dict[str, Any],
        state: dict[str, Any],
        *,
        conversation_id: str,
        source_message_id: str | None,
        message: str,
        use_retrain_draft: bool,
    ) -> "TrainerOnboardingTurnResult":
        progress = self._normalize_progress(state.get("onboarding_progress"))
        review_state = progress.get("sample_review_state")
        current_step = progress.get("current_step") or "welcome"
        trainer_id = str(trainer_context.trainer_id)
        msg = message.lower().strip()

        if review_state == "awaiting_edit":
            if msg in SAMPLE_SKIP_SIGNALS:
                self._create_event(
                    trainer_context,
                    conversation_id=conversation_id,
                    source_message_id=source_message_id,
                    step_key=current_step,
                    action_type="skipped",
                    extracted_patch={"sample_skipped": True, "step_key": current_step},
                    confidence_score=1.0,
                )
            else:
                self._create_event(
                    trainer_context,
                    conversation_id=conversation_id,
                    source_message_id=source_message_id,
                    step_key=current_step,
                    action_type="edited",
                    extracted_patch={"edited_response": message, "trainer_note": message, "step_key": current_step},
                    confidence_score=0.95,
                )
            return self._advance_from_sample_review(
                trainer_id, profile, state,
                current_step=current_step,
                use_retrain_draft=use_retrain_draft,
            )

        # review_state == "pending"
        if msg in SAMPLE_APPROVE_SIGNALS:
            self._create_event(
                trainer_context,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                step_key=current_step,
                action_type="captured",
                extracted_patch={"sample_approved": True, "step_key": current_step},
                confidence_score=1.0,
            )
            return self._advance_from_sample_review(
                trainer_id, profile, state,
                current_step=current_step,
                use_retrain_draft=use_retrain_draft,
            )

        if msg in SAMPLE_EDIT_SIGNALS:
            updated = {**progress, "sample_review_state": "awaiting_edit"}
            _, state_ = self._persist_state_patch(
                trainer_id,
                profile,
                state,
                {"onboarding_progress": updated},
                use_retrain_draft=use_retrain_draft,
            )
            return TrainerOnboardingTurnResult(
                assistant_message="Tell me how you'd put it — type your version and I'll save it.",
                quick_replies=["Never mind, skip"],
                current_stage=current_step,
                onboarding_complete=False,
                onboarding_status=ONBOARDING_STATUS_IN_PROGRESS,
                onboarding_progress=self._normalize_progress(state_.get("onboarding_progress")),
                calibration_pending=False,
                profile_patch=self._build_onboarding_profile_patch(sample_review_state="awaiting_edit"),
            )

        if msg in SAMPLE_SKIP_SIGNALS:
            self._create_event(
                trainer_context,
                conversation_id=conversation_id,
                source_message_id=source_message_id,
                step_key=current_step,
                action_type="skipped",
                extracted_patch={"sample_skipped": True, "step_key": current_step},
                confidence_score=1.0,
            )
            return self._advance_from_sample_review(
                trainer_id, profile, state,
                current_step=current_step,
                use_retrain_draft=use_retrain_draft,
            )

        return TrainerOnboardingTurnResult(
            assistant_message="Does that sound like you?",
            quick_replies=["Yeah, that's me", "I'd say it differently", "Skip"],
            current_stage=current_step,
            onboarding_complete=False,
            onboarding_status=ONBOARDING_STATUS_IN_PROGRESS,
            onboarding_progress=self._normalize_progress(state.get("onboarding_progress")),
            calibration_pending=False,
        )

    def _advance_from_sample_review(
        self,
        trainer_id: str,
        profile: dict[str, Any],
        state: dict[str, Any],
        *,
        current_step: str,
        use_retrain_draft: bool,
    ) -> "TrainerOnboardingTurnResult":
        progress = self._normalize_progress(state.get("onboarding_progress"))
        next_step = self._next_step(current_step)

        if next_step == "final_calibration":
            overlay_profile = self._state_overlay_profile(profile, state)
            calibration_examples = self._generate_calibration_examples(overlay_profile)
            updated_progress = self._advance_progress(
                progress, completed_step=current_step, next_step="final_calibration",
            )
            updated_progress["sample_review_state"] = "pre_calibration_summary"
            profile, state = self._persist_state_patch(
                trainer_id, profile, state,
                {
                    "onboarding_status": ONBOARDING_STATUS_CALIBRATION_PENDING,
                    "onboarding_progress": updated_progress,
                    "last_completed_step": current_step,
                    "calibration_examples": calibration_examples,
                },
                use_retrain_draft=use_retrain_draft,
                force_retrain_started=use_retrain_draft,
            )
            del profile
            return self._build_pre_calibration_summary_result(state)

        updated_progress = self._advance_progress(
            progress, completed_step=current_step, next_step=next_step,
        )
        updated_progress.pop("sample_review_state", None)
        profile, state = self._persist_state_patch(
            trainer_id, profile, state,
            {
                "onboarding_status": ONBOARDING_STATUS_IN_PROGRESS,
                "onboarding_progress": updated_progress,
                "last_completed_step": current_step,
            },
            use_retrain_draft=use_retrain_draft,
            force_retrain_started=use_retrain_draft,
        )
        prompt, quick_replies = STEP_PROMPTS[next_step]
        step_number = ONBOARDING_STEPS.index(next_step) + 1
        del profile
        return TrainerOnboardingTurnResult(
            assistant_message=f"Step {step_number} of {TOTAL_STEPS}: {self._humanize_step(next_step)}\n{prompt}",
            quick_replies=quick_replies,
            current_stage=next_step,
            onboarding_complete=False,
            onboarding_status=ONBOARDING_STATUS_IN_PROGRESS,
            onboarding_progress=self._normalize_progress(state.get("onboarding_progress")),
            calibration_pending=False,
        )

    def _handle_final_calibration_step(
        self,
        trainer_context: TrainerContext,
        profile: dict[str, Any],
        state: dict[str, Any],
        *,
        conversation_id: str,
        source_message_id: str | None,
        message: str,
        use_retrain_draft: bool,
    ) -> TrainerOnboardingTurnResult:
        trainer_id = str(trainer_context.trainer_id or "")
        progress = self._normalize_progress(state.get("onboarding_progress"))
        calibration_examples = self._normalize_calibration_examples(state.get("calibration_examples"))

        if not calibration_examples:
            calibration_examples = self._generate_calibration_examples(self._state_overlay_profile(profile, state))
            profile, state = self._persist_state_patch(
                trainer_id,
                profile,
                state,
                {"calibration_examples": calibration_examples},
                use_retrain_draft=use_retrain_draft,
                force_retrain_started=use_retrain_draft,
            )
            calibration_examples = self._normalize_calibration_examples(state.get("calibration_examples"))

        lowered = message.lower().strip()
        action = "clarified"
        confidence = 0.4

        approve_match = APPROVE_REGEX.match(lowered)
        reject_match = REJECT_REGEX.match(lowered)
        edit_match = EDIT_SAMPLE_REGEX.match(message.strip())

        if lowered in {"approve all", "approve"}:
            for sample in calibration_examples:
                sample["status"] = "approved"
            action = "approved"
            confidence = 0.95
        elif approve_match and approve_match.group(1):
            index = int(approve_match.group(1)) - 1
            if 0 <= index < len(calibration_examples):
                calibration_examples[index]["status"] = "approved"
                action = "approved"
                confidence = 0.92
        elif reject_match:
            index = int(reject_match.group(1)) - 1
            if 0 <= index < len(calibration_examples):
                calibration_examples[index] = self._regenerate_calibration_example(
                    calibration_examples[index],
                    self._state_overlay_profile(profile, state),
                    index,
                )
                action = "rejected"
                confidence = 0.9
        elif edit_match:
            index = int(edit_match.group(1)) - 1
            edited_response = edit_match.group(2).strip()
            if 0 <= index < len(calibration_examples) and edited_response:
                calibration_examples[index]["edited_response"] = edited_response
                calibration_examples[index]["response"] = edited_response
                calibration_examples[index]["status"] = "approved"
                calibration_examples[index]["generation_source"] = "trainer_edit"
                action = "edited"
                confidence = 0.95
        elif "regenerate" in lowered:
            calibration_examples = self._generate_calibration_examples(self._state_overlay_profile(profile, state))
            action = "rejected"
            confidence = 0.85

        if self._all_calibration_examples_approved(calibration_examples):
            completed_progress = self._advance_progress(
                progress,
                completed_step="final_calibration",
                next_step="complete",
            )
            completed_progress["completed_steps"] = TOTAL_STEPS
            completed_progress["current_step"] = "complete"
            completed_state_patch = {
                "onboarding_status": ONBOARDING_STATUS_COMPLETED,
                "onboarding_progress": completed_progress,
                "last_completed_step": "final_calibration",
                "calibration_examples": calibration_examples,
            }

            if use_retrain_draft:
                completed_draft_state = self._normalize_state({**state, **completed_state_patch})
                completed_profile = self._promote_retrain_draft(
                    trainer_id,
                    profile,
                    completed_draft_state,
                )
                self._create_event(
                    trainer_context,
                    conversation_id=conversation_id,
                    source_message_id=source_message_id,
                    step_key="final_calibration",
                    action_type="approved",
                    extracted_patch={"calibration_examples": calibration_examples, "retrain_promoted": True},
                    confidence_score=1.0,
                )
                self._mirror_to_trainer_persona(trainer_context, completed_profile)
                completed_state = self._state_from_profile(completed_profile, use_retrain_draft=False)
            else:
                completed_profile, completed_state = self._persist_state_patch(
                    trainer_id,
                    profile,
                    state,
                    completed_state_patch,
                    use_retrain_draft=False,
                )
                self._create_event(
                    trainer_context,
                    conversation_id=conversation_id,
                    source_message_id=source_message_id,
                    step_key="final_calibration",
                    action_type="approved",
                    extracted_patch={"calibration_examples": calibration_examples},
                    confidence_score=1.0,
                )
                self._mirror_to_trainer_persona(trainer_context, completed_profile)

            completed_identity = self._as_dict(completed_state.get("identity"))
            agent_name = str(completed_identity.get("agent_name") or "Your coach").strip()
            return TrainerOnboardingTurnResult(
                assistant_message=(
                    f"{agent_name} is live.\n\n"
                    "Next: review coach settings or retrain from Home any time."
                ),
                quick_replies=["Review coach settings", "Retrain coach"],
                current_stage="complete",
                onboarding_complete=True,
                onboarding_status=ONBOARDING_STATUS_COMPLETED,
                onboarding_progress=self._normalize_progress(completed_state.get("onboarding_progress")),
                calibration_pending=False,
            )

        profile, state = self._persist_state_patch(
            trainer_id,
            profile,
            state,
            {
                "onboarding_status": ONBOARDING_STATUS_CALIBRATION_PENDING,
                "onboarding_progress": {
                    **progress,
                    "current_step": "final_calibration",
                },
                "calibration_examples": calibration_examples,
            },
            use_retrain_draft=use_retrain_draft,
            force_retrain_started=use_retrain_draft,
        )
        self._create_event(
            trainer_context,
            conversation_id=conversation_id,
            source_message_id=source_message_id,
            step_key="final_calibration",
            action_type=action,
            extracted_patch={"calibration_examples": calibration_examples},
            confidence_score=confidence,
        )
        del profile
        return self._build_calibration_turn_result(state)

    def _build_pre_calibration_summary_result(
        self,
        state: dict[str, Any],
    ) -> TrainerOnboardingTurnResult:
        progress = self._normalize_progress(state.get("onboarding_progress"))
        identity = self._as_dict(state.get("identity"))
        tone = self._as_dict(state.get("tone"))
        decision_weights = self._as_dict(state.get("decision_weights"))
        philosophy = self._as_dict(state.get("philosophy"))
        boundaries = self._as_dict(state.get("boundaries"))

        agent_name = str(identity.get("agent_name") or "Your coach").strip()
        identity_summary = str(identity.get("summary") or "Not set yet").strip()
        tone_summary = str(tone.get("style") or "Not set yet").strip()
        philosophy_summary = str(philosophy.get("summary") or "Not set yet").strip()

        ranked_factors = self._as_list(decision_weights.get("ranked_factors"))
        decision_summary = ", ".join([str(f) for f in ranked_factors[:3]]) if ranked_factors else "not set yet"

        hard_bounds = self._as_list(boundaries.get("hard"))
        soft_bounds = self._as_list(boundaries.get("soft"))
        hard_summary = str(hard_bounds[0]) if hard_bounds else "not set"
        soft_summary = str(soft_bounds[0]) if soft_bounds else "not set"

        lines = [
            f"Steps 1-7 locked in. Here is {agent_name}'s profile:",
            f"Identity: {identity_summary}",
            f"Voice: {tone_summary}",
            f"Priorities: {decision_summary}",
            f"Philosophy: {philosophy_summary}",
            f"Hard boundary: {hard_summary}",
            f"Soft boundary: {soft_summary}",
            "",
            "One step left: approve 3 sample responses to confirm the voice is right.",
        ]
        return TrainerOnboardingTurnResult(
            assistant_message="\n".join(lines),
            quick_replies=["Let's do it"],
            current_stage="final_calibration",
            onboarding_complete=False,
            onboarding_status=ONBOARDING_STATUS_CALIBRATION_PENDING,
            onboarding_progress=progress,
            calibration_pending=True,
            profile_patch=self._build_onboarding_profile_patch(
                identity=identity if identity.get("agent_name") else None,
            ),
        )

    def _handle_pre_calibration_summary_turn(
        self,
        trainer_context: TrainerContext,
        profile: dict[str, Any],
        state: dict[str, Any],
        *,
        conversation_id: str,
        source_message_id: str | None,
        use_retrain_draft: bool,
    ) -> TrainerOnboardingTurnResult:
        trainer_id = str(trainer_context.trainer_id or "")
        progress = self._normalize_progress(state.get("onboarding_progress"))
        updated_progress = {k: v for k, v in progress.items() if k != "sample_review_state"}
        _profile, updated_state = self._persist_state_patch(
            trainer_id,
            profile,
            state,
            {
                "onboarding_status": ONBOARDING_STATUS_CALIBRATION_PENDING,
                "onboarding_progress": updated_progress,
            },
            use_retrain_draft=use_retrain_draft,
            force_retrain_started=use_retrain_draft,
        )
        self._create_event(
            trainer_context,
            conversation_id=conversation_id,
            source_message_id=source_message_id,
            step_key="final_calibration",
            action_type="captured",
            extracted_patch={"summary_acknowledged": True},
            confidence_score=1.0,
        )
        del _profile
        return self._build_calibration_turn_result(updated_state)

    def _build_review_turn_result(self, trainer_context: TrainerContext, profile: dict[str, Any]) -> TrainerOnboardingTurnResult:
        active_state = self._state_from_profile(profile, use_retrain_draft=False)
        has_retrain_draft = self._has_retrain_draft(profile)
        working_state = self._state_from_profile(profile, use_retrain_draft=has_retrain_draft)
        assistant_message = self._build_review_summary_message(
            trainer_context,
            active_state,
            working_state if has_retrain_draft else None,
        )
        working_status = self._normalize_status(working_state.get("onboarding_status"))
        working_progress = self._normalize_progress(working_state.get("onboarding_progress"))
        onboarding_complete = bool(working_status == ONBOARDING_STATUS_COMPLETED and not has_retrain_draft)

        quick_replies = ["Edit voice", "Edit decision", "Edit boundaries", "Retrain coach"]
        if has_retrain_draft:
            quick_replies = ["Resume onboarding", "Edit voice", "Edit boundaries", "Retrain coach"]

        return TrainerOnboardingTurnResult(
            assistant_message=assistant_message,
            quick_replies=quick_replies,
            current_stage=working_progress.get("current_step") or "complete",
            onboarding_complete=onboarding_complete,
            onboarding_status=working_status,
            onboarding_progress=working_progress,
            calibration_pending=bool(working_status == ONBOARDING_STATUS_CALIBRATION_PENDING),
        )

    def _build_review_summary_message(
        self,
        trainer_context: TrainerContext,
        active_state: dict[str, Any],
        draft_state: dict[str, Any] | None,
    ) -> str:
        trainer_id = trainer_context.trainer_id
        persona = self.trainer_persona_repository.get_default_by_trainer(str(trainer_id)) if trainer_id else None
        persona_communication = self._as_dict((persona or {}).get("communication_rules"))
        persona_onboarding = self._as_dict((persona or {}).get("onboarding_preferences"))
        persona_answers = self._as_dict(persona_onboarding.get("trainer_onboarding_answers"))

        identity = self._as_dict(active_state.get("identity"))
        tone = self._as_dict(active_state.get("tone"))
        decision_weights = self._as_dict(active_state.get("decision_weights"))
        philosophy = self._as_dict(active_state.get("philosophy"))
        boundaries = self._as_dict(active_state.get("boundaries"))
        calibration_examples = self._normalize_calibration_examples(active_state.get("calibration_examples"))
        agent_name = str(
            identity.get("agent_name")
            or (persona or {}).get("persona_name")
            or trainer_context.trainer_display_name
            or "Not set yet"
        ).strip()

        identity_summary = str(
            identity.get("summary")
            or self._as_dict(persona_communication.get("identity")).get("summary")
            or self._as_dict(persona_answers.get("coaching_identity")).get("summary")
            or "Not set yet"
        ).strip()
        tone_summary = str(
            tone.get("style")
            or (persona or {}).get("tone_description")
            or "Not set yet"
        ).strip()
        philosophy_summary = str(
            philosophy.get("summary")
            or (persona or {}).get("coaching_philosophy")
            or "Not set yet"
        ).strip()

        ranked_factors = self._as_list(decision_weights.get("ranked_factors"))
        decision_summary = ", ".join([str(item) for item in ranked_factors[:5]]) if ranked_factors else "Not set yet"

        non_negotiables = self._as_list(active_state.get("non_negotiables"))
        non_negotiables_summary = "; ".join([str(item) for item in non_negotiables[:3]]) if non_negotiables else "Not set yet"

        hard_bounds = self._as_list(boundaries.get("hard"))
        guardrail_bounds = self._as_list(boundaries.get("guardrail"))
        soft_bounds = self._as_list(boundaries.get("soft"))
        hard_summary = "; ".join([str(item) for item in hard_bounds[:2]]) if hard_bounds else "Not set yet"
        guardrail_summary = "; ".join([str(item) for item in guardrail_bounds[:2]]) if guardrail_bounds else "Not set yet"
        soft_summary = "; ".join([str(item) for item in soft_bounds[:2]]) if soft_bounds else "Not set yet"

        approved_count = sum(1 for item in calibration_examples if str(item.get("status") or "").lower() == "approved")
        calibration_total = len(calibration_examples)
        calibration_summary = (
            f"{approved_count} of {calibration_total} approved"
            if calibration_total
            else "No calibration examples saved yet"
        )

        lines = [
            "Current coach settings:",
            f"Agent name: {agent_name}",
            f"Identity: {identity_summary}",
            f"Voice and tone: {tone_summary}",
            f"Decision priorities: {decision_summary}",
            f"Philosophy: {philosophy_summary}",
            f"Non-negotiables: {non_negotiables_summary}",
            f"Hard boundaries: {hard_summary}",
            f"Guardrail boundaries: {guardrail_summary}",
            f"Soft boundaries: {soft_summary}",
            f"Calibration: {calibration_summary}",
        ]

        if draft_state:
            draft_progress = self._normalize_progress(draft_state.get("onboarding_progress"))
            lines.append(
                ""
            )
            lines.append(
                "Retrain draft is in progress: "
                f"{draft_progress.get('completed_steps', 0)} of {draft_progress.get('total_steps', TOTAL_STEPS)} steps "
                f"(current: {self._humanize_step(str(draft_progress.get('current_step') or 'welcome'))})."
            )

        lines.append("")
        lines.append("Reply with 'edit voice', 'edit decision', or 'edit boundaries' to update a section.")
        return "\n".join(lines)

    def _build_complete_turn_result(self, state: dict[str, Any], *, include_edit_hint: bool) -> TrainerOnboardingTurnResult:
        message = "Your coaching profile is complete."
        if include_edit_hint:
            message = (
                "Your coaching profile is complete.\n\n"
                "Reply with 'edit voice', 'edit decision', or 'edit boundaries' to refine specific sections, "
                "or use Retrain coach from Home to start fresh."
            )
        return TrainerOnboardingTurnResult(
            assistant_message=message,
            quick_replies=["Review coach settings", "Edit voice", "Edit decision", "Retrain coach"],
            current_stage="complete",
            onboarding_complete=True,
            onboarding_status=ONBOARDING_STATUS_COMPLETED,
            onboarding_progress=self._normalize_progress(state.get("onboarding_progress")),
            calibration_pending=False,
        )

    def _build_calibration_turn_result(
        self,
        state: dict[str, Any],
        *,
        step_preview: dict[str, Any] | None = None,
    ) -> TrainerOnboardingTurnResult:
        progress = self._normalize_progress(state.get("onboarding_progress"))
        calibration_examples = self._normalize_calibration_examples(state.get("calibration_examples"))
        calibration_checklist = self._build_calibration_checklist_payload(calibration_examples)
        identity = self._as_dict(state.get("identity"))
        assistant_message = "Step 8 of 8: Final Calibration\nApprove each sample to set your coach's voice."
        return TrainerOnboardingTurnResult(
            assistant_message=assistant_message,
            quick_replies=[],
            current_stage="final_calibration",
            onboarding_complete=False,
            onboarding_status=ONBOARDING_STATUS_CALIBRATION_PENDING,
            onboarding_progress=progress,
            calibration_pending=True,
            profile_patch=self._build_onboarding_profile_patch(
                step_preview=step_preview,
                calibration_checklist=calibration_checklist,
                identity=identity if identity.get("agent_name") else None,
            ),
        )

    def _build_onboarding_profile_patch(
        self,
        *,
        step_preview: dict[str, Any] | None = None,
        calibration_checklist: dict[str, Any] | None = None,
        sample_review_state: str | None = None,
        identity: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        trainer_payload: dict[str, Any] = {}
        if step_preview:
            trainer_payload["step_preview"] = step_preview
        if calibration_checklist:
            trainer_payload["calibration_checklist"] = calibration_checklist
        if sample_review_state:
            trainer_payload["sample_review_state"] = sample_review_state
        if identity:
            trainer_payload["identity"] = identity
        if not trainer_payload:
            return {}
        return {"trainer_onboarding": trainer_payload}

    def _build_calibration_checklist_payload(self, calibration_examples: list[dict[str, Any]]) -> dict[str, Any]:
        approved_count = sum(1 for item in calibration_examples if str(item.get("status") or "").lower() == "approved")
        first_pending_idx: int | None = None
        for idx, sample in enumerate(calibration_examples):
            if str(sample.get("status") or "pending").lower() != "approved":
                first_pending_idx = idx
                break
        samples = []
        for index, sample in enumerate(calibration_examples, start=1):
            status = str(sample.get("status") or "pending").lower()
            is_approved = status == "approved"
            is_active = first_pending_idx is not None and (index - 1) == first_pending_idx
            if not is_approved and not is_active:
                continue
            samples.append(
                {
                    "index": index,
                    "id": str(sample.get("id") or f"sample_{index}"),
                    "scenario": str(sample.get("scenario") or "Scenario not set"),
                    "response": str(sample.get("response") or ""),
                    "status": status,
                    "generation_source": str(sample.get("generation_source") or "template_fallback"),
                    "is_active": is_active,
                }
            )
        return {
            "approved_count": approved_count,
            "total": len(calibration_examples),
            "visible_count": len(samples),
            "samples": samples,
            "commands": {
                "approve": "approve <n>",
                "regenerate": "reject <n>",
                "approve_all": "approve all",
                "edit": "edit <n>: <your version>",
            },
        }

    def _jump_to_step(
        self,
        trainer_context: TrainerContext,
        profile: dict[str, Any],
        state: dict[str, Any],
        *,
        conversation_id: str,
        source_message_id: str | None,
        target_step: str,
        use_retrain_draft: bool,
    ) -> TrainerOnboardingTurnResult:
        trainer_id = str(trainer_context.trainer_id or "")
        progress = self._normalize_progress(state.get("onboarding_progress"))
        completed_step_keys = [
            step for step in progress.get("completed_step_keys", [])
            if ONBOARDING_STEPS.index(step) < ONBOARDING_STEPS.index(target_step)
        ]
        updated_progress = {
            **progress,
            "completed_step_keys": completed_step_keys,
            "completed_steps": len(completed_step_keys),
            "current_step": target_step,
            "last_completed_step": completed_step_keys[-1] if completed_step_keys else None,
        }

        patch: dict[str, Any] = {
            "onboarding_status": ONBOARDING_STATUS_IN_PROGRESS,
            "onboarding_progress": updated_progress,
            "last_completed_step": updated_progress.get("last_completed_step"),
        }

        if target_step == "final_calibration" and not self._normalize_calibration_examples(state.get("calibration_examples")):
            patch["calibration_examples"] = self._generate_calibration_examples(self._state_overlay_profile(profile, state))
            patch["onboarding_status"] = ONBOARDING_STATUS_CALIBRATION_PENDING

        updated_profile, updated_state = self._persist_state_patch(
            trainer_id,
            profile,
            state,
            patch,
            use_retrain_draft=use_retrain_draft,
            force_retrain_started=use_retrain_draft,
        )
        del updated_profile

        self._create_event(
            trainer_context,
            conversation_id=conversation_id,
            source_message_id=source_message_id,
            step_key=target_step,
            action_type="edited",
            extracted_patch={"jump_to_step": target_step},
            confidence_score=1.0,
        )

        if target_step == "final_calibration":
            return self._build_calibration_turn_result(updated_state)

        prompt, quick_replies = STEP_PROMPTS[target_step]
        return TrainerOnboardingTurnResult(
            assistant_message=f"Reopened {self._humanize_step(target_step)}.\n\n{prompt}",
            quick_replies=quick_replies,
            current_stage=target_step,
            onboarding_complete=False,
            onboarding_status=ONBOARDING_STATUS_IN_PROGRESS,
            onboarding_progress=self._normalize_progress(updated_state.get("onboarding_progress")),
            calibration_pending=False,
        )

    def _extract_patch(self, step: str, message: str, overlay_profile: dict[str, Any]) -> tuple[dict[str, Any], float]:
        normalized = message.strip()
        patch: dict[str, Any] = {}

        if step == "welcome":
            agent_name = self._extract_agent_name(normalized)
            if agent_name:
                identity = self._as_dict(overlay_profile.get("identity"))
                identity["agent_name"] = agent_name
                communication = self._as_dict(overlay_profile.get("communication_preferences"))
                communication["agent_name"] = agent_name
                patch = {
                    "identity": identity,
                    "communication_preferences": communication,
                }
        elif step == "coaching_identity":
            identity = self._as_dict(overlay_profile.get("identity"))
            identity["summary"] = normalized
            communication = self._as_dict(overlay_profile.get("communication_preferences"))
            communication["identity_notes"] = normalized
            scenario_rules = self._append_scenario_rule(overlay_profile, step, normalized)
            patch = {
                "identity": identity,
                "communication_preferences": communication,
                "scenario_rules": scenario_rules,
            }
        elif step == "voice_calibration":
            tone = self._as_dict(overlay_profile.get("tone"))
            tone["style"] = normalized
            communication = self._as_dict(overlay_profile.get("communication_preferences"))
            communication["voice_notes"] = normalized
            examples = self._as_list(overlay_profile.get("coaching_examples"))
            examples.append({"type": "voice_calibration", "text": normalized})
            scenario_rules = self._append_scenario_rule(overlay_profile, step, normalized)
            patch = {
                "tone": tone,
                "communication_preferences": communication,
                "coaching_examples": examples[-12:],
                "scenario_rules": scenario_rules,
            }
        elif step == "decision_engine":
            weights = self._extract_decision_weights(normalized)
            scenario_rules = self._append_scenario_rule(overlay_profile, step, normalized)
            patch = {
                "decision_weights": weights,
                "scenario_rules": scenario_rules,
            }
        elif step == "training_philosophy":
            philosophy = self._as_dict(overlay_profile.get("philosophy"))
            philosophy["summary"] = normalized
            scenario_rules = self._append_scenario_rule(overlay_profile, step, normalized)
            patch = {
                "philosophy": philosophy,
                "non_negotiables": self._extract_non_negotiables(normalized),
                "scenario_rules": scenario_rules,
            }
        elif step == "boundaries":
            boundaries = self._extract_boundaries(normalized, overlay_profile.get("boundaries"))
            scenario_rules = self._append_scenario_rule(overlay_profile, step, normalized)
            patch = {
                "boundaries": boundaries,
                "scenario_rules": scenario_rules,
            }
        elif step == "personal_touch_optional":
            coaching_examples = self._as_list(overlay_profile.get("coaching_examples"))
            coaching_examples.append({"type": "personal_touch", "text": normalized})
            media_assets = self._as_list(overlay_profile.get("media_assets"))
            media_assets.extend(self._extract_media_assets(normalized))
            scenario_rules = self._append_scenario_rule(overlay_profile, step, normalized)
            patch = {
                "coaching_examples": coaching_examples[-16:],
                "media_assets": media_assets[-16:],
                "scenario_rules": scenario_rules,
            }

        confidence = self._estimate_confidence(step, normalized, patch)
        return patch, confidence

    def _extract_agent_name(self, text: str) -> str | None:
        candidate = text.strip().strip('"').strip("'").strip()
        if not candidate:
            return None

        pattern = re.compile(
            r"(?:call\s+(?:it|him|her)\s+|name(?:\s+it)?\s+)([a-z0-9][a-z0-9\-' ]{1,40})",
            flags=re.IGNORECASE,
        )
        match = pattern.search(candidate)
        if match:
            candidate = match.group(1).strip()
        elif len(candidate.split()) > 4:
            return None

        candidate = re.sub(r"[\.\,\!\?\:\;]+$", "", candidate).strip()
        normalized = candidate.lower()
        if normalized in DISALLOWED_AGENT_NAMES:
            return None
        if len(candidate) < 2 or len(candidate) > 32:
            return None
        if not re.search(r"[a-z0-9]", candidate, flags=re.IGNORECASE):
            return None
        return candidate

    def _append_scenario_rule(self, overlay_profile: dict[str, Any], step: str, text: str) -> list[dict[str, Any]]:
        scenario_rules = self._as_list(overlay_profile.get("scenario_rules"))
        scenario_rules.append(
            {
                "step": step,
                "scenario": STEP_SCENARIO_SUMMARY.get(step, "General coaching scenario"),
                "rule": text[:400],
            }
        )
        return scenario_rules[-20:]

    def _estimate_confidence(self, step: str, text: str, patch: dict[str, Any]) -> float:
        lowered = text.lower().strip()
        if not lowered:
            return 0.05
        if any(marker in lowered for marker in VAGUE_MARKERS):
            return 0.3

        # Exact quick_reply selection — treat as authoritative regardless of length.
        step_entry = STEP_PROMPTS.get(step)
        if step_entry:
            quick_replies = step_entry[1]
            if any(lowered == qr.lower().strip() for qr in quick_replies):
                return 0.90

        if step == "welcome":
            identity = self._as_dict(patch.get("identity"))
            agent_name = str(identity.get("agent_name") or "").strip()
            if not agent_name:
                return 0.2
            if len(agent_name) < 3 or len(agent_name) > 32:
                return 0.35
            if len(agent_name.split()) > 4:
                return 0.4
            return 0.92

        base = 0.82
        if len(lowered) < 25:
            base -= 0.16
        if len(lowered.split()) < 6:
            base -= 0.1

        if step == "decision_engine":
            ranked = self._as_dict(patch.get("decision_weights")).get("ranked_factors")
            if not isinstance(ranked, list) or not ranked:
                base -= 0.2
        if step == "boundaries":
            boundaries = self._as_dict(patch.get("boundaries"))
            hard = boundaries.get("hard")
            guardrail = boundaries.get("guardrail")
            soft = boundaries.get("soft")
            if not hard and not guardrail and not soft:
                base -= 0.2
        if step == "personal_touch_optional" and len(lowered) < 20:
            base -= 0.1

        return max(0.05, min(0.99, base))

    def _extract_decision_weights(self, text: str) -> dict[str, Any]:
        lowered = text.lower()
        ranked_factors = self._ordered_decision_factors(lowered)
        rank_extraction_method = "ordered_text"

        if not ranked_factors:
            rank_extraction_method = "keyword_fallback"
            for factor in DECISION_FACTOR_ALIASES:
                if factor in lowered and factor not in ranked_factors:
                    ranked_factors.append(factor)

        weights: dict[str, float] = {}
        for index, factor in enumerate(ranked_factors):
            weights[factor] = round(max(0.2, 1.0 - (index * 0.12)), 2)

        return {
            "ranked_factors": ranked_factors,
            "weights": weights,
            "rank_extraction_method": rank_extraction_method,
            "raw_notes": text,
        }

    def _ordered_decision_factors(self, lowered_text: str) -> list[str]:
        hits: list[tuple[int, str]] = []
        for factor, aliases in DECISION_FACTOR_ALIASES.items():
            first_match_index: int | None = None
            for alias in aliases:
                match = re.search(rf"\b{re.escape(alias)}\b", lowered_text)
                if not match:
                    continue
                if first_match_index is None or match.start() < first_match_index:
                    first_match_index = match.start()
            if first_match_index is not None:
                hits.append((first_match_index, factor))

        hits.sort(key=lambda item: (item[0], item[1]))
        ordered: list[str] = []
        for _, factor in hits:
            if factor not in ordered:
                ordered.append(factor)
        return ordered

    def _extract_non_negotiables(self, text: str) -> list[str]:
        normalized = text.replace("\n", ";")
        chunks = [piece.strip() for piece in re.split(r"[;,]", normalized) if piece.strip()]
        non_negotiables: list[str] = []
        for chunk in chunks:
            lowered = chunk.lower()
            if "always" in lowered or "never" in lowered or "must" in lowered:
                non_negotiables.append(chunk[:220])
        if not non_negotiables and chunks:
            non_negotiables = chunks[:3]
        return non_negotiables[:8]

    def _extract_boundaries(self, text: str, existing: Any) -> dict[str, Any]:
        boundaries = self._as_dict(existing)
        hard = self._as_list(boundaries.get("hard"))
        guardrail = self._as_list(boundaries.get("guardrail"))
        soft = self._as_list(boundaries.get("soft"))

        hard_match = re.search(r"hard\s*:\s*([^\n]+)", text, flags=re.IGNORECASE)
        guardrail_match = re.search(r"(?:guardrail|conditional|middle)\s*:\s*([^\n]+)", text, flags=re.IGNORECASE)
        soft_match = re.search(r"soft\s*:\s*([^\n]+)", text, flags=re.IGNORECASE)

        if hard_match:
            hard.extend(self._split_rules(hard_match.group(1)))
        if guardrail_match:
            guardrail.extend(self._split_rules(guardrail_match.group(1)))
        if soft_match:
            soft.extend(self._split_rules(soft_match.group(1)))

        if not hard_match and not guardrail_match and not soft_match:
            for rule in self._split_rules(text):
                lowered_rule = rule.lower()
                if re.search(r"\b(never|must not|do not|stop|non-negotiable|forbid|no pain)\b", lowered_rule):
                    hard.append(rule)
                elif re.search(r"\b(if|when|unless|pivot|modify|swap|scale|reduce|adjust)\b", lowered_rule):
                    guardrail.append(rule)
                else:
                    soft.append(rule)

        boundaries["hard"] = self._dedupe_list(hard)[:12]
        boundaries["guardrail"] = self._dedupe_list(guardrail)[:12]
        boundaries["soft"] = self._dedupe_list(soft)[:12]
        boundaries["notes"] = text[:600]
        return boundaries

    def _split_rules(self, text: str) -> list[str]:
        return [item.strip()[:220] for item in re.split(r"[;,]", text) if item.strip()]

    def _extract_media_assets(self, text: str) -> list[dict[str, Any]]:
        urls = URL_REGEX.findall(text)
        assets: list[dict[str, Any]] = []
        for url in urls[:5]:
            assets.append({"url": url, "source": "trainer_onboarding"})
        return assets

    def _generate_calibration_examples(self, overlay_profile: dict[str, Any]) -> list[dict[str, Any]]:
        tone_summary = self._as_dict(overlay_profile.get("tone")).get("style") or "supportive and direct"
        philosophy_summary = self._as_dict(overlay_profile.get("philosophy")).get("summary") or "consistency over extremes"
        decision_weights = self._as_dict(overlay_profile.get("decision_weights")).get("ranked_factors")
        ranked = ", ".join(decision_weights[:3]) if isinstance(decision_weights, list) and decision_weights else "sleep, stress, and schedule"

        scenarios = [
            "Client says: I am exhausted and tempted to skip today's session.",
            "Client says: I only have 25 minutes and no gym access.",
            "Client says: My knee is cranky but I still want progress.",
        ]
        llm_responses = self._generate_llm_responses_for_scenarios(
            scenarios=scenarios,
            overlay_profile=overlay_profile,
            mode="final_calibration",
        )

        examples: list[dict[str, Any]] = []
        for index, scenario in enumerate(scenarios, start=1):
            generated_response = llm_responses[index - 1] if len(llm_responses) == len(scenarios) else None
            examples.append(
                {
                    "id": f"sample_{index}",
                    "scenario": scenario,
                    "response": generated_response or self._compose_calibration_response(
                        scenario=scenario,
                        tone=tone_summary,
                        philosophy=philosophy_summary,
                        ranked_factors=ranked,
                    ),
                    "status": "pending",
                    "edited_response": None,
                    "generation_source": "llm" if generated_response else "template_fallback",
                }
            )
        return examples

    def _compose_calibration_response(self, *, scenario: str, tone: str, philosophy: str, ranked_factors: str) -> str:
        return (
            f"Tone: {tone}. "
            f"Coach response: {scenario} Let's make the next best decision using {ranked_factors}. "
            f"We stay anchored to {philosophy}, then adjust intensity and scope so momentum stays intact."
        )

    def _compose_step_preview_response(self, *, scenario: str, tone: str, philosophy: str, ranked_factors: str) -> str:
        return (
            f"{scenario} I would respond in a {tone} style, start by prioritizing {ranked_factors}, "
            f"and keep the recommendation aligned with {philosophy}."
        )

    def _build_step_preview_payload(self, step_key: str, overlay_profile: dict[str, Any]) -> dict[str, Any] | None:
        if step_key not in STEP_SCENARIO_SUMMARY:
            return None
        scenario = STEP_SCENARIO_SUMMARY[step_key]
        tone_summary = self._as_dict(overlay_profile.get("tone")).get("style") or "supportive and direct"
        philosophy_summary = self._as_dict(overlay_profile.get("philosophy")).get("summary") or "consistency over extremes"
        decision_weights = self._as_dict(overlay_profile.get("decision_weights")).get("ranked_factors")
        ranked = ", ".join(decision_weights[:3]) if isinstance(decision_weights, list) and decision_weights else "safety, stress, and schedule"
        llm_responses = self._generate_llm_responses_for_scenarios(
            scenarios=[scenario],
            overlay_profile=overlay_profile,
            mode=f"step_preview:{step_key}",
        )
        sample_response = (
            llm_responses[0]
            if llm_responses
            else self._compose_step_preview_response(
                scenario=scenario,
                tone=tone_summary,
                philosophy=philosophy_summary,
                ranked_factors=ranked,
            )
        )
        return {
            "step_key": step_key,
            "scenario": scenario,
            "sample_response": sample_response,
            "generation_source": "llm" if llm_responses else "template_fallback",
        }

    def _generate_llm_responses_for_scenarios(
        self,
        *,
        scenarios: list[str],
        overlay_profile: dict[str, Any],
        mode: str,
    ) -> list[str]:
        if not scenarios or not self.openai_client:
            return []
        tone_summary = self._as_dict(overlay_profile.get("tone")).get("style") or "supportive and direct"
        philosophy_summary = self._as_dict(overlay_profile.get("philosophy")).get("summary") or "consistency over extremes"
        decision_weights = self._as_dict(overlay_profile.get("decision_weights")).get("ranked_factors")
        ranked_factors = decision_weights[:3] if isinstance(decision_weights, list) and decision_weights else ["sleep", "stress", "schedule"]
        boundaries = self._as_dict(overlay_profile.get("boundaries"))
        payload = {
            "mode": mode,
            "style_context": {
                "tone": tone_summary,
                "philosophy": philosophy_summary,
                "ranked_factors": ranked_factors,
                "hard_boundaries": self._as_list(boundaries.get("hard"))[:3],
                "guardrail_boundaries": self._as_list(boundaries.get("guardrail"))[:3],
                "soft_boundaries": self._as_list(boundaries.get("soft"))[:3],
            },
            "requirements": {
                "responses_count": len(scenarios),
                "max_words_per_response": 80,
                "constraints": [
                    "Write realistic coach replies, not labels.",
                    "No markdown, numbering, or role prefixes.",
                    "Keep tone aligned to provided context.",
                ],
            },
            "scenarios": scenarios,
        }
        try:
            completion = self.openai_client.create_chat_completion_with_usage(
                model=GPT_5_4_MINI_MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You draft coaching response samples.\n"
                            "Return strict JSON object with key `responses`.\n"
                            "`responses` must be an array of non-empty strings matching the requested count.\n"
                            "Do not include extra keys."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(payload),
                    },
                ],
            )
            parsed = self._parse_json_object(completion.text)
            raw_responses = parsed.get("responses") if isinstance(parsed, dict) else None
            if not isinstance(raw_responses, list):
                return []
            cleaned: list[str] = []
            for entry in raw_responses:
                text = str(entry or "").strip()
                if not text:
                    return []
                cleaned.append(text[:520])
            return cleaned if len(cleaned) == len(scenarios) else []
        except Exception:
            logger.exception("Trainer onboarding sample generation failed mode=%s", mode)
            return []

    def _parse_json_object(self, payload_text: str) -> dict[str, Any]:
        if not isinstance(payload_text, str):
            return {}
        raw = payload_text.strip()
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            pass
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(raw[start : end + 1])
                return parsed if isinstance(parsed, dict) else {}
            except json.JSONDecodeError:
                return {}
        return {}

    def _regenerate_calibration_example(self, sample: dict[str, Any], overlay_profile: dict[str, Any], index: int) -> dict[str, Any]:
        regenerated = dict(sample)
        tone_summary = self._as_dict(overlay_profile.get("tone")).get("style") or "supportive and direct"
        philosophy_summary = self._as_dict(overlay_profile.get("philosophy")).get("summary") or "consistency over extremes"
        scenario = str(sample.get("scenario") or "Client says: I need help adjusting today's plan.")
        llm_responses = self._generate_llm_responses_for_scenarios(
            scenarios=[scenario],
            overlay_profile=overlay_profile,
            mode="final_calibration:regenerate",
        )
        regenerated["response"] = llm_responses[0] if llm_responses else (
            f"Tone: {tone_summary}. "
            f"Alternative response: {scenario} We will keep today executable and safe, "
            f"then stack a win that still reflects {philosophy_summary}."
        )
        regenerated["status"] = "pending"
        regenerated["edited_response"] = None
        regenerated["id"] = f"sample_{index + 1}"
        regenerated["generation_source"] = "llm" if llm_responses else "template_fallback"
        return regenerated

    def _all_calibration_examples_approved(self, calibration_examples: list[dict[str, Any]]) -> bool:
        if not calibration_examples:
            return False
        return all(str(item.get("status") or "").lower() == "approved" for item in calibration_examples)

    def _parse_step_edit_intent(self, message: str) -> str | None:
        lowered = message.lower().strip()
        if not lowered.startswith("edit "):
            return None
        target = lowered.replace("edit", "", 1).strip()
        if target in STEP_ALIAS:
            return STEP_ALIAS[target]
        for alias, step_key in STEP_ALIAS.items():
            if alias in target:
                return step_key
        return None

    def _is_skip_intent(self, message: str) -> bool:
        lowered = message.lower().strip()
        return lowered in {"skip", "skip this", "pass", "not now"}

    def _next_step(self, step: str) -> str:
        if step not in ONBOARDING_STEPS:
            return "welcome"
        index = ONBOARDING_STEPS.index(step)
        if index >= len(ONBOARDING_STEPS) - 1:
            return "complete"
        return ONBOARDING_STEPS[index + 1]

    def _advance_progress(self, progress: dict[str, Any], *, completed_step: str | None, next_step: str) -> dict[str, Any]:
        completed_keys = [step for step in self._as_list(progress.get("completed_step_keys")) if step in ONBOARDING_STEPS]
        if completed_step and completed_step in ONBOARDING_STEPS and completed_step not in completed_keys:
            completed_keys.append(completed_step)
        updated = {
            **progress,
            "completed_step_keys": completed_keys,
            "completed_steps": min(TOTAL_STEPS, len(completed_keys)),
            "total_steps": TOTAL_STEPS,
            "current_step": next_step,
            "last_completed_step": completed_step or progress.get("last_completed_step"),
        }
        return updated

    def _default_progress(self) -> dict[str, Any]:
        return {
            "completed_steps": 0,
            "total_steps": TOTAL_STEPS,
            "current_step": "welcome",
            "last_completed_step": None,
            "completed_step_keys": [],
        }

    def _default_state(self) -> dict[str, Any]:
        return {
            "onboarding_status": ONBOARDING_STATUS_NOT_STARTED,
            "onboarding_progress": self._default_progress(),
            "last_completed_step": None,
            "identity": {},
            "tone": {},
            "communication_preferences": {},
            "coaching_examples": [],
            "decision_weights": {},
            "scenario_rules": [],
            "philosophy": {},
            "non_negotiables": [],
            "boundaries": {},
            "media_assets": [],
            "calibration_examples": [],
        }

    def _normalize_progress(self, payload: Any) -> dict[str, Any]:
        progress = payload if isinstance(payload, dict) else {}
        completed_step_keys = [
            step for step in self._as_list(progress.get("completed_step_keys"))
            if step in ONBOARDING_STEPS
        ]
        current_step = str(progress.get("current_step") or "welcome").strip().lower()
        if current_step not in {"complete", *ONBOARDING_STEPS}:
            current_step = "welcome"
        completed_steps = progress.get("completed_steps")
        try:
            completed_steps_value = int(completed_steps)
        except (TypeError, ValueError):
            completed_steps_value = len(completed_step_keys)
        completed_steps_value = max(len(completed_step_keys), completed_steps_value)
        completed_steps_value = min(TOTAL_STEPS, max(0, completed_steps_value))
        last_completed_step = progress.get("last_completed_step")
        if last_completed_step and str(last_completed_step) not in ONBOARDING_STEPS:
            last_completed_step = None
        result: dict[str, Any] = {
            "completed_steps": completed_steps_value,
            "total_steps": TOTAL_STEPS,
            "current_step": current_step,
            "last_completed_step": last_completed_step,
            "completed_step_keys": completed_step_keys,
        }
        sample_review_state = progress.get("sample_review_state")
        if sample_review_state:
            result["sample_review_state"] = sample_review_state
        return result

    def _normalize_status(self, value: Any) -> str:
        status = str(value or ONBOARDING_STATUS_NOT_STARTED).strip().lower()
        if status not in {
            ONBOARDING_STATUS_NOT_STARTED,
            ONBOARDING_STATUS_IN_PROGRESS,
            ONBOARDING_STATUS_CALIBRATION_PENDING,
            ONBOARDING_STATUS_COMPLETED,
        }:
            return ONBOARDING_STATUS_NOT_STARTED
        return status

    def _normalize_calibration_examples(self, payload: Any) -> list[dict[str, Any]]:
        raw_items = self._as_list(payload)
        items: list[dict[str, Any]] = []
        for index, item in enumerate(raw_items, start=1):
            entry = item if isinstance(item, dict) else {}
            items.append(
                {
                    "id": str(entry.get("id") or f"sample_{index}"),
                    "scenario": str(entry.get("scenario") or "Scenario not set"),
                    "response": str(entry.get("response") or ""),
                    "status": str(entry.get("status") or "pending").lower(),
                    "edited_response": entry.get("edited_response"),
                    "generation_source": str(entry.get("generation_source") or "template_fallback"),
                }
            )
        return items[:5]

    def _normalize_state(self, payload: Any) -> dict[str, Any]:
        source = payload if isinstance(payload, dict) else {}
        default_state = self._default_state()
        normalized: dict[str, Any] = {}

        normalized["onboarding_status"] = self._normalize_status(source.get("onboarding_status") or default_state["onboarding_status"])
        normalized["onboarding_progress"] = self._normalize_progress(source.get("onboarding_progress") or default_state["onboarding_progress"])
        normalized["last_completed_step"] = source.get("last_completed_step")
        if normalized["last_completed_step"] and str(normalized["last_completed_step"]) not in ONBOARDING_STEPS:
            normalized["last_completed_step"] = None

        normalized["identity"] = self._as_dict(source.get("identity"))
        normalized["tone"] = self._as_dict(source.get("tone"))
        normalized["communication_preferences"] = self._as_dict(source.get("communication_preferences"))
        normalized["coaching_examples"] = self._as_list(source.get("coaching_examples"))
        normalized["decision_weights"] = self._as_dict(source.get("decision_weights"))
        normalized["scenario_rules"] = self._as_list(source.get("scenario_rules"))
        normalized["philosophy"] = self._as_dict(source.get("philosophy"))
        normalized["non_negotiables"] = self._as_list(source.get("non_negotiables"))
        normalized["boundaries"] = self._as_dict(source.get("boundaries"))
        normalized["media_assets"] = self._as_list(source.get("media_assets"))
        normalized["calibration_examples"] = self._normalize_calibration_examples(source.get("calibration_examples"))

        return normalized

    def _has_retrain_draft(self, profile: dict[str, Any]) -> bool:
        draft = self._as_dict(profile.get("retrain_draft"))
        if not draft:
            return False
        status = self._normalize_status(draft.get("onboarding_status"))
        return status in {
            ONBOARDING_STATUS_NOT_STARTED,
            ONBOARDING_STATUS_IN_PROGRESS,
            ONBOARDING_STATUS_CALIBRATION_PENDING,
            ONBOARDING_STATUS_COMPLETED,
        }

    def _state_from_profile(self, profile: dict[str, Any], *, use_retrain_draft: bool) -> dict[str, Any]:
        source = self._as_dict(profile.get("retrain_draft")) if use_retrain_draft else {
            key: profile.get(key)
            for key in STATE_FIELD_KEYS
        }
        return self._normalize_state(source)

    def _state_overlay_profile(self, profile: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
        return {
            **profile,
            **state,
        }

    def _persist_state_patch(
        self,
        trainer_id: str,
        current_profile: dict[str, Any],
        current_state: dict[str, Any],
        patch: dict[str, Any],
        *,
        use_retrain_draft: bool,
        force_retrain_started: bool = False,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        next_state = self._normalize_state({**current_state, **patch})
        if use_retrain_draft:
            retrain_started_at = current_profile.get("retrain_started_at")
            if force_retrain_started or not retrain_started_at:
                retrain_started_at = datetime.now(timezone.utc).isoformat()
            payload = {
                "retrain_draft": next_state,
                "retrain_started_at": retrain_started_at,
            }
            updated_profile = self._persist_profile(trainer_id, current_profile, payload)
            return updated_profile, self._state_from_profile(updated_profile, use_retrain_draft=True)

        updated_profile = self._persist_profile(trainer_id, current_profile, next_state)
        return updated_profile, self._state_from_profile(updated_profile, use_retrain_draft=False)

    def _start_retrain_draft(
        self,
        profile: dict[str, Any],
        trainer_context: TrainerContext,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        trainer_id = str(trainer_context.trainer_id or "")
        draft_state = self._default_state()
        draft_state["onboarding_status"] = ONBOARDING_STATUS_IN_PROGRESS
        draft_state["onboarding_progress"] = self._default_progress()
        draft_state["last_completed_step"] = None

        updated_profile = self._persist_profile(
            trainer_id,
            profile,
            {
                "retrain_draft": draft_state,
                "retrain_started_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return updated_profile, self._state_from_profile(updated_profile, use_retrain_draft=True)

    def _promote_retrain_draft(
        self,
        trainer_id: str,
        profile: dict[str, Any],
        completed_draft_state: dict[str, Any],
    ) -> dict[str, Any]:
        payload = {
            **completed_draft_state,
            "retrain_draft": None,
            "retrain_started_at": None,
        }
        return self._persist_profile(trainer_id, profile, payload)

    def _humanize_step(self, step: str) -> str:
        normalized = str(step or "").strip().lower()
        if normalized in STEP_TITLES:
            return STEP_TITLES[normalized]
        return normalized.replace("_", " ").title()

    def _get_or_create_profile(self, trainer_context: TrainerContext) -> dict[str, Any]:
        trainer_id = str(trainer_context.trainer_id or "")
        existing = self.repository.get_profile(trainer_id)
        if existing:
            return existing

        payload = {
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_id,
            **self._default_state(),
            "version": 1,
            "retrain_draft": None,
            "retrain_started_at": None,
        }
        created = self.repository.create_profile(payload)
        return created or payload

    def _persist_profile(self, trainer_id: str, current_profile: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        next_version = int(current_profile.get("version") or 1) + 1
        updated_payload = {
            **payload,
            "version": next_version,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        updated = self.repository.update_profile(trainer_id, updated_payload)
        return updated or {**current_profile, **updated_payload}

    def _create_event(
        self,
        trainer_context: TrainerContext,
        *,
        conversation_id: str,
        source_message_id: str | None,
        step_key: str,
        action_type: str,
        extracted_patch: dict[str, Any],
        confidence_score: float | None,
        actor_role: str = "trainer",
    ) -> None:
        if not trainer_context.tenant_id or not trainer_context.trainer_id:
            return
        payload = {
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "conversation_id": conversation_id,
            "source_message_id": source_message_id,
            "step_key": step_key,
            "action_type": action_type,
            "extracted_patch": extracted_patch or {},
            "confidence_score": confidence_score,
            "actor_role": actor_role,
        }
        try:
            self.repository.create_event(payload)
        except TrainerOnboardingStorageUnavailableError:
            logger.warning(
                "Trainer onboarding event storage unavailable. Continuing without event persistence. "
                "trainer_id=%s conversation_id=%s step=%s action=%s",
                trainer_context.trainer_id,
                conversation_id,
                step_key,
                action_type,
                exc_info=True,
            )
        except Exception:
            logger.warning(
                "Trainer onboarding event persistence failed. Continuing without event persistence. "
                "trainer_id=%s conversation_id=%s step=%s action=%s",
                trainer_context.trainer_id,
                conversation_id,
                step_key,
                action_type,
                exc_info=True,
            )

    def _mirror_to_trainer_persona(self, trainer_context: TrainerContext, profile: dict[str, Any]) -> None:
        trainer_id = trainer_context.trainer_id
        if not trainer_id:
            return

        existing = self.trainer_persona_repository.get_default_by_trainer(trainer_id)
        identity = self._as_dict(profile.get("identity"))
        tone = self._as_dict(profile.get("tone"))
        philosophy = self._as_dict(profile.get("philosophy"))
        communication_preferences = self._as_dict(profile.get("communication_preferences"))
        decision_weights = self._as_dict(profile.get("decision_weights"))
        scenario_rules = self._as_list(profile.get("scenario_rules"))
        boundaries = self._as_dict(profile.get("boundaries"))
        calibration_examples = self._normalize_calibration_examples(profile.get("calibration_examples"))
        agent_name = str(identity.get("agent_name") or "").strip()

        payload = {
            "persona_name": agent_name or (existing or {}).get("persona_name") or trainer_context.persona_name or "Default Coach",
            "tone_description": str(tone.get("style") or (existing or {}).get("tone_description") or "").strip() or None,
            "coaching_philosophy": str(philosophy.get("summary") or (existing or {}).get("coaching_philosophy") or "").strip() or None,
            "communication_rules": {
                **(((existing or {}).get("communication_rules")) or {}),
                "identity": identity,
                "communication_preferences": communication_preferences,
                "decision_weights": decision_weights,
                "scenario_rules": scenario_rules[:20],
            },
            "onboarding_preferences": {
                **(((existing or {}).get("onboarding_preferences")) or {}),
                "trainer_onboarding_completed": True,
                "trainer_onboarding_version": "v2_conversational",
                "trainer_onboarding_answers": {
                    "coaching_identity": identity,
                    "tone": tone,
                    "communication_preferences": communication_preferences,
                    "decision_weights": decision_weights,
                    "scenario_rules": scenario_rules[:10],
                    "philosophy": philosophy,
                    "boundaries": boundaries,
                    "calibration_examples": calibration_examples,
                },
            },
            "fallback_behavior": {
                **(((existing or {}).get("fallback_behavior")) or {}),
                "boundaries": boundaries,
            },
            "is_default": True,
        }

        if existing:
            self.trainer_persona_repository.update(existing["id"], payload)
            return

        self.trainer_persona_repository.create(
            {
                "trainer_id": trainer_id,
                **payload,
            }
        )

    def _init_openai_client(self) -> OpenAIClient | None:
        if not settings.openai_api_key:
            return None
        try:
            return OpenAIClient()
        except Exception:
            logger.exception("Trainer onboarding service could not initialize OpenAI client")
            return None

    def _as_dict(self, value: Any) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    def _as_list(self, value: Any) -> list[Any]:
        return value if isinstance(value, list) else []

    def _dedupe_list(self, items: list[Any]) -> list[Any]:
        deduped: list[Any] = []
        seen: set[str] = set()
        for item in items:
            normalized = str(item).strip()
            if not normalized:
                continue
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(normalized)
        return deduped
