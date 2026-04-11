from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from app.ai.client import GPT_5_4_MINI_MODEL, OpenAIClient
from app.core.config import settings


logger = logging.getLogger(__name__)

PREFERENCE_KEYWORDS = (
    "prefer",
    "prefers",
    "likes",
    "enjoys",
    "favorite",
    "motivated by",
    "wants",
    "schedule",
    "morning",
    "evening",
)

CONSTRAINT_KEYWORDS = (
    "avoid",
    "cannot",
    "can't",
    "injury",
    "pain",
    "contraindication",
    "limit",
    "limited",
    "no equipment",
    "allergy",
)


class FeedbackDeltaExtractor:
    def __init__(self, openai_client: OpenAIClient | None = None):
        self.openai_client = openai_client or self._init_openai_client()

    def extract(
        self,
        *,
        original_text: str | None,
        edited_text: str | None,
        max_deltas: int = 6,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        deterministic_deltas = self._extract_deterministic(
            original_text=original_text,
            edited_text=edited_text,
            max_deltas=max_deltas,
        )
        summary: dict[str, Any] = {
            "strategy": "deterministic",
            "llm_attempted": False,
            "llm_succeeded": False,
            "fallback_reason": None,
            "deltas_count": len(deterministic_deltas),
        }
        deltas = deterministic_deltas

        if self.openai_client and deterministic_deltas:
            summary["llm_attempted"] = True
            try:
                llm_deltas = self._extract_llm_normalized(
                    original_text=original_text or "",
                    edited_text=edited_text or "",
                    deterministic_deltas=deterministic_deltas,
                    max_deltas=max_deltas,
                )
                if llm_deltas:
                    deltas = llm_deltas
                    summary["strategy"] = "hybrid_llm_normalized"
                    summary["llm_succeeded"] = True
                else:
                    summary["fallback_reason"] = "llm_empty_output"
            except Exception as exc:  # pragma: no cover
                logger.exception("Feedback delta extraction LLM normalization failed")
                summary["fallback_reason"] = exc.__class__.__name__
        elif not self.openai_client:
            summary["fallback_reason"] = "openai_client_not_configured"

        summary["deltas_count"] = len(deltas)
        return deltas[:max_deltas], summary

    def _extract_deterministic(
        self,
        *,
        original_text: str | None,
        edited_text: str | None,
        max_deltas: int,
    ) -> list[dict[str, Any]]:
        edited = (edited_text or "").strip()
        if not edited:
            return []
        original = (original_text or "").strip()

        candidates = self._candidate_lines(edited)
        deltas: list[dict[str, Any]] = []
        for line in candidates:
            if original and line.lower() in original.lower():
                continue
            memory_type = self._classify_memory_type(line)
            tags = self._extract_tags(line)
            deltas.append(
                {
                    "memory_type": memory_type,
                    "text": line,
                    "memory_key": self._memory_key(memory_type, line),
                    "tags": tags,
                    "source": "deterministic",
                }
            )
            if len(deltas) >= max_deltas:
                break

        if deltas:
            return self._dedupe_deltas(deltas)
        if edited:
            memory_type = self._classify_memory_type(edited)
            return [
                {
                    "memory_type": memory_type,
                    "text": edited[:260],
                    "memory_key": self._memory_key(memory_type, edited),
                    "tags": self._extract_tags(edited),
                    "source": "deterministic_fallback",
                }
            ]
        return []

    def _extract_llm_normalized(
        self,
        *,
        original_text: str,
        edited_text: str,
        deterministic_deltas: list[dict[str, Any]],
        max_deltas: int,
    ) -> list[dict[str, Any]]:
        if not self.openai_client:
            return []

        payload = {
            "original_text": original_text[:3000],
            "edited_text": edited_text[:3000],
            "deterministic_deltas": deterministic_deltas,
            "allowed_memory_types": ["note", "preference", "constraint"],
            "max_deltas": max_deltas,
        }
        completion = self.openai_client.create_chat_completion_with_usage(
            model=GPT_5_4_MINI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Extract trainer-approved client memory deltas.\n"
                        "Return strict JSON with one key `deltas`.\n"
                        "`deltas` must be an array of objects with: memory_type, text, memory_key, tags.\n"
                        "memory_type must be one of note/preference/constraint.\n"
                        "tags must be an array of short strings.\n"
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
        raw_deltas = parsed.get("deltas") if isinstance(parsed, dict) else None
        if not isinstance(raw_deltas, list):
            return []

        normalized: list[dict[str, Any]] = []
        for delta in raw_deltas:
            if not isinstance(delta, dict):
                continue
            memory_type = self._normalize_memory_type(delta.get("memory_type"))
            text = str(delta.get("text") or "").strip()
            if not text:
                continue
            memory_key = str(delta.get("memory_key") or "").strip()
            if not memory_key:
                memory_key = self._memory_key(memory_type, text)
            tags = delta.get("tags")
            normalized.append(
                {
                    "memory_type": memory_type,
                    "text": text[:260],
                    "memory_key": memory_key[:96],
                    "tags": self._normalize_tags(tags),
                    "source": "llm_normalized",
                }
            )
        return self._dedupe_deltas(normalized)

    def _candidate_lines(self, edited_text: str) -> list[str]:
        raw_lines = [
            re.sub(r"^\s*([-*]|\d+[.)])\s*", "", line).strip()
            for line in edited_text.splitlines()
            if line and line.strip()
        ]
        sentence_lines = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?])\s+", edited_text)
            if sentence and sentence.strip()
        ]
        candidates: list[str] = []
        seen: set[str] = set()
        for line in [*raw_lines, *sentence_lines]:
            normalized = re.sub(r"\s+", " ", line).strip()
            if len(normalized) < 18:
                continue
            if len(normalized) > 260:
                normalized = normalized[:260].strip()
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            candidates.append(normalized)
        return candidates

    def _classify_memory_type(self, text: str) -> str:
        lowered = text.lower()
        if any(keyword in lowered for keyword in CONSTRAINT_KEYWORDS):
            return "constraint"
        if any(keyword in lowered for keyword in PREFERENCE_KEYWORDS):
            return "preference"
        return "note"

    def _extract_tags(self, text: str) -> list[str]:
        lowered = text.lower()
        tags: list[str] = []
        for keyword in ("knee", "back", "shoulder", "sleep", "nutrition", "schedule", "motivation", "equipment"):
            if keyword in lowered:
                tags.append(keyword)
        return tags[:6]

    def _memory_key(self, memory_type: str, text: str) -> str:
        base = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
        if not base:
            base = "memory"
        fingerprint = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
        return f"{memory_type}_{base[:48]}_{fingerprint}"

    def _normalize_memory_type(self, value: Any) -> str:
        text = str(value or "").strip().lower()
        if text in {"note", "preference", "constraint"}:
            return text
        return "note"

    def _normalize_tags(self, tags: Any) -> list[str]:
        if not isinstance(tags, list):
            return []
        normalized: list[str] = []
        for tag in tags:
            text = str(tag or "").strip().lower()
            if text:
                normalized.append(text[:40])
        return normalized[:8]

    def _dedupe_deltas(self, deltas: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for delta in deltas:
            memory_type = self._normalize_memory_type(delta.get("memory_type"))
            text = str(delta.get("text") or "").strip()
            if not text:
                continue
            key = (memory_type, text.lower())
            if key in seen:
                continue
            seen.add(key)
            deduped.append(
                {
                    "memory_type": memory_type,
                    "text": text,
                    "memory_key": str(delta.get("memory_key") or self._memory_key(memory_type, text)),
                    "tags": self._normalize_tags(delta.get("tags")),
                    "source": delta.get("source") or "deterministic",
                }
            )
        return deduped

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

    def _init_openai_client(self) -> OpenAIClient | None:
        if not settings.openai_api_key:
            return None
        try:
            return OpenAIClient()
        except Exception:  # pragma: no cover
            logger.exception("Feedback delta extractor could not initialize OpenAI client")
            return None
