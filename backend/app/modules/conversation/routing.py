from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


GEMINI_FLASH_MODEL = "gemini-2.5-flash"
GEMINI_PRO_MODEL = "gemini-2.5-pro"
GPT_5_4_MINI_MODEL = "gpt-5.4-mini"
GPT_5_4_MODEL = "gpt-5.4"
CLAUDE_SONNET_4_6_MODEL = "claude-sonnet-4.6"
CLAUDE_OPUS_4_6_MODEL = "claude-opus-4.6"


RISK_KEYWORDS = {
    "pain_injury": ["pain", "injury", "hurt", "strained", "sprain", "swollen", "acute injury", "severe pain"],
    "medical": ["medication", "pregnant", "postpartum", "diagnosed", "minor", "under 18"],
    "eating_disorder": ["binge", "purge", "starve", "extreme restriction", "eating disorder"],
    "severe": ["chest pain", "fainted", "fainting", "dizzy", "dizziness", "shortness of breath"],
}

CONSTRAINT_KEYWORDS = {
    "equipment": ["dumbbell", "barbell", "bands", "bodyweight", "machine", "equipment", "home gym", "hotel gym"],
    "schedule": ["today", "tomorrow", "missed", "travel", "vacation", "busy", "schedule", "week", "monday"],
    "recovery": ["sore", "fatigue", "tired", "recovery", "deload"],
    "nutrition": ["allergy", "allergies", "intolerance", "vegetarian", "vegan", "protein", "calories", "macros"],
    "goals": ["fat loss", "lose fat", "strength", "hypertrophy", "endurance", "muscle", "performance"],
    "injury": ["pain", "injury", "shoulder", "knee", "back", "ankle"],
}

NEGATIVE_SENTIMENT_KEYWORDS = ["discouraged", "frustrated", "guilty", "embarrassed", "struggling", "fell off", "unmotivated"]
MOTIVATION_KEYWORDS = ["motivation", "motivated", "struggling", "fell off", "discouraged", "guilty", "embarrassed"]
STRUCTURE_KEYWORDS = ["json", "schema", "table", "database", "db", "export", "object", "objects"]
PLAN_GENERATION_KEYWORDS = ["build me", "create", "8-week", "12-week", "4-day split", "program", "mesocycle", "periodize"]
PLAN_REVISION_KEYWORDS = ["revise", "update my program", "adjust my plan", "rewrite", "reduce fatigue", "missed monday"]
PROGRESS_ANALYSIS_KEYWORDS = ["plateau", "analyze", "analysis", "trend", "trends", "last 6 weeks", "last 8 weeks", "progress"]
EXERCISE_EXPLANATION_KEYWORDS = ["what muscles", "how do i", "explain", "what does", "brace", "form", "technique"]
NUTRITION_KEYWORDS = ["protein", "calories", "macro", "macros", "meal", "vegetarian", "nutrition", "fat loss"]
LOGGING_KEYWORDS = ["log ", "save this", "save as my pr", "i ate", "3x10", "3 x 10", "sets", "reps"]
WORKOUT_ADJUSTMENT_KEYWORDS = ["swap", "substitute", "adjust", "sore", "only have", "missed", "what should i do today"]
PERSONA_KEYWORDS = ["coach", "trainer", "tough-love", "what would", "answer like"]
MULTIMODAL_TASK_KEYWORDS = ["check my squat form", "analyze this meal photo", "video", "image", "photo", "form check"]
RETRIEVAL_KEYWORDS = ["today's workout", "my split", "what coach assigned", "my macros", "my plan", "my program"]
POST_CHECKIN_GENERIC_KEYWORDS = [
    "what now",
    "what next",
    "what should i do",
    "where should i start",
    "coach?",
    "help",
    "today",
]


@dataclass
class RoutingContext:
    message_text: str
    client_context: dict[str, Any] = field(default_factory=dict)
    trainer_persona_name: str | None = None
    user_profile: dict[str, Any] | None = None


