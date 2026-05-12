from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

from app.modules.conversation.routing import (
    CLAUDE_SONNET_4_6_MODEL,
    GEMINI_FLASH_MODEL,
    GPT_5_4_MINI_MODEL,
    GPT_5_4_MODEL,
    RoutingDecision,
)


logger = logging.getLogger(__name__)

PROMPT_VERSIONS = {
    "system_v1": "prompts/system/v1.txt",
    "trainer_persona_v1": "prompts/trainer_persona/v1.txt",
    "safety_rules_v1": "prompts/safety/v1.txt",
}

TOKEN_BUDGETS = {
    "system": 400,
    "trainer_persona": 300,
    "user_digest": 500,
    "retrieved_memory": 600,
    "recent_chat": 800,
    "user_message": 300,
    "max_output": 1500,
}

TOKEN_BUDGETS_DEEP = {
    **TOKEN_BUDGETS,
    "max_output": 2500,
}

MODEL_ROUTING = {
    "FAST_PATH": {"provider": "gemini", "model": GEMINI_FLASH_MODEL, "tier": "fast"},
    "DEEP_PATH": {"provider": "openai", "model": GPT_5_4_MODEL, "tier": "full"},
    "SAFETY_ESCALATION": {"provider": "openai", "model": GPT_5_4_MODEL, "tier": "full"},
    "intent_classification": {"provider": "system", "model": "deterministic-sentry-router", "tier": "fast"},
    "memory_extraction": {"provider": "system", "model": "deterministic-memory-policy", "tier": "fast"},
    "conversation_summarization": {"provider": "system", "model": "deferred-summarizer", "tier": "fast"},
    "safety_classification": {"provider": "system", "model": "deterministic-safety-router", "tier": "fast"},
}

CostModel = Literal[
    "gemini-2.5-flash",
    "gpt-5.4-mini",
    "gpt-5.4",
    "claude-sonnet-4.6",
    "claude-sonnet-4-20250514",
]

MODEL_COST_PER_1K: dict[str, tuple[float, float]] = {
    GEMINI_FLASH_MODEL: (0.000075, 0.00030),
    GPT_5_4_MINI_MODEL: (0.00015, 0.00060),
    GPT_5_4_MODEL: (0.00250, 0.01000),
    CLAUDE_SONNET_4_6_MODEL: (0.00300, 0.01500),
    "claude-sonnet-4-20250514": (0.00300, 0.01500),
}


@dataclass(frozen=True)
class ProviderAttempt:
    provider: str
    model: str

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}"


def prompt_budgets_for_route(route: RoutingDecision) -> dict[str, int]:
    intent_route = getattr(route, "intent_route", None)
    intent = intent_route if isinstance(intent_route, dict) else {}
    flow = str(getattr(route, "flow", "") or "")
    if intent.get("route") == "DEEP_PATH" or flow in {"deep_path", "reasoning_structured", "safety_escalation"}:
        return TOKEN_BUDGETS_DEEP
    return TOKEN_BUDGETS


def prompt_version_for_route(route: RoutingDecision) -> str:
    if str(getattr(route, "flow", "") or "") == "safety_escalation":
        return "system_v1+safety_rules_v1"
    return "system_v1+trainer_persona_v1+safety_rules_v1"


def enforce_text_budget(slot: str, text: str, budgets: dict[str, int]) -> str:
    limit = int(budgets.get(slot) or 0)
    if limit <= 0:
        return text
    tokens = _approx_tokens(text)
    if tokens <= limit:
        return text
    words = str(text or "").split()
    clipped = " ".join(words[:limit]).rstrip()
    logger.warning(
        "prompt_budget_truncated slot=%s token_estimate=%s budget=%s",
        slot,
        tokens,
        limit,
    )
    return f"{clipped}\n[truncated: {slot} exceeded {limit} token budget]"


def provider_fallback_chain(route: RoutingDecision) -> list[ProviderAttempt]:
    primary = ProviderAttempt(route.provider, route.model)
    if route.flow == "safety_escalation":
        return [primary]

    attempts = [primary]
    if primary.provider == "openai" and primary.model != GPT_5_4_MINI_MODEL:
        attempts.append(ProviderAttempt("openai", GPT_5_4_MINI_MODEL))
    elif primary.provider != "openai":
        attempts.append(ProviderAttempt("openai", GPT_5_4_MINI_MODEL))

    attempts.append(ProviderAttempt("anthropic", CLAUDE_SONNET_4_6_MODEL))
    return _dedupe_attempts(attempts)


def estimate_cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float | None:
    rates = MODEL_COST_PER_1K.get(model)
    if not rates:
        return None
    input_rate, output_rate = rates
    return round((max(prompt_tokens, 0) / 1000.0 * input_rate) + (max(completion_tokens, 0) / 1000.0 * output_rate), 6)


@lru_cache(maxsize=8)
def load_prompt_template(version_key: str) -> str:
    relative = PROMPT_VERSIONS[version_key]
    root = Path(__file__).resolve().parents[3]
    return (root / relative).read_text().strip()


def _dedupe_attempts(attempts: list[ProviderAttempt]) -> list[ProviderAttempt]:
    deduped: list[ProviderAttempt] = []
    seen: set[tuple[str, str]] = set()
    for attempt in attempts:
        key = (attempt.provider, attempt.model)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(attempt)
    return deduped


def _approx_tokens(text: str) -> int:
    return len(str(text or "").split())
