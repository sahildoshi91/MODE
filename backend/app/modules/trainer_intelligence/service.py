from __future__ import annotations

import re
import statistics
from datetime import datetime
from typing import Any

from app.core.tenancy import TrainerContext
from app.modules.trainer_intelligence.repository import TrainerIntelligenceRepository
from app.modules.trainer_intelligence.schemas import TrainerIntelligencePromptContext


LEGACY_TO_CANONICAL_MODE = {
    "GREEN": "BEAST",
    "YELLOW": "BUILD",
    "BLUE": "RECOVER",
    "RED": "REST",
}

MEMORY_THEME_STOPWORDS = {
    "a",
    "an",
    "and",
    "any",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "for",
    "from",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "so",
    "that",
    "the",
    "their",
    "them",
    "there",
    "they",
    "this",
    "to",
    "up",
    "we",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
    "you",
    "your",
}

ALPHANUMERIC_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


class TrainerIntelligenceService:
    RULE_LIMIT = 10
    DOC_LIMIT = 3
    MEMORY_LIMIT = 8
    CHECKIN_LIMIT = 7
    WORKOUT_LIMIT = 5

    def __init__(self, repository: TrainerIntelligenceRepository):
        self.repository = repository

    def assemble_prompt_context(
        self,
        *,
        trainer_context: TrainerContext,
        route: Any,
        client_context: dict[str, Any],
        profile: dict[str, Any],
    ) -> TrainerIntelligencePromptContext:
        trainer_id = trainer_context.trainer_id
        client_id = trainer_context.client_id
        if not trainer_id or not client_id:
            return TrainerIntelligencePromptContext(
                metadata={
                    "used": False,
                    "fallback_reason": "trainer_or_client_context_missing",
                }
            )

        persona = self.repository.get_default_persona(trainer_id) or {}
        rules = self.repository.list_active_rules(trainer_id, limit=self.RULE_LIMIT)
        documents = self.repository.list_recent_knowledge_documents(trainer_id, limit=self.DOC_LIMIT)
        memory_rows = self.repository.list_client_memory(trainer_id, client_id, limit=self.MEMORY_LIMIT * 2)
        ai_usable_memory = self._filter_ai_usable_memory(memory_rows)[: self.MEMORY_LIMIT]
        profile_snapshot = self.repository.get_profile(client_id) or {}
        merged_profile = {
            **profile_snapshot,
            **(profile or {}),
        }
        checkins = self.repository.list_recent_checkins(client_id, limit=self.CHECKIN_LIMIT)
        workouts = (
            self.repository.list_recent_completed_workouts(trainer_context.client_user_id, limit=self.WORKOUT_LIMIT)
            if trainer_context.client_user_id
            else []
        )

        trainer_global_lines = self._build_trainer_global_lines(persona, rules, documents)
        client_memory_lines = self._build_client_memory_lines(merged_profile, ai_usable_memory)
        analytics_lines = self._build_analytics_lines(checkins, workouts)
        output_context_lines = self._build_output_context_lines(route, client_context)
        safety_lines = self._build_safety_lines(route)

        system_appendix = "\n".join(
            [
                "TRAINER_INTELLIGENCE_CONTEXT_BEGIN",
                "[LAYER_1_TRAINER_GLOBAL_KNOWLEDGE]",
                *trainer_global_lines,
                "[LAYER_2_CLIENT_MEMORY_AI_USABLE_ONLY]",
                *client_memory_lines,
                "[LAYER_3_DYNAMIC_ANALYTICS]",
                *analytics_lines,
                "[LAYER_4_OUTPUT_CONTEXT]",
                *output_context_lines,
                "[LAYER_5_SAFETY_OVERRIDES]",
                *safety_lines,
                "TRAINER_INTELLIGENCE_CONTEXT_END",
            ]
        )
        user_appendix = (
            "Resolved client profile snapshot for this response: "
            f"{self._compact_profile_payload(merged_profile)}\n"
        )
        return TrainerIntelligencePromptContext(
            system_appendix=system_appendix,
            user_appendix=user_appendix,
            metadata={
                "used": True,
                "trainer_rules_count": len(rules),
                "memory_count": len(ai_usable_memory),
                "checkins_count": len(checkins),
                "workouts_count": len(workouts),
                "caps": {
                    "rules": self.RULE_LIMIT,
                    "documents": self.DOC_LIMIT,
                    "memory": self.MEMORY_LIMIT,
                    "checkins": self.CHECKIN_LIMIT,
                    "workouts": self.WORKOUT_LIMIT,
                },
                "ordering": {
                    "rules": "updated_at_desc",
                    "documents": "created_at_desc",
                    "memory": "updated_at_desc",
                    "checkins": "date_desc",
                    "workouts": "created_at_desc",
                },
            },
        )

    def is_question_covered_by_memory_theme(
        self,
        *,
        trainer_id: str,
        client_id: str,
        question: str,
    ) -> dict[str, Any]:
        normalized_question_phrase = self._normalize_memory_theme_phrase(question)
        question_tokens = self._normalize_memory_theme_tokens(question)
        if not question_tokens:
            return {
                "covered": False,
                "reason": "question_missing_signal",
            }

        memory_rows = self.repository.list_client_memory(
            trainer_id,
            client_id,
            limit=self.MEMORY_LIMIT * 4,
        )
        ai_usable_memory = self._filter_ai_usable_memory(memory_rows)
        if not ai_usable_memory:
            return {
                "covered": False,
                "reason": "no_ai_usable_memory",
            }

        for memory in ai_usable_memory:
            candidate_text = self._memory_theme_candidate_text(memory)
            candidate_phrase = self._normalize_memory_theme_phrase(candidate_text)
            candidate_tokens = self._normalize_memory_theme_tokens(candidate_text)
            if not candidate_tokens:
                continue

            if self._has_strong_phrase_containment(normalized_question_phrase, candidate_phrase):
                return {
                    "covered": True,
                    "reason": "phrase_containment",
                    "matched_memory_key": memory.get("memory_key"),
                }

            overlap_count = len(question_tokens.intersection(candidate_tokens))
            if overlap_count < 3:
                continue
            overlap_ratio = overlap_count / max(1, len(question_tokens))
            if overlap_ratio >= 0.65:
                return {
                    "covered": True,
                    "reason": "token_overlap",
                    "matched_memory_key": memory.get("memory_key"),
                    "overlap_ratio": round(overlap_ratio, 3),
                    "overlap_count": overlap_count,
                }

        return {
            "covered": False,
            "reason": "no_strong_match",
        }

    def _build_trainer_global_lines(
        self,
        persona: dict[str, Any],
        rules: list[dict[str, Any]],
        documents: list[dict[str, Any]],
    ) -> list[str]:
        lines: list[str] = []
        persona_name = str(persona.get("persona_name") or "").strip() or "Default Coach"
        tone = str(persona.get("tone_description") or "").strip()
        philosophy = str(persona.get("coaching_philosophy") or "").strip()
        lines.append(f"persona_name: {persona_name}")
        if tone:
            lines.append(f"tone_description: {tone[:220]}")
        if philosophy:
            lines.append(f"coaching_philosophy: {philosophy[:300]}")

        for index, rule in enumerate(rules[: self.RULE_LIMIT], start=1):
            category = str(rule.get("category") or "general_coaching").strip().lower()
            text = str(rule.get("rule_text") or "").strip()
            if not text:
                continue
            lines.append(f"rule_{index}: [{category}] {text[:240]}")

        for index, document in enumerate(documents[: self.DOC_LIMIT], start=1):
            title = str(document.get("title") or "").strip() or f"Knowledge doc {index}"
            raw_text = str(document.get("raw_text") or "").strip()
            if raw_text:
                lines.append(f"knowledge_{index}: {title} - {raw_text[:220]}")
            else:
                lines.append(f"knowledge_{index}: {title}")

        if len(lines) == 1:
            lines.append("No explicit trainer-global rules were retrieved.")
        return lines

    def _build_client_memory_lines(
        self,
        profile_snapshot: dict[str, Any],
        ai_usable_memory: list[dict[str, Any]],
    ) -> list[str]:
        lines: list[str] = []
        goal = str(profile_snapshot.get("primary_goal") or "unspecified").strip()
        experience = str(profile_snapshot.get("experience_level") or "unknown").strip()
        equipment = str(profile_snapshot.get("equipment_access") or "unknown").strip()
        lines.append(f"profile_goal: {goal}")
        lines.append(f"profile_experience_level: {experience}")
        lines.append(f"profile_equipment_access: {equipment}")

        if not ai_usable_memory:
            lines.append("No ai_usable coach_memory entries are available for this client.")
            return lines

        for index, memory in enumerate(ai_usable_memory, start=1):
            memory_type = str(memory.get("memory_type") or "note").strip().lower()
            memory_key = str(memory.get("memory_key") or "").strip()
            memory_text = str(memory.get("text") or "").strip()
            memory_tags = memory.get("tags")
            tag_suffix = ""
            if isinstance(memory_tags, list) and memory_tags:
                normalized_tags = [str(tag).strip().lower() for tag in memory_tags if str(tag or "").strip()]
                if normalized_tags:
                    tag_suffix = f" tags={normalized_tags[:6]}"
            if memory_text:
                lines.append(f"memory_{index}: [{memory_type}] ({memory_key}) {memory_text[:220]}{tag_suffix}")
        return lines

    def _build_analytics_lines(self, checkins: list[dict[str, Any]], workouts: list[dict[str, Any]]) -> list[str]:
        lines: list[str] = []
        if not checkins:
            lines.append("No recent daily_checkins were found.")
        else:
            scores: list[float] = []
            modes: list[str] = []
            for row in checkins:
                total_score = row.get("total_score")
                if total_score is not None:
                    try:
                        scores.append(float(total_score))
                    except (TypeError, ValueError):
                        pass
                mode = self._normalize_mode(row.get("assigned_mode"))
                if mode:
                    modes.append(mode)
            if scores:
                lines.append(f"readiness_avg_score_last_{len(scores)}: {round(statistics.fmean(scores), 2)}")
            if modes:
                lines.append(f"dominant_mode_recent: {self._most_common(modes)}")
            latest_date = checkins[0].get("date")
            if latest_date:
                lines.append(f"latest_checkin_date: {latest_date}")

        lines.append(f"completed_workouts_recent: {len(workouts)}")
        if workouts:
            latest_workout_at = workouts[0].get("created_at")
            if latest_workout_at:
                lines.append(f"latest_completed_workout_at: {latest_workout_at}")
        return lines

    def _build_output_context_lines(self, route: Any, client_context: dict[str, Any]) -> list[str]:
        lines: list[str] = []
        task_type = str(getattr(route, "task_type", "") or "unknown")
        response_mode = str(getattr(route, "response_mode", "") or "unknown")
        flow = str(getattr(route, "flow", "") or "unknown")
        lines.append(f"task_type: {task_type}")
        lines.append(f"response_mode: {response_mode}")
        lines.append(f"flow: {flow}")

        entrypoint = str(client_context.get("entrypoint") or "").strip()
        if entrypoint:
            lines.append(f"entrypoint: {entrypoint}")
        if isinstance(client_context.get("checkin_context"), dict):
            checkin_context = client_context.get("checkin_context") or {}
            lines.append(
                "checkin_context: "
                f"mode={checkin_context.get('assigned_mode')} score={checkin_context.get('checkin_score')}"
            )
        return lines

    def _build_safety_lines(self, route: Any) -> list[str]:
        lines = [
            "Never claim medical diagnosis or certainty.",
            "Differentiate known facts from inference.",
            "If symptoms imply elevated risk, prioritize conservative next steps and suggest appropriate professional care.",
        ]
        if str(getattr(route, "task_type", "") or "").strip().lower() == "safety_risk":
            lines.append("Route flagged safety_risk: keep guidance bounded and risk-aware.")
        return lines

    def _compact_profile_payload(self, profile: dict[str, Any]) -> dict[str, Any]:
        allowed_keys = (
            "primary_goal",
            "experience_level",
            "equipment_access",
            "onboarding_status",
            "preferred_session_length",
        )
        return {key: profile.get(key) for key in allowed_keys if key in profile}

    def _filter_ai_usable_memory(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        filtered: list[dict[str, Any]] = []
        for row in rows:
            value_json = row.get("value_json")
            value = value_json if isinstance(value_json, dict) else {}
            if bool(value.get("is_archived")):
                continue
            visibility = str(value.get("visibility") or "internal_only").strip().lower()
            if visibility != "ai_usable":
                continue
            text = str(value.get("text") or "").strip()
            if not text:
                continue
            filtered.append(
                {
                    "id": row.get("id"),
                    "memory_type": row.get("memory_type"),
                    "memory_key": row.get("memory_key"),
                    "text": text,
                    "tags": self._normalize_tags(value.get("tags")),
                    "updated_at": self._coerce_datetime(row.get("updated_at")),
                }
            )
        filtered.sort(
            key=lambda item: item.get("updated_at") or datetime.min,
            reverse=True,
        )
        return filtered

    def _coerce_datetime(self, value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
        return None

    def _normalize_tags(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        tags: list[str] = []
        seen: set[str] = set()
        for item in value:
            tag = str(item or "").strip().lower()
            if not tag or tag in seen:
                continue
            seen.add(tag)
            tags.append(tag[:40])
        return tags

    def _normalize_mode(self, mode: Any) -> str | None:
        if not mode:
            return None
        text = str(mode).strip().upper()
        return LEGACY_TO_CANONICAL_MODE.get(text, text)

    def _most_common(self, values: list[str]) -> str:
        if not values:
            return "UNKNOWN"
        counts: dict[str, int] = {}
        for value in values:
            counts[value] = counts.get(value, 0) + 1
        return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]

    def _memory_theme_candidate_text(self, memory: dict[str, Any]) -> str:
        parts: list[str] = []
        memory_text = str(memory.get("text") or "").strip()
        if memory_text:
            parts.append(memory_text)

        memory_key = str(memory.get("memory_key") or "").strip()
        if memory_key:
            parts.append(memory_key)

        tags = memory.get("tags")
        if isinstance(tags, list):
            normalized_tags = [str(tag).strip() for tag in tags if str(tag or "").strip()]
            if normalized_tags:
                parts.append(" ".join(normalized_tags))

        return " ".join(parts)

    def _normalize_memory_theme_tokens(self, text: str) -> set[str]:
        tokens = ALPHANUMERIC_TOKEN_PATTERN.findall((text or "").lower())
        return {
            token
            for token in tokens
            if len(token) >= 3 and token not in MEMORY_THEME_STOPWORDS
        }

    def _normalize_memory_theme_phrase(self, text: str) -> str:
        tokens = ALPHANUMERIC_TOKEN_PATTERN.findall((text or "").lower())
        if not tokens:
            return ""
        return " ".join(tokens)

    def _has_strong_phrase_containment(self, left: str, right: str) -> bool:
        if not left or not right:
            return False
        if len(left) >= 24 and left in right:
            return True
        if len(right) >= 24 and right in left:
            return True
        return False
