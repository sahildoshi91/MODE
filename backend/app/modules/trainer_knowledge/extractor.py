from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.ai.client import GPT_5_4_MINI_MODEL, OpenAIClient
from app.core.config import settings


logger = logging.getLogger(__name__)

ALLOWED_RULE_CATEGORIES = (
    "training_philosophy",
    "nutrition_philosophy",
    "progression_logic",
    "recovery_deload_logic",
    "motivational_style",
    "communication_tone",
    "adjustment_rules",
    "contraindications",
    "general_coaching",
)

CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "training_philosophy": (
        "training philosophy",
        "movement quality",
        "technique",
        "form first",
        "coaching philosophy",
    ),
    "nutrition_philosophy": (
        "nutrition",
        "meal",
        "protein",
        "carb",
        "calorie",
        "macros",
        "hydration",
    ),
    "progression_logic": (
        "progressive overload",
        "progression",
        "increase load",
        "volume",
        "intensity",
        "rep range",
    ),
    "recovery_deload_logic": (
        "recovery",
        "deload",
        "rest day",
        "sleep",
        "fatigue",
        "readiness",
    ),
    "motivational_style": (
        "motivation",
        "accountability",
        "mindset",
        "encourage",
        "confidence",
    ),
    "communication_tone": (
        "tone",
        "voice",
        "communication style",
        "speak to clients",
    ),
    "adjustment_rules": (
        "adjust",
        "modify",
        "substitute",
        "if stress",
        "if sore",
        "if pain",
        "time constrained",
    ),
    "contraindications": (
        "contraindication",
        "avoid",
        "do not",
        "injury",
        "pregnant",
        "medical",
        "limitation",
    ),
}


