from __future__ import annotations

import logging
import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


logger = logging.getLogger(__name__)


class Route(str, Enum):
    FAST = "FAST_PATH"
    DEEP = "DEEP_PATH"
    ESCALATE = "SAFETY_ESCALATION"


class IntentRoute(BaseModel):
    route: Route
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str
    risk_flags: list[str] = Field(default_factory=list)
    required_context: list[str] = Field(default_factory=list)
    notify_trainer: bool = False
    user_status_message: str
    status_messages: dict[str, str] = Field(default_factory=dict)


SAFETY_PATTERNS: tuple[tuple[str, str], ...] = (
    ("injury_mention", r"\b(injur(?:y|ed)|sprain(?:ed)?|strain(?:ed)?|tendon|ligament|swollen|sharp pain|severe pain)\b"),
    ("pain_language", r"\b(pain|hurts?|aching|ache|really hurting|can't move|cannot move)\b"),
    ("medical_request", r"\b(diagnos(?:e|is)|doctor|medical|medication|medicine|meds?|prescription|dosage|dose|pregnant|postpartum)\b"),
    ("supplement_dosage", r"\b(creatine|supplement|pre[- ]?workout|caffeine|dosage|dose)\b.*\b(meds?|medication|take|with)\b"),
    ("eating_disorder", r"\b(eating disorder|binge|purge|starv(?:e|ing)|laxative|extreme restriction|under[- ]?eat)\b"),
    ("self_harm", r"\b(self[- ]?harm|kill myself|suicidal|end my life|hurt myself)\b"),
)

DEEP_PATTERNS: tuple[tuple[str, str], ...] = (
    ("plan_change", r"\b(change|revise|adjust|rewrite|modify|update)\b.*\b(plan|program|split|workout)\b"),
    ("readiness_analysis", r"\b(readiness|recovery trend|fatigue trend|weekly trend|analy[sz]e)\b"),
    ("plateau", r"\b(plateau|stalled|not progressing|progress)\b"),
    ("complex_personalization", r"\b(8[- ]?week|12[- ]?week|mesocycle|periodi[sz]e|custom plan)\b"),
)

FAST_PATTERNS: tuple[tuple[str, str], ...] = (
    ("motivation", r"\b(motivat(?:e|ion)|encourage|accountability|nudge)\b"),
    ("simple_checkin", r"\b(great workout|done|finished|checked in|check[- ]?in|thanks)\b"),
    ("simple_faq", r"\b(what is|how do i|explain|form cue|quick question)\b"),
)