@dataclass
class RoutingDecision:
    task_type: str
    model: str
    provider: str
    flow: str
    reason: str
    response_mode: str
    risk_score: int
    complexity_score: int
    persona_score: int
    structure_score: int
    multimodal_score: int
    retrieval_required: bool
    retrieval_confidence: float | None
    needs_trainer_review: bool = False
    requires_async: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "task_type": self.task_type,
            "model": self.model,
            "provider": self.provider,
            "flow": self.flow,
            "reason": self.reason,
            "response_mode": self.response_mode,
            "risk_score": self.risk_score,
            "complexity_score": self.complexity_score,
            "persona_score": self.persona_score,
            "structure_score": self.structure_score,
            "multimodal_score": self.multimodal_score,
            "retrieval_required": self.retrieval_required,
            "retrieval_confidence": self.retrieval_confidence,
            "needs_trainer_review": self.needs_trainer_review,
            "requires_async": self.requires_async,
        }


class ConversationRouter:
    def route(self, ctx: RoutingContext) -> RoutingDecision:
        text = (ctx.message_text or "").lower()
        client_context = ctx.client_context or {}
        retrieval_confidence = self._parse_float(client_context.get("retrieval_confidence"))
        history_needed = self._history_needed(text, client_context)
        retrieval_required = self._retrieval_required(text, client_context)

        risk_score = self._risk_score(text)
        complexity_score = self._complexity_score(text, client_context, history_needed, ctx.user_profile or {})
        persona_score = self._persona_score(text, client_context, ctx.trainer_persona_name)
        structure_score = self._structure_score(text, client_context)
        multimodal_score = self._multimodal_score(text, client_context)
        task_type = self._task_type(text, client_context)
        response_mode = self._response_mode(task_type, risk_score)
        low_retrieval_confidence = retrieval_required and (retrieval_confidence is None or retrieval_confidence < 0.6)
        requires_async = task_type in {"plan_generation", "progress_analysis"} and complexity_score >= 6

        if risk_score >= 5:
            return RoutingDecision(
                task_type=task_type,
                model=GPT_5_4_MINI_MODEL,
                provider="openai",
                flow="safety_constrained",
                reason="risk",
                response_mode="answer_plus_escalation",
                risk_score=risk_score,
                complexity_score=complexity_score,
                persona_score=persona_score,
                structure_score=structure_score,
                multimodal_score=multimodal_score,
                retrieval_required=retrieval_required,
                retrieval_confidence=retrieval_confidence,
                needs_trainer_review=low_retrieval_confidence and persona_score >= 4,
                requires_async=False,
            )

        if multimodal_score >= 3 and complexity_score < 4:
            return RoutingDecision(
                task_type=task_type,
                model=GEMINI_FLASH_MODEL,
                provider="gemini",
                flow="multimodal_fast",
                reason="multimodal",
                response_mode=response_mode,
                risk_score=risk_score,
                complexity_score=complexity_score,
                persona_score=persona_score,
                structure_score=structure_score,
                multimodal_score=multimodal_score,
                retrieval_required=retrieval_required,
                retrieval_confidence=retrieval_confidence,
                needs_trainer_review=False,
                requires_async=False,
            )

        if persona_score >= 4:
            return RoutingDecision(
                task_type=task_type,
                model=CLAUDE_SONNET_4_6_MODEL,
                provider="anthropic",
                flow="persona_coach",
                reason="persona",
                response_mode=response_mode,
                risk_score=risk_score,
                complexity_score=complexity_score,
                persona_score=persona_score,
                structure_score=structure_score,
                multimodal_score=multimodal_score,
                retrieval_required=retrieval_required,
                retrieval_confidence=retrieval_confidence,
                needs_trainer_review=low_retrieval_confidence,
                requires_async=False,
            )

        if structure_score >= 3 or complexity_score >= 4 or low_retrieval_confidence:
            return RoutingDecision(
                task_type=task_type,
                model=GPT_5_4_MINI_MODEL,
                provider="openai",
                flow="reasoning_structured",
                reason="complexity_or_structure" if not low_retrieval_confidence else "low_retrieval_confidence",
                response_mode="async_report_generation" if requires_async else response_mode,
                risk_score=risk_score,
                complexity_score=complexity_score,
                persona_score=persona_score,
                structure_score=structure_score,
                multimodal_score=multimodal_score,
                retrieval_required=retrieval_required,
                retrieval_confidence=retrieval_confidence,
                needs_trainer_review=low_retrieval_confidence and persona_score > 0,
                requires_async=requires_async,
            )

        return RoutingDecision(
            task_type=task_type,
            model=GEMINI_FLASH_MODEL,
            provider="gemini",
            flow="default_fast",
            reason="default",
            response_mode=response_mode,
            risk_score=risk_score,
            complexity_score=complexity_score,
            persona_score=persona_score,
            structure_score=structure_score,
            multimodal_score=multimodal_score,
            retrieval_required=retrieval_required,
            retrieval_confidence=retrieval_confidence,
            needs_trainer_review=False,
            requires_async=False,
        )

    def _risk_score(self, text: str) -> int:
        score = 0
        if self._contains_any(text, RISK_KEYWORDS["pain_injury"]):
            score += 4
        if self._contains_any(text, RISK_KEYWORDS["medical"]):
            score += 5
        if self._contains_any(text, RISK_KEYWORDS["eating_disorder"]):
            score += 5
        if self._contains_any(text, RISK_KEYWORDS["severe"]):
            score += 8
        return score

    def _complexity_score(
        self,
        text: str,
        client_context: dict[str, Any],
        history_needed: bool,
        user_profile: dict[str, Any],
    ) -> int:
        score = 0
        if len(text) > 500:
            score += 1
        if self._contains_any(text, ["week plan", "8-week", "12-week", "program", "mesocycle", "periodize"]):
            score += 3
        if self._count_constraints(text, client_context) >= 3:
            score += 2
        if self._has_conflicting_goals(text):
            score += 2
        if self._contains_any(text, ["analyze", "compare", "optimize", "adjust", "revise"]):
            score += 2
        if history_needed:
            score += 2
        if self._is_post_checkin_entrypoint(client_context):
            score += 1
        if self._profile_incomplete(user_profile):
            score += 1
        return score

    def _persona_score(self, text: str, client_context: dict[str, Any], trainer_persona_name: str | None) -> int:
        score = 0
        if client_context.get("trainer_persona_requested") or self._contains_any(text, PERSONA_KEYWORDS):
            score += 4
        if self._contains_any(text, MOTIVATION_KEYWORDS):
            score += 3
        if self._contains_any(text, NEGATIVE_SENTIMENT_KEYWORDS):
            score += 2
        if trainer_persona_name and "like my trainer" in text:
            score += 2
        return score

    def _structure_score(self, text: str, client_context: dict[str, Any]) -> int:
        score = 0
        output_format = str(client_context.get("output_format") or "").lower()
        if output_format in {"json", "schema", "table", "db_object"} or self._contains_any(text, STRUCTURE_KEYWORDS):
            score += 3
        if client_context.get("requires_save_action"):
            score += 2
        return score

    def _multimodal_score(self, text: str, client_context: dict[str, Any]) -> int:
        score = 0
        if client_context.get("has_image") or client_context.get("has_video") or self._contains_any(text, MULTIMODAL_TASK_KEYWORDS):
            score += 3
        if client_context.get("has_wearable_data"):
            score += 2
        return score

    def _task_type(self, text: str, client_context: dict[str, Any]) -> str:
        if client_context.get("has_image") or client_context.get("has_video") or self._contains_any(text, MULTIMODAL_TASK_KEYWORDS):
            return "form_check"
        if self._contains_any(text, MOTIVATION_KEYWORDS):
            return "motivation"
        if self._contains_any(text, LOGGING_KEYWORDS):
            return "logging"
        if self._contains_any(text, PLAN_REVISION_KEYWORDS):
            return "plan_revision"
        if self._contains_any(text, PROGRESS_ANALYSIS_KEYWORDS):
            return "progress_analysis"
        if self._contains_any(text, PLAN_GENERATION_KEYWORDS):
            return "plan_generation"
        if self._contains_any(text, NUTRITION_KEYWORDS):
            return "nutrition_guidance"
        if self._contains_any(text, EXERCISE_EXPLANATION_KEYWORDS):
            return "exercise_explanation"
        if self._contains_any(text, PERSONA_KEYWORDS):
            return "persona_chat"
        if self._contains_any(text, WORKOUT_ADJUSTMENT_KEYWORDS):
            return "workout_adjustment"
        if client_context.get("output_format") in {"json", "schema", "table", "db_object"} or self._contains_any(text, STRUCTURE_KEYWORDS):
            return "admin_structured_output"
        if self._is_post_checkin_entrypoint(client_context) and self._is_generic_post_checkin_prompt(text):
            return "post_checkin_followup"
        return "qa_quick"

    def _response_mode(self, task_type: str, risk_score: int) -> str:
        if risk_score >= 5:
            return "answer_plus_escalation"
        if task_type == "logging":
            return "answer_plus_log_action"
        if task_type in {"workout_adjustment", "plan_revision"}:
            return "answer_plus_plan_update"
        if task_type in {"plan_generation", "progress_analysis"}:
            return "async_report_generation"
        return "direct_answer"

    def _retrieval_required(self, text: str, client_context: dict[str, Any]) -> bool:
        if client_context.get("history_needed") or client_context.get("retrieval_required"):
            return True
        if self._is_post_checkin_entrypoint(client_context):
            return True
        if client_context.get("trainer_persona_requested") or self._contains_any(text, PERSONA_KEYWORDS):
            return True
        return self._contains_any(text, RETRIEVAL_KEYWORDS)

    def _history_needed(self, text: str, client_context: dict[str, Any]) -> bool:
        return bool(client_context.get("history_needed")) or self._is_post_checkin_entrypoint(client_context) or self._contains_any(
            text,
            ["today's workout", "my split", "my macros", "my program", "last 6 weeks", "last 8 weeks"],
        )

    def _count_constraints(self, text: str, client_context: dict[str, Any]) -> int:
        explicit = client_context.get("constraint_count")
        if isinstance(explicit, int):
            return explicit

        matches = 0
        for keywords in CONSTRAINT_KEYWORDS.values():
            if self._contains_any(text, keywords):
                matches += 1
        return matches

    def _has_conflicting_goals(self, text: str) -> bool:
        fat_loss = self._contains_any(text, ["fat loss", "lose fat", "cut"])
        strength = self._contains_any(text, ["strength", "stronger", "powerlifting"])
        endurance = self._contains_any(text, ["endurance", "marathon", "conditioning"])
        muscle = self._contains_any(text, ["hypertrophy", "build muscle", "muscle gain"])
        goal_count = sum([fat_loss, strength, endurance, muscle])
        return goal_count >= 2

    def _profile_incomplete(self, user_profile: dict[str, Any]) -> bool:
        if not user_profile:
            return True
        required_fields = ["primary_goal", "experience_level", "equipment_access"]
        return any(not user_profile.get(field_name) for field_name in required_fields)

    def _contains_any(self, text: str, keywords: list[str]) -> bool:
        return any(keyword in text for keyword in keywords)

    def _is_post_checkin_entrypoint(self, client_context: dict[str, Any]) -> bool:
        entrypoint = str(client_context.get("entrypoint") or "").strip().lower()
        return entrypoint in {"post_checkin", "post-checkin"}

    def _is_generic_post_checkin_prompt(self, text: str) -> bool:
        normalized = text.strip()
        if not normalized:
            return True
        if len(normalized.split()) <= 8:
            return True
        return self._contains_any(normalized, POST_CHECKIN_GENERIC_KEYWORDS)

    def _parse_float(self, value: Any) -> float | None:
        try:
            if value is None:
                return None
            return float(value)
        except (TypeError, ValueError):
            return None