class TrainerRuleExtractor:
    def __init__(self, openai_client: OpenAIClient | None = None):
        self.openai_client = openai_client or self._init_openai_client()

    def extract(
        self,
        *,
        raw_text: str,
        title: str | None = None,
        max_rules: int = 24,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        deterministic_rules = self._extract_deterministic_rules(raw_text, max_rules=max_rules)
        summary: dict[str, Any] = {
            "strategy": "deterministic",
            "llm_attempted": False,
            "llm_succeeded": False,
            "fallback_reason": None,
            "rules_created": len(deterministic_rules),
        }
        rules = deterministic_rules

        if self.openai_client and deterministic_rules:
            summary["llm_attempted"] = True
            try:
                llm_rules = self._extract_llm_normalized_rules(
                    raw_text=raw_text,
                    title=title,
                    deterministic_rules=deterministic_rules,
                    max_rules=max_rules,
                )
                if llm_rules:
                    rules = llm_rules
                    summary["strategy"] = "hybrid_llm_normalized"
                    summary["llm_succeeded"] = True
                else:
                    summary["fallback_reason"] = "llm_empty_output"
            except Exception as exc:  # pragma: no cover - exercised by runtime provider issues.
                logger.exception("Trainer rule extraction LLM normalization failed")
                summary["fallback_reason"] = exc.__class__.__name__
        elif not self.openai_client:
            summary["fallback_reason"] = "openai_client_not_configured"

        rules = self._deduplicate_rules(rules)[:max_rules]
        if not rules and deterministic_rules:
            rules = deterministic_rules[:max_rules]
        summary["rules_created"] = len(rules)
        return rules, summary

    def _init_openai_client(self) -> OpenAIClient | None:
        if not settings.openai_api_key:
            return None
        try:
            return OpenAIClient()
        except Exception:  # pragma: no cover - exercised by runtime provider issues.
            logger.exception("Trainer rule extractor could not initialize OpenAI client")
            return None

    def _extract_deterministic_rules(self, raw_text: str, *, max_rules: int) -> list[dict[str, Any]]:
        candidates = self._candidate_fragments(raw_text)
        rules: list[dict[str, Any]] = []
        for fragment in candidates:
            category, keyword_matches = self._classify_category(fragment)
            confidence = 0.55 + min(keyword_matches, 3) * 0.1
            confidence = max(0.1, min(0.95, round(confidence, 3)))
            rules.append(
                {
                    "category": category,
                    "rule_text": fragment,
                    "confidence": confidence,
                    "source_excerpt": fragment[:280],
                    "metadata": {
                        "source": "deterministic",
                    },
                }
            )
            if len(rules) >= max_rules:
                break

        if rules:
            return self._deduplicate_rules(rules)

        fallback = raw_text.strip()
        if not fallback:
            return []
        return [
            {
                "category": "general_coaching",
                "rule_text": fallback[:420],
                "confidence": 0.4,
                "source_excerpt": fallback[:280],
                "metadata": {"source": "deterministic_fallback"},
            }
        ]

    def _candidate_fragments(self, raw_text: str) -> list[str]:
        if not raw_text:
            return []

        raw_lines = [line.strip() for line in raw_text.splitlines() if line and line.strip()]
        cleaned_lines = []
        for line in raw_lines:
            sanitized = re.sub(r"^\s*([-*]|\d+[.)])\s*", "", line).strip()
            if len(sanitized) >= 18:
                cleaned_lines.append(sanitized)

        sentence_fragments = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?])\s+", raw_text)
            if sentence and sentence.strip()
        ]
        merged: list[str] = []
        seen: set[str] = set()
        for fragment in [*cleaned_lines, *sentence_fragments]:
            normalized = re.sub(r"\s+", " ", fragment).strip()
            if len(normalized) < 18:
                continue
            if len(normalized) > 420:
                normalized = normalized[:420].strip()
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            merged.append(normalized)
        return merged

    def _classify_category(self, text: str) -> tuple[str, int]:
        lowered = text.lower()
        best_category = "general_coaching"
        best_matches = 0
        for category, keywords in CATEGORY_KEYWORDS.items():
            matches = sum(1 for keyword in keywords if keyword in lowered)
            if matches > best_matches:
                best_category = category
                best_matches = matches
        return best_category, best_matches

    def _extract_llm_normalized_rules(
        self,
        *,
        raw_text: str,
        title: str | None,
        deterministic_rules: list[dict[str, Any]],
        max_rules: int,
    ) -> list[dict[str, Any]]:
        if not self.openai_client:
            return []

        prompt_payload = {
            "title": title or "",
            "allowed_categories": list(ALLOWED_RULE_CATEGORIES),
            "deterministic_candidates": deterministic_rules[:24],
            "raw_text": raw_text[:9000],
            "max_rules": max_rules,
        }
        completion = self.openai_client.create_chat_completion_with_usage(
            model=GPT_5_4_MINI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You normalize coaching notes into structured rules.\n"
                        "Return a strict JSON object with one key: rules.\n"
                        "rules is an array of objects with: category, rule_text, confidence, source_excerpt.\n"
                        "category must be one of allowed_categories.\n"
                        "confidence must be between 0 and 1.\n"
                        "Do not include extra keys."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(prompt_payload),
                },
            ],
        )
        payload = self._parse_json_object(completion.text)
        raw_rules = payload.get("rules") if isinstance(payload, dict) else None
        if not isinstance(raw_rules, list):
            return []

        normalized_rules: list[dict[str, Any]] = []
        for rule in raw_rules:
            if not isinstance(rule, dict):
                continue
            text = str(rule.get("rule_text") or "").strip()
            if not text:
                continue

            category = self._normalize_category(rule.get("category"), fallback_text=text)
            confidence = self._normalize_confidence(rule.get("confidence"))
            source_excerpt = str(rule.get("source_excerpt") or text).strip()[:280]
            normalized_rules.append(
                {
                    "category": category,
                    "rule_text": text[:420],
                    "confidence": confidence,
                    "source_excerpt": source_excerpt,
                    "metadata": {
                        "source": "llm_normalized",
                    },
                }
            )

        return self._deduplicate_rules(normalized_rules)

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

    def _normalize_category(self, category_value: Any, *, fallback_text: str) -> str:
        category = str(category_value or "").strip().lower()
        if category in ALLOWED_RULE_CATEGORIES:
            return category
        classified, _matches = self._classify_category(fallback_text)
        return classified if classified in ALLOWED_RULE_CATEGORIES else "general_coaching"

    def _normalize_confidence(self, confidence_value: Any) -> float:
        try:
            confidence = float(confidence_value)
        except (TypeError, ValueError):
            return 0.7
        if confidence > 1:
            confidence = confidence / 100
        return round(max(0.0, min(1.0, confidence)), 3)

    def _deduplicate_rules(self, rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for rule in rules:
            category = str(rule.get("category") or "general_coaching").strip().lower()
            rule_text = str(rule.get("rule_text") or "").strip()
            if not rule_text:
                continue
            key = (category, rule_text.lower())
            if key in seen:
                continue
            seen.add(key)
            deduped.append(
                {
                    "category": category,
                    "rule_text": rule_text,
                    "confidence": self._normalize_confidence(rule.get("confidence")),
                    "source_excerpt": str(rule.get("source_excerpt") or rule_text).strip()[:280],
                    "metadata": rule.get("metadata") if isinstance(rule.get("metadata"), dict) else {},
                }
            )
        return deduped
