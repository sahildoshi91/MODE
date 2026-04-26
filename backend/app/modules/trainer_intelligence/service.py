from __future__ import annotations

import re
import statistics
from datetime import datetime, timezone
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
RETRIEVAL_WEIGHTS = {
    "semantic_similarity": 0.45,
    "client_specific_boost": 0.25,
    "knowledge_type_match": 0.15,
    "recency_boost": 0.10,
    "usage_quality_score": 0.05,
}
KNOWLEDGE_TYPE_DISPLAY = {
    "rule": "Rule",
    "preference": "Preference",
    "faq": "FAQ",
    "note": "Note",
}


class TrainerIntelligenceService:
    RULE_LIMIT = 10
    DOC_LIMIT = 3
    KNOWLEDGE_ENTRY_CANDIDATE_LIMIT = 160
    KNOWLEDGE_CONTEXT_MAX = 5
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
        user_message: str | None = None,
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
        knowledge_entries = self.repository.list_active_knowledge_entries(
            trainer_id,
            limit=self.KNOWLEDGE_ENTRY_CANDIDATE_LIMIT,
        )
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

        knowledge_retrieval = self._rank_knowledge_entries(
            knowledge_entries=knowledge_entries,
            route=route,
            client_context=client_context,
            profile=merged_profile,
            client_id=client_id,
            user_message=user_message,
        )

        trainer_global_lines = self._build_trainer_global_lines(
            persona,
            rules,
            documents,
            knowledge_retrieval.get("selected_entries", []),
        )
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
                "knowledge_entries_selected": len(knowledge_retrieval.get("selected_entries", [])),
                "knowledge_retrieval": {
                    "formula_weights": RETRIEVAL_WEIGHTS,
                    "max_entries": self.KNOWLEDGE_CONTEXT_MAX,
                    **knowledge_retrieval,
                },
                "caps": {
                    "rules": self.RULE_LIMIT,
                    "documents": self.DOC_LIMIT,
                    "knowledge_candidates": self.KNOWLEDGE_ENTRY_CANDIDATE_LIMIT,
                    "knowledge_injected": self.KNOWLEDGE_CONTEXT_MAX,
                    "memory": self.MEMORY_LIMIT,
                    "checkins": self.CHECKIN_LIMIT,
                    "workouts": self.WORKOUT_LIMIT,
                },
                "ordering": {
                    "rules": "updated_at_desc",
                    "documents": "created_at_desc",
                    "knowledge": "weighted_heuristic_rank",
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

    def log_retrieval_usage(
        self,
        *,
        trainer_id: str | None,
        tenant_id: str | None,
        client_id: str | None,
        conversation_id: str | None,
        message_id: str | None,
        retrieval_metadata: dict[str, Any] | None,
    ) -> None:
        if not trainer_id or not tenant_id:
            return
        payload = retrieval_metadata if isinstance(retrieval_metadata, dict) else {}
        candidate_rows = payload.get("candidate_entries")
        selected_rows = payload.get("selected_entries")
        candidates = candidate_rows if isinstance(candidate_rows, list) else []
        selected = selected_rows if isinstance(selected_rows, list) else []
        selected_ids: set[str] = set()
        for item in selected:
            entry_id = str(item.get("knowledge_entry_id") or item.get("id") or "").strip()
            if entry_id:
                selected_ids.add(entry_id)
        if not candidates and not selected_ids:
            return

        existing_candidate_ids = {
            str(item.get("knowledge_entry_id") or item.get("id") or "").strip()
            for item in candidates
            if str(item.get("knowledge_entry_id") or item.get("id") or "").strip()
        }
        for selected_item in selected:
            selected_id = str(selected_item.get("knowledge_entry_id") or selected_item.get("id") or "").strip()
            if not selected_id or selected_id in existing_candidate_ids:
                continue
            candidates.append(selected_item)

        created_at_iso = datetime.now(timezone.utc).isoformat()
        logs: list[dict[str, Any]] = []
        for item in candidates[:24]:
            entry_id = str(item.get("knowledge_entry_id") or item.get("id") or "").strip()
            if not entry_id:
                continue
            score = item.get("score")
            try:
                normalized_score = float(score) if score is not None else None
            except (TypeError, ValueError):
                normalized_score = None
            logs.append(
                {
                    "tenant_id": tenant_id,
                    "trainer_id": trainer_id,
                    "client_id": client_id,
                    "knowledge_entry_id": entry_id,
                    "conversation_id": conversation_id,
                    "message_id": message_id,
                    "retrieval_score": normalized_score,
                    "used_in_response": entry_id in selected_ids,
                    "created_at": created_at_iso,
                }
            )
        if not logs:
            return
        self.repository.create_knowledge_usage_logs(logs)
        for entry_id in selected_ids:
            self.repository.increment_knowledge_entry_usage(
                trainer_id,
                entry_id,
                timestamp_iso=created_at_iso,
            )

    def _rank_knowledge_entries(
        self,
        *,
        knowledge_entries: list[dict[str, Any]],
        route: Any,
        client_context: dict[str, Any],
        profile: dict[str, Any],
        client_id: str,
        user_message: str | None,
    ) -> dict[str, Any]:
        query_segments = [
            str(user_message or ""),
            str(getattr(route, "task_type", "") or ""),
            str(getattr(route, "response_mode", "") or ""),
            str(getattr(route, "flow", "") or ""),
            str(client_context.get("entrypoint") or ""),
            str((profile or {}).get("primary_goal") or ""),
            str((profile or {}).get("experience_level") or ""),
            str((profile or {}).get("equipment_access") or ""),
        ]
        query_text = " ".join(segment.strip() for segment in query_segments if segment and segment.strip())
        query_tokens = self._normalize_memory_theme_tokens(query_text)

        scored: list[dict[str, Any]] = []
        for row in knowledge_entries:
            status = str(row.get("status") or "active").strip().lower()
            if status != "active":
                continue
            if bool(row.get("ai_enabled", True)) is not True:
                continue
            scope = str(row.get("scope") or "global").strip().lower().replace("-", "_")
            if scope in {"client_specific", "clientspecific"}:
                scope = "client"
            row_client_id = str(row.get("client_id") or "").strip() or None
            if scope == "client" and row_client_id != client_id:
                continue

            entry_tokens = self._entry_tokens(row)
            semantic_similarity = self._semantic_similarity(query_tokens, entry_tokens)
            client_specific_boost = 1.0 if scope == "client" and row_client_id == client_id else 0.0
            normalized_type = self._normalize_knowledge_type(str(row.get("knowledge_type") or row.get("type") or "note"))
            knowledge_type_match = self._knowledge_type_match_score(
                knowledge_type=normalized_type,
                query_tokens=query_tokens,
                route=route,
            )
            recency_boost = self._recency_boost(row.get("updated_at") or row.get("created_at"))
            usage_quality_score = self._usage_quality_score(
                usage_count=row.get("usage_count"),
                last_used_at=row.get("last_used_at"),
            )
            score = (
                semantic_similarity * RETRIEVAL_WEIGHTS["semantic_similarity"]
                + client_specific_boost * RETRIEVAL_WEIGHTS["client_specific_boost"]
                + knowledge_type_match * RETRIEVAL_WEIGHTS["knowledge_type_match"]
                + recency_boost * RETRIEVAL_WEIGHTS["recency_boost"]
                + usage_quality_score * RETRIEVAL_WEIGHTS["usage_quality_score"]
            )
            scored.append(
                {
                    **row,
                    "knowledge_entry_id": row.get("id"),
                    "knowledge_type": normalized_type,
                    "type": normalized_type,
                    "scope": scope,
                    "rule_priority": 1.0 if normalized_type == "rule" else 0.0,
                    "score": round(score, 6),
                    "semantic_similarity": round(semantic_similarity, 6),
                    "client_specific_boost": round(client_specific_boost, 6),
                    "knowledge_type_match": round(knowledge_type_match, 6),
                    "recency_boost": round(recency_boost, 6),
                    "usage_quality_score": round(usage_quality_score, 6),
                }
            )

        scored.sort(
            key=lambda item: (
                float(item.get("rule_priority") or 0.0),
                float(item.get("score") or 0.0),
                float(item.get("client_specific_boost") or 0.0),
                float(item.get("knowledge_type_match") or 0.0),
                str(item.get("updated_at") or ""),
            ),
            reverse=True,
        )
        selected = [*scored[: self.KNOWLEDGE_CONTEXT_MAX]]
        candidate_rows = [*scored[: min(24, len(scored))]]
        for item in candidate_rows:
            item["used_in_response"] = any(
                str(selected_item.get("knowledge_entry_id")) == str(item.get("knowledge_entry_id"))
                for selected_item in selected
            )
        return {
            "candidate_count": len(scored),
            "selected_count": len(selected),
            "selected_entries": selected,
            "candidate_entries": candidate_rows,
        }

    def _build_trainer_global_lines(
        self,
        persona: dict[str, Any],
        rules: list[dict[str, Any]],
        documents: list[dict[str, Any]],
        selected_knowledge_entries: list[dict[str, Any]],
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

        if selected_knowledge_entries:
            lines.append("TRAINER KNOWLEDGE CONTEXT:")
            for entry in selected_knowledge_entries[: self.KNOWLEDGE_CONTEXT_MAX]:
                knowledge_type = self._normalize_knowledge_type(
                    str(entry.get("knowledge_type") or entry.get("type") or "note")
                )
                label = KNOWLEDGE_TYPE_DISPLAY.get(knowledge_type, "Note")
                summary = str(entry.get("structured_summary") or "").strip()
                if not summary:
                    summary = str(entry.get("raw_content") or "").strip()[:240]
                if not summary:
                    continue
                lines.append(f"- {label}: {summary}")

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
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value
        if isinstance(value, str):
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    return parsed.replace(tzinfo=timezone.utc)
                return parsed
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

    def _entry_tokens(self, row: dict[str, Any]) -> set[str]:
        normalized_type = self._normalize_knowledge_type(str(row.get("knowledge_type") or row.get("type") or "note"))
        tags = row.get("tags")
        tag_text = " ".join(str(tag or "") for tag in tags) if isinstance(tags, list) else ""
        source = " ".join(
            [
                str(row.get("title") or ""),
                str(row.get("structured_summary") or ""),
                str(row.get("raw_content") or ""),
                normalized_type,
                tag_text,
            ]
        )
        return self._normalize_memory_theme_tokens(source)

    def _normalize_knowledge_type(self, value: str) -> str:
        normalized = str(value or "note").strip().lower().replace("-", "_").replace(" ", "_")
        if normalized in {"coaching_rule", "rules"}:
            return "rule"
        if normalized in {"programming_preference", "nutrition_principle", "communication_style", "business_policy"}:
            return "preference"
        if normalized == "client_pattern" or normalized == "other":
            return "note"
        if normalized not in {"note", "rule", "faq", "preference"}:
            return "note"
        return normalized

    def _semantic_similarity(self, query_tokens: set[str], entry_tokens: set[str]) -> float:
        if not entry_tokens:
            return 0.0
        if not query_tokens:
            return 0.25
        overlap = len(query_tokens.intersection(entry_tokens))
        if overlap == 0:
            return 0.0
        denominator = max(1, len(query_tokens.union(entry_tokens)))
        return min(1.0, overlap / denominator)

    def _knowledge_type_match_score(self, *, knowledge_type: str, query_tokens: set[str], route: Any) -> float:
        normalized_type = self._normalize_knowledge_type(knowledge_type)
        task_type = str(getattr(route, "task_type", "") or "").strip().lower()
        if normalized_type in task_type:
            return 1.0

        keyword_map: dict[str, set[str]] = {
            "rule": {"coach", "coaching", "guidance", "rule", "framework", "policy"},
            "preference": {"program", "programming", "sets", "reps", "volume", "intensity", "exercise", "nutrition"},
            "faq": {"faq", "answer", "question", "response", "template"},
            "note": {"note", "context", "pattern", "habit", "behavior"},
        }
        mapped_keywords = keyword_map.get(normalized_type, set())
        if not mapped_keywords:
            return 0.1
        overlap = len(query_tokens.intersection(mapped_keywords))
        if overlap == 0:
            return 0.0
        return min(1.0, overlap / len(mapped_keywords) * 2.0)

    def _recency_boost(self, value: Any) -> float:
        timestamp = self._coerce_datetime(value)
        if not timestamp:
            return 0.0
        now = datetime.now(timezone.utc)
        age_days = max(0.0, (now - timestamp).total_seconds() / 86400.0)
        if age_days <= 2:
            return 1.0
        if age_days <= 7:
            return 0.85
        if age_days <= 21:
            return 0.6
        if age_days <= 60:
            return 0.35
        return 0.1

    def _usage_quality_score(self, *, usage_count: Any, last_used_at: Any) -> float:
        try:
            count = max(0.0, float(usage_count or 0.0))
        except (TypeError, ValueError):
            count = 0.0
        count_score = min(1.0, count / 20.0)
        recent_score = self._recency_boost(last_used_at)
        return min(1.0, (count_score * 0.6) + (recent_score * 0.4))

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