class IntentRouter:
    def classify(self, message: str, user_digest: Any | None = None) -> IntentRoute:
        del user_digest
        text = str(message or "").strip()
        lowered = text.lower()
        risk_flags = self._matching_flags(lowered, SAFETY_PATTERNS)
        if risk_flags:
            status_messages = _status_messages(
                reading="Reading this carefully...",
                loading="Loading your safety context...",
                retrieving="Checking relevant trainer notes...",
                checking="Checking active safety flags...",
                generating="Checking this carefully with your recent context...",
                writing="Writing a safe next step...",
            )
            return IntentRoute(
                route=Route.ESCALATE,
                confidence=1.0,
                reason="Safety keyword pre-screen matched.",
                risk_flags=risk_flags,
                required_context=["active_safety_flags", "trainer_review_status"],
                notify_trainer=True,
                user_status_message=status_messages["generating_recommendation"],
                status_messages=status_messages,
            )

        deep_flags = self._matching_flags(lowered, DEEP_PATTERNS)
        if deep_flags:
            status_messages = _status_messages(
                reading="Reading your request...",
                loading="Loading your profile and plan...",
                retrieving="Reviewing your trainer context...",
                checking="Checking training and recovery signals...",
                generating="Reviewing your recent training and plan context...",
                writing="Writing your trainer-specific response...",
            )
            return IntentRoute(
                route=Route.DEEP,
                confidence=0.86,
                reason="Message asks for plan or readiness analysis.",
                risk_flags=[],
                required_context=["user_digest", "active_plan", "recent_training"],
                notify_trainer=False,
                user_status_message=status_messages["generating_recommendation"],
                status_messages=status_messages,
            )

        fast_flags = self._matching_flags(lowered, FAST_PATTERNS)
        if fast_flags or len(text) <= 140:
            status_messages = _status_messages(
                reading="Reading your message...",
                loading="Checking your latest coaching context...",
                retrieving="Checking your trainer notes...",
                checking="Checking recent signals...",
                generating="Checking your latest coaching context...",
                writing="Writing your coaching response...",
            )
            return IntentRoute(
                route=Route.FAST,
                confidence=0.82,
                reason="Message fits a fast coaching reply.",
                risk_flags=[],
                required_context=["user_digest"],
                notify_trainer=False,
                user_status_message=status_messages["generating_recommendation"],
                status_messages=status_messages,
            )

        status_messages = _status_messages(
            reading="Reading your request...",
            loading="Loading your coaching context...",
            retrieving="Reviewing your trainer context...",
            checking="Checking recent training and recovery context...",
            generating="Reviewing your recent training and recovery context...",
            writing="Writing your coaching response...",
        )
        return IntentRoute(
            route=Route.DEEP,
            confidence=0.72,
            reason="Ambiguous coaching request defaults to deeper personalization.",
            risk_flags=[],
            required_context=["user_digest", "recent_training"],
            notify_trainer=False,
            user_status_message=status_messages["generating_recommendation"],
            status_messages=status_messages,
        )

    def classify_with_fallback(self, message: str, user_digest: Any | None = None) -> IntentRoute:
        try:
            route = self.classify(message, user_digest=user_digest)
        except Exception:
            logger.exception("intent_router_failed fallback_route=DEEP_PATH")
            status_messages = _status_messages(
                reading="Reading your request...",
                loading="Loading your coaching context...",
                retrieving="Reviewing available trainer context...",
                checking="Checking recent training and safety context...",
                generating="Reviewing your recent training and safety context...",
                writing="Writing your coaching response...",
            )
            return IntentRoute(
                route=Route.DEEP,
                confidence=0.70,
                reason="Router failed; using conservative deep path.",
                risk_flags=["router_fail"],
                required_context=["user_digest", "recent_training", "active_safety_flags"],
                notify_trainer=False,
                user_status_message=status_messages["generating_recommendation"],
                status_messages=status_messages,
            )
        if route.route != Route.ESCALATE and route.confidence < 0.70:
            status_messages = _status_messages(
                reading="Reading this carefully...",
                loading="Loading your safety context...",
                retrieving="Checking relevant trainer notes...",
                checking="Checking active safety flags...",
                generating="Checking this carefully before giving guidance...",
                writing="Writing a safe next step...",
            )
            return IntentRoute(
                route=Route.ESCALATE,
                confidence=route.confidence,
                reason="Router confidence was below safety threshold.",
                risk_flags=sorted(set([*route.risk_flags, "low_confidence"])),
                required_context=sorted(set([*route.required_context, "active_safety_flags"])),
                notify_trainer=True,
                user_status_message=status_messages["generating_recommendation"],
                status_messages=status_messages,
            )
        return route

    @staticmethod
    def _matching_flags(text: str, patterns: tuple[tuple[str, str], ...]) -> list[str]:
        return [flag for flag, pattern in patterns if re.search(pattern, text, flags=re.IGNORECASE)]


def _status_messages(
    *,
    reading: str,
    loading: str,
    retrieving: str,
    checking: str,
    generating: str,
    writing: str,
) -> dict[str, str]:
    return {
        "reading_user_message": reading,
        "loading_client_profile": loading,
        "retrieving_trainer_knowledge": retrieving,
        "checking_recent_signals": checking,
        "generating_recommendation": generating,
        "writing_final_coach_response": writing,
    }
