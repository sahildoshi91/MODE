from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from app.ai.client import GPT_5_4_MINI_MODEL, OpenAIClient
from app.core.config import settings
from app.modules.atlas.repository import AtlasRepository
from app.modules.atlas.schemas import (
    AtlasExtractorOutput,
    AtlasKnowledgeItem,
    AtlasReviewQueueItem,
    AtlasSanitizationResult,
    TrainerAiKnowledgeItem,
    TrainerAiReviewQueueItem,
)


logger = logging.getLogger(__name__)

ALLOWED_KNOWLEDGE_TYPES = {
    "adherence_strategy",
    "motivation_strategy",
    "programming_rule",
    "injury_modification_rule",
    "nutrition_coaching_pattern",
    "tone_pattern",
    "escalation_rule",
    "expectation_setting",
    "behavior_change_pattern",
    "accountability_pattern",
}
PII_REPLACEMENTS: tuple[tuple[str, str, str, float], ...] = (
    (r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[EMAIL]", "email", 0.30),
    (r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b", "[PHONE]", "phone", 0.30),
    (r"https?://\S+|www\.\S+", "[URL]", "url", 0.25),
    (r"(?<!\w)@[A-Za-z0-9_]{3,30}\b", "[SOCIAL_HANDLE]", "social_handle", 0.20),
    (r"\b\d{4}-\d{2}-\d{2}\b", "[DATE]", "exact_date", 0.18),
    (
        r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|"
        r"Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\b",
        "[DATE]",
        "exact_date",
        0.18,
    ),
    (r"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b", "[SCHEDULE_DAY]", "exact_schedule", 0.12),
    (r"\b\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm)\b", "[TIME]", "exact_schedule", 0.12),
    (
        r"\b\d{1,6}\s+[A-Za-z0-9.' -]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way)\b",
        "[ADDRESS]",
        "address",
        0.30,
    ),
    (r"\b(?:Equinox|Life\s?Time|LA Fitness|Planet Fitness|Gold's Gym|OrangeTheory|Barry's)\b", "[GYM]", "gym_name", 0.18),
)
GENERIC_NAME_PATTERN = re.compile(
    r"\b([A-Z][a-z]{2,})\s+(missed|said|prefers|wants|trained|checked|needs|has|had|told|asked)\b"
)
TITLE_CASE_NAME_PATTERN = re.compile(r"\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clamp_score(value: Any, *, default: float = 0.0) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        score = default
    if score > 1:
        score = score / 100
    return round(max(0.0, min(1.0, score)), 3)


def _as_text(value: Any) -> str:
    return str(value or "").strip()


def _field(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _normalize_tags(values: Any, *, limit: int = 8) -> list[str]:
    if not isinstance(values, list):
        return []
    tags: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = re.sub(r"[^a-z0-9_]+", "_", str(value or "").strip().lower()).strip("_")
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        tags.append(normalized[:48])
        if len(tags) >= limit:
            break
    return tags


class AtlasPiiSanitizer:
    def sanitize(
        self,
        text: str | None,
        *,
        known_names: list[str] | None = None,
        known_identity_values: list[str] | None = None,
    ) -> AtlasSanitizationResult:
        sanitized = str(text or "").strip()
        if not sanitized:
            return AtlasSanitizationResult(sanitized_text="", privacy_risk_score=0.0, privacy_flags=[])

        flags: list[str] = []
        risk = 0.0
        for pattern, replacement, flag, flag_risk in PII_REPLACEMENTS:
            regex = re.compile(pattern, re.IGNORECASE)
            if regex.search(sanitized):
                sanitized = regex.sub(replacement, sanitized)
                flags.append(flag)
                risk += flag_risk

        for raw_value in known_identity_values or []:
            value = str(raw_value or "").strip()
            if len(value) < 3:
                continue
            pattern = re.compile(re.escape(value), re.IGNORECASE)
            if pattern.search(sanitized):
                sanitized = pattern.sub("[IDENTITY]", sanitized)
                flags.append("known_identity")
                risk += 0.20

        for raw_name in known_names or []:
            name = str(raw_name or "").strip()
            if len(name) < 2:
                continue
            for part in [name, *name.split()]:
                if len(part) < 2:
                    continue
                pattern = re.compile(rf"\b{re.escape(part)}\b", re.IGNORECASE)
                if pattern.search(sanitized):
                    sanitized = pattern.sub("[NAME]", sanitized)
                    flags.append("known_name")
                    risk += 0.12

        if TITLE_CASE_NAME_PATTERN.search(sanitized):
            sanitized = TITLE_CASE_NAME_PATTERN.sub("[NAME]", sanitized)
            flags.append("possible_name")
            risk += 0.15

        if GENERIC_NAME_PATTERN.search(sanitized):
            sanitized = GENERIC_NAME_PATTERN.sub(r"[NAME] \2", sanitized)
            flags.append("possible_name")
            risk += 0.15

        if self._contains_unredacted_pii(sanitized):
            flags.append("unredacted_pii")
            risk += 0.35

        sanitized = re.sub(r"\s+", " ", sanitized).strip()
        return AtlasSanitizationResult(
            sanitized_text=sanitized[:1600],
            privacy_risk_score=_clamp_score(risk),
            privacy_flags=sorted(set(flags)),
        )

    def _contains_unredacted_pii(self, text: str) -> bool:
        if re.search(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", text, re.IGNORECASE):
            return True
        if re.search(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b", text):
            return True
        if re.search(r"https?://\S+|www\.\S+", text, re.IGNORECASE):
            return True
        return False


class AtlasLearningGeneralizer:
    def generalize(self, sanitized_text: str, *, knowledge_type: str) -> str:
        text = re.sub(r"\[(?:NAME|EMAIL|PHONE|ADDRESS|DATE|TIME|GYM|URL|SOCIAL_HANDLE|IDENTITY)\]", "a client", sanitized_text)
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return ""
        if knowledge_type == "adherence_strategy":
            return "When adherence drops, reduce the next commitment to a clear small action and rebuild momentum."
        if knowledge_type == "nutrition_coaching_pattern":
            return "Use habit-based nutrition coaching before escalating to detailed targets unless the context clearly calls for it."
        if knowledge_type == "injury_modification_rule":
            return "When pain or injury context appears, reduce impact, modify the movement, and avoid pushing through symptoms."
        if knowledge_type == "tone_pattern":
            return "Match the trainer's preferred tone with concise, direct, non-shaming language."
        if knowledge_type == "accountability_pattern":
            return "Use accountability as a next-step commitment, not as pressure or shame."
        return f"General coaching pattern: {text[:420]}"


class AtlasLearningExtractor:
    def __init__(
        self,
        *,
        generalizer: AtlasLearningGeneralizer | None = None,
        openai_client: OpenAIClient | None = None,
    ):
        self.generalizer = generalizer or AtlasLearningGeneralizer()
        self.openai_client = openai_client

    def extract(
        self,
        *,
        event_type: str,
        sanitized_summary: str,
        privacy_risk_score: float,
        privacy_flags: list[str],
    ) -> AtlasExtractorOutput:
        deterministic = self._extract_deterministic(
            event_type=event_type,
            sanitized_summary=sanitized_summary,
            privacy_risk_score=privacy_risk_score,
            privacy_flags=privacy_flags,
        )
        if not self.openai_client or not deterministic.should_store:
            return deterministic
        llm_output = self._extract_llm_normalized(deterministic, sanitized_summary=sanitized_summary)
        return llm_output or deterministic

    def _extract_deterministic(
        self,
        *,
        event_type: str,
        sanitized_summary: str,
        privacy_risk_score: float,
        privacy_flags: list[str],
    ) -> AtlasExtractorOutput:
        text = re.sub(r"\s+", " ", sanitized_summary or "").strip()
        if len(text) < 18:
            return AtlasExtractorOutput(
                should_store=False,
                scope="neither",
                privacy_risk_score=_clamp_score(privacy_risk_score),
                privacy_flags=privacy_flags,
            )

        knowledge_type = self._classify_knowledge_type(text)
        situation_tags = self._situation_tags(text, event_type=event_type)
        client_context_tags = self._client_context_tags(text)
        generalized_learning = self.generalizer.generalize(text, knowledge_type=knowledge_type)
        response_pattern = self._response_pattern(knowledge_type)
        trainer_specific_rule = self._trainer_specific_rule(text, event_type=event_type)
        scope = self._scope_for_event(event_type)
        contraindications = self._contraindications(knowledge_type, text)
        confidence = 0.72 if event_type in {"trainer_approval", "resolved_review_item"} else 0.66
        if privacy_risk_score >= 0.35 or "unredacted_pii" in privacy_flags:
            confidence = min(confidence, 0.3)

        return AtlasExtractorOutput(
            should_store=scope != "neither",
            scope=scope,
            knowledge_type=knowledge_type,  # type: ignore[arg-type]
            situation_tags=situation_tags,
            client_context_tags=client_context_tags,
            generalized_learning=generalized_learning,
            response_pattern=response_pattern,
            trainer_specific_rule=trainer_specific_rule,
            contraindications=contraindications,
            confidence_score=_clamp_score(confidence),
            privacy_risk_score=_clamp_score(privacy_risk_score),
            privacy_flags=privacy_flags,
        )

    def _extract_llm_normalized(
        self,
        deterministic: AtlasExtractorOutput,
        *,
        sanitized_summary: str,
    ) -> AtlasExtractorOutput | None:
        if not self.openai_client:
            return None
        payload = deterministic.model_dump(mode="json")
        payload["sanitized_summary"] = sanitized_summary[:2400]
        try:
            completion = self.openai_client.create_chat_completion_with_usage(
                model=GPT_5_4_MINI_MODEL,
                response_format="json",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Normalize sanitized coaching feedback into Atlas learning JSON only. "
                            "Return exactly the provided schema keys. Do not add raw names, places, dates, or source text."
                        ),
                    },
                    {"role": "user", "content": json.dumps(payload)},
                ],
            )
            parsed = self._parse_json_object(completion.text)
            if not parsed:
                return None
            parsed["privacy_risk_score"] = min(
                _clamp_score(parsed.get("privacy_risk_score"), default=deterministic.privacy_risk_score),
                deterministic.privacy_risk_score,
            )
            parsed["privacy_flags"] = _normalize_tags(parsed.get("privacy_flags"), limit=12) or deterministic.privacy_flags
            return AtlasExtractorOutput(**parsed)
        except Exception:  # pragma: no cover - defensive provider fallback.
            logger.exception("Atlas extractor LLM normalization failed")
            return None

    def _parse_json_object(self, value: str) -> dict[str, Any]:
        raw = str(value or "").strip()
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

    def _classify_knowledge_type(self, text: str) -> str:
        lowered = text.lower()
        if any(token in lowered for token in ("missed", "adherence", "skipped", "consistency", "workout attendance")):
            return "adherence_strategy"
        if any(token in lowered for token in ("motivat", "confidence", "identity", "encourage")):
            return "motivation_strategy"
        if any(token in lowered for token in ("pain", "injury", "knee", "shoulder", "modify", "substitute")):
            return "injury_modification_rule"
        if any(token in lowered for token in ("nutrition", "protein", "calorie", "meal", "macro", "hydration")):
            return "nutrition_coaching_pattern"
        if any(token in lowered for token in ("tone", "concise", "direct", "phrasing", "language")):
            return "tone_pattern"
        if any(token in lowered for token in ("medical", "doctor", "escalat", "urgent")):
            return "escalation_rule"
        if any(token in lowered for token in ("expectation", "deadline", "commitment")):
            return "expectation_setting"
        if any(token in lowered for token in ("habit", "behavior", "routine")):
            return "behavior_change_pattern"
        if any(token in lowered for token in ("accountability", "check-in", "follow up", "follow-up")):
            return "accountability_pattern"
        return "programming_rule"

    def _situation_tags(self, text: str, *, event_type: str) -> list[str]:
        lowered = text.lower()
        tags = [event_type]
        candidates = {
            "missed_workouts": ("missed", "skipped", "adherence"),
            "low_adherence": ("low adherence", "consistency", "attendance"),
            "injury_context": ("pain", "injury", "knee", "shoulder"),
            "nutrition": ("nutrition", "protein", "calorie", "meal"),
            "tone_correction": ("tone", "concise", "direct", "phrasing"),
            "programming": ("exercise", "sets", "reps", "volume", "program"),
        }
        for tag, needles in candidates.items():
            if any(needle in lowered for needle in needles):
                tags.append(tag)
        return _normalize_tags(tags)

    def _client_context_tags(self, text: str) -> list[str]:
        lowered = text.lower()
        tags: list[str] = []
        candidates = {
            "beginner": ("beginner", "new client", "new to training"),
            "busy_schedule": ("busy", "schedule", "travel", "work"),
            "knee_sensitive": ("knee",),
            "low_adherence": ("missed", "skipped", "low adherence"),
            "nutrition_goal": ("nutrition", "protein", "meal", "calorie"),
        }
        for tag, needles in candidates.items():
            if any(needle in lowered for needle in needles):
                tags.append(tag)
        return _normalize_tags(tags)

    def _response_pattern(self, knowledge_type: str) -> str:
        if knowledge_type == "adherence_strategy":
            return "Normalize the setback, reinforce identity, and ask for the smallest next action."
        if knowledge_type == "tone_pattern":
            return "Use the trainer's preferred phrasing and remove language that feels off-brand."
        if knowledge_type == "injury_modification_rule":
            return "Acknowledge the limitation, reduce risk, and offer a safe modification."
        return "State the pattern clearly and give one practical next step."

    def _trainer_specific_rule(self, text: str, *, event_type: str) -> str | None:
        if event_type == "trainer_rejection":
            return "This trainer rejected a response pattern similar to this sanitized example."
        if event_type == "trainer_approval":
            return "This trainer approved a response pattern similar to this sanitized example."
        if event_type == "resolved_review_item":
            return "This trainer resolved a review item with this coaching pattern."
        return f"This trainer prefers this coaching pattern: {text[:260]}"

    def _scope_for_event(self, event_type: str) -> str:
        if event_type == "trainer_deleted_extraction":
            return "atlas_level"
        if event_type == "trainer_rejection":
            return "trainer_specific"
        if event_type in {"trainer_correction", "trainer_approval", "resolved_review_item", "programming_rule_observed"}:
            return "both"
        return "neither"

    def _contraindications(self, knowledge_type: str, text: str) -> list[str]:
        contraindications: list[str] = ["Do not shame the client"]
        if knowledge_type in {"adherence_strategy", "accountability_pattern"}:
            contraindications.append("Do not prescribe more pressure as the first response")
        if knowledge_type == "injury_modification_rule" or "pain" in text.lower():
            contraindications.append("Do not tell the client to push through pain")
        return contraindications[:4]


class AtlasTenantLearningRouter:
    def route(self, candidate: AtlasExtractorOutput) -> str:
        if not candidate.should_store:
            return "neither"
        if candidate.privacy_risk_score >= 0.35 or "unredacted_pii" in candidate.privacy_flags:
            if candidate.scope == "both":
                return "both"
            if candidate.scope in {"trainer_specific", "atlas_level"}:
                return candidate.scope
            return "neither"
        return candidate.scope

    def atlas_event_status(self, candidate: AtlasExtractorOutput) -> tuple[str, str | None]:
        if candidate.privacy_risk_score >= 0.35:
            return "rejected", "privacy_risk_score_threshold"
        if "unredacted_pii" in candidate.privacy_flags:
            return "rejected", "unredacted_pii"
        if candidate.privacy_risk_score >= 0.15:
            return "needs_review", None
        return "accepted", None


class AtlasAuditLogger:
    def __init__(self, repository: AtlasRepository):
        self.repository = repository

    def log(
        self,
        *,
        event_type: str,
        actor_type: str,
        action: str,
        privacy_risk_score: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        try:
            self.repository.insert_audit_log(
                {
                    "event_type": event_type,
                    "actor_type": actor_type,
                    "action": action,
                    "privacy_risk_score": privacy_risk_score,
                    "metadata": metadata or {},
                }
            )
        except Exception:
            logger.exception("Atlas audit log write failed")


class AtlasReviewQueueService:
    def __init__(self, repository: AtlasRepository, audit_logger: AtlasAuditLogger | None = None):
        self.repository = repository
        self.audit_logger = audit_logger or AtlasAuditLogger(repository)

    def queue_candidate(
        self,
        *,
        candidate: AtlasExtractorOutput,
        event_type: str,
        raw_source_type: str,
        sanitized_summary: str,
    ) -> dict[str, Any] | None:
        status, rejection_reason = AtlasTenantLearningRouter().atlas_event_status(candidate)
        queue_row: dict[str, Any] | None = None
        if status != "rejected":
            queue_row = self.repository.insert_atlas_review_queue(
                {
                    "proposed_learning": candidate.generalized_learning,
                    "knowledge_type": candidate.knowledge_type,
                    "situation_tags": candidate.situation_tags,
                    "client_context_tags": candidate.client_context_tags,
                    "privacy_flags": candidate.privacy_flags,
                    "privacy_risk_score": candidate.privacy_risk_score,
                    "confidence_score": candidate.confidence_score,
                    "response_pattern": candidate.response_pattern,
                    "contraindications": candidate.contraindications,
                    "reviewer_status": "pending",
                }
            )
        self.repository.insert_atlas_learning_event(
            {
                "event_type": event_type,
                "raw_source_type": raw_source_type,
                "sanitized_summary": sanitized_summary[:1600],
                "proposed_learning_id": queue_row.get("id") if queue_row else None,
                "privacy_risk_score": candidate.privacy_risk_score,
                "status": status,
                "rejection_reason": rejection_reason,
            }
        )
        self.audit_logger.log(
            event_type=event_type,
            actor_type="system",
            action="atlas_learning_queued" if queue_row else "atlas_learning_rejected",
            privacy_risk_score=candidate.privacy_risk_score,
            metadata={
                "raw_source_type": raw_source_type,
                "queue_id": queue_row.get("id") if queue_row else None,
                "rejection_reason": rejection_reason,
            },
        )
        return queue_row

    def list_queue(self, *, reviewer_status: str | None = "pending", limit: int = 100) -> list[AtlasReviewQueueItem]:
        return [AtlasReviewQueueItem(**row) for row in self.repository.list_atlas_review_queue(
            reviewer_status=reviewer_status,
            limit=limit,
        )]

    def update_queue_item(self, queue_id: str, payload: dict[str, Any]) -> AtlasReviewQueueItem:
        current = self.repository.get_atlas_review_queue_item(queue_id)
        if not current:
            raise ValueError("Atlas review item not found")
        update_payload = {key: value for key, value in payload.items() if value is not None}
        if "knowledge_type" in update_payload:
            update_payload["knowledge_type"] = self._normalize_knowledge_type(update_payload["knowledge_type"])
        if "situation_tags" in update_payload:
            update_payload["situation_tags"] = _normalize_tags(update_payload["situation_tags"], limit=12)
        if "client_context_tags" in update_payload:
            update_payload["client_context_tags"] = _normalize_tags(update_payload["client_context_tags"], limit=12)
        if "privacy_flags" in update_payload:
            update_payload["privacy_flags"] = _normalize_tags(update_payload["privacy_flags"], limit=12)
        if "confidence_score" in update_payload:
            update_payload["confidence_score"] = _clamp_score(update_payload["confidence_score"])
        if "privacy_risk_score" in update_payload:
            update_payload["privacy_risk_score"] = _clamp_score(update_payload["privacy_risk_score"], default=1.0)
        update_payload["reviewer_status"] = "edited"
        updated = self.repository.update_atlas_review_queue(queue_id, update_payload)
        self.audit_logger.log(
            event_type="atlas_review_queue",
            actor_type="admin",
            action="edited",
            privacy_risk_score=updated.get("privacy_risk_score"),
            metadata={"queue_id": queue_id},
        )
        return AtlasReviewQueueItem(**updated)

    def approve_queue_item(self, queue_id: str, *, reviewer_notes: str | None = None) -> AtlasKnowledgeItem:
        row = self.repository.get_atlas_review_queue_item(queue_id)
        if not row:
            raise ValueError("Atlas review item not found")
        privacy_risk_score = _clamp_score(row.get("privacy_risk_score"), default=1.0)
        privacy_flags = _normalize_tags(row.get("privacy_flags"), limit=12)
        if privacy_risk_score >= 0.35 or "unredacted_pii" in privacy_flags:
            raise ValueError("Atlas learning is too privacy risky to approve")
        knowledge_type = self._normalize_knowledge_type(row.get("knowledge_type"))
        now_iso = _now_iso()
        knowledge = self.repository.insert_atlas_knowledge(
            {
                "knowledge_type": knowledge_type,
                "situation_tags": _normalize_tags(row.get("situation_tags"), limit=12),
                "client_context_tags": _normalize_tags(row.get("client_context_tags"), limit=12),
                "generalized_learning": _as_text(row.get("proposed_learning")),
                "response_pattern": row.get("response_pattern"),
                "contraindications": row.get("contraindications") if isinstance(row.get("contraindications"), list) else [],
                "confidence_score": _clamp_score(row.get("confidence_score")),
                "privacy_risk_score": privacy_risk_score,
                "evidence_count": 1,
                "status": "approved",
                "created_at": now_iso,
                "updated_at": now_iso,
            }
        )
        self.repository.update_atlas_review_queue(
            queue_id,
            {
                "reviewer_status": "approved",
                "reviewer_notes": reviewer_notes,
                "reviewed_at": now_iso,
            },
        )
        self.audit_logger.log(
            event_type="atlas_review_queue",
            actor_type="admin",
            action="approved",
            privacy_risk_score=privacy_risk_score,
            metadata={"queue_id": queue_id, "knowledge_id": knowledge.get("id")},
        )
        return AtlasKnowledgeItem(**knowledge)

    def reject_queue_item(self, queue_id: str, *, reviewer_notes: str | None = None) -> AtlasReviewQueueItem:
        row = self.repository.update_atlas_review_queue(
            queue_id,
            {
                "reviewer_status": "rejected",
                "reviewer_notes": reviewer_notes,
                "reviewed_at": _now_iso(),
            },
        )
        if not row:
            raise ValueError("Atlas review item not found")
        self.audit_logger.log(
            event_type="atlas_review_queue",
            actor_type="admin",
            action="rejected",
            privacy_risk_score=row.get("privacy_risk_score"),
            metadata={"queue_id": queue_id},
        )
        return AtlasReviewQueueItem(**row)

    def list_knowledge(self, *, status: str | None = "approved", limit: int = 100) -> list[AtlasKnowledgeItem]:
        return [AtlasKnowledgeItem(**row) for row in self.repository.list_atlas_knowledge(status=status, limit=limit)]

    def _normalize_knowledge_type(self, value: Any) -> str:
        normalized = str(value or "").strip().lower()
        if normalized in ALLOWED_KNOWLEDGE_TYPES:
            return normalized
        return "adherence_strategy"


class AtlasKnowledgeRepository:
    def __init__(self, repository: AtlasRepository):
        self.repository = repository

    def list_approved(self, *, limit: int = 100) -> list[AtlasKnowledgeItem]:
        return [AtlasKnowledgeItem(**row) for row in self.repository.list_atlas_knowledge(status="approved", limit=limit)]


class AtlasTrainerAiManager:
    def __init__(self, repository: AtlasRepository, audit_logger: AtlasAuditLogger | None = None):
        self.repository = repository
        self.audit_logger = audit_logger or AtlasAuditLogger(repository)

    def propose_rule(
        self,
        *,
        trainer_id: str,
        event_type: str,
        sanitized_summary: str,
        candidate: AtlasExtractorOutput,
    ) -> dict[str, Any] | None:
        if not trainer_id or not settings.trainer_ai_learning_enabled or not settings.atlas_trainer_ai_manager_enabled:
            return None
        proposed_rule = _as_text(candidate.trainer_specific_rule) or _as_text(candidate.generalized_learning)
        if not proposed_rule:
            return None
        self.repository.insert_trainer_ai_learning_event(
            {
                "trainer_id": trainer_id,
                "event_type": event_type,
                "sanitized_summary": sanitized_summary[:1600],
                "proposed_rule": proposed_rule,
                "confidence_score": candidate.confidence_score,
                "status": "needs_review" if settings.trainer_ai_review_required else "accepted",
            }
        )
        if settings.trainer_ai_review_required:
            row = self.repository.insert_trainer_ai_review_queue(
                {
                    "trainer_id": trainer_id,
                    "proposed_rule": proposed_rule,
                    "reason_detected": self._reason_detected(event_type),
                    "confidence_score": candidate.confidence_score,
                    "knowledge_type": candidate.knowledge_type,
                    "example_pattern_sanitized": sanitized_summary[:500],
                    "reviewer_status": "pending",
                }
            )
            self.audit_logger.log(
                event_type=event_type,
                actor_type="system",
                action="trainer_ai_rule_proposed",
                privacy_risk_score=candidate.privacy_risk_score,
                metadata={"trainer_id": trainer_id, "queue_id": row.get("id")},
            )
            return row
        created = self.repository.insert_trainer_ai_knowledge(
            {
                "trainer_id": trainer_id,
                "knowledge_type": candidate.knowledge_type,
                "learned_rule": proposed_rule,
                "example_pattern_sanitized": sanitized_summary[:500],
                "confidence_score": candidate.confidence_score,
                "status": "approved",
            }
        )
        self.audit_logger.log(
            event_type=event_type,
            actor_type="system",
            action="trainer_ai_rule_auto_approved",
            privacy_risk_score=candidate.privacy_risk_score,
            metadata={"trainer_id": trainer_id, "knowledge_id": created.get("id")},
        )
        return created

    def _reason_detected(self, event_type: str) -> str:
        if event_type == "trainer_correction":
            return "Atlas observed a trainer correction to an AI output."
        if event_type == "trainer_approval":
            return "Atlas observed a trainer-approved AI output."
        if event_type == "trainer_rejection":
            return "Atlas observed a trainer rejection of an AI output."
        if event_type == "resolved_review_item":
            return "Atlas observed a resolved trainer review item."
        return "Atlas observed a trainer-specific coaching pattern."


class TrainerAiReviewQueueService:
    def __init__(self, repository: AtlasRepository, audit_logger: AtlasAuditLogger | None = None):
        self.repository = repository
        self.audit_logger = audit_logger or AtlasAuditLogger(repository)

    def list_queue(
        self,
        trainer_id: str,
        *,
        reviewer_status: str | None = "pending",
        limit: int = 100,
    ) -> list[TrainerAiReviewQueueItem]:
        return [
            TrainerAiReviewQueueItem(**row)
            for row in self.repository.list_trainer_ai_review_queue(
                trainer_id,
                reviewer_status=reviewer_status,
                limit=limit,
            )
        ]

    def approve(self, trainer_id: str, queue_id: str) -> TrainerAiKnowledgeItem:
        row = self.repository.get_trainer_ai_review_queue_item(trainer_id, queue_id)
        if not row:
            raise ValueError("Trainer AI review item not found")
        now_iso = _now_iso()
        knowledge = self.repository.insert_trainer_ai_knowledge(
            {
                "trainer_id": trainer_id,
                "knowledge_type": row.get("knowledge_type") or "trainer_preference",
                "learned_rule": row.get("proposed_rule"),
                "example_pattern_sanitized": row.get("example_pattern_sanitized"),
                "confidence_score": _clamp_score(row.get("confidence_score")),
                "status": "approved",
                "created_at": now_iso,
                "updated_at": now_iso,
            }
        )
        self.repository.update_trainer_ai_review_queue(
            trainer_id,
            queue_id,
            {
                "reviewer_status": "approved",
                "reviewed_at": now_iso,
            },
        )
        self.audit_logger.log(
            event_type="trainer_ai_review_queue",
            actor_type="trainer",
            action="approved",
            metadata={"trainer_id": trainer_id, "queue_id": queue_id, "knowledge_id": knowledge.get("id")},
        )
        return TrainerAiKnowledgeItem(**knowledge)

    def update(self, trainer_id: str, queue_id: str, payload: dict[str, Any]) -> TrainerAiReviewQueueItem:
        row = self.repository.get_trainer_ai_review_queue_item(trainer_id, queue_id)
        if not row:
            raise ValueError("Trainer AI review item not found")
        updates = {key: value for key, value in payload.items() if value is not None}
        if "proposed_rule" in updates:
            updates["proposed_rule"] = _as_text(updates["proposed_rule"])
            if not updates["proposed_rule"]:
                raise ValueError("Proposed rule cannot be empty")
        updates["reviewer_status"] = "edited"
        updated = self.repository.update_trainer_ai_review_queue(trainer_id, queue_id, updates)
        self.audit_logger.log(
            event_type="trainer_ai_review_queue",
            actor_type="trainer",
            action="edited",
            metadata={"trainer_id": trainer_id, "queue_id": queue_id},
        )
        return TrainerAiReviewQueueItem(**updated)

    def reject(self, trainer_id: str, queue_id: str, *, reviewer_notes: str | None = None) -> TrainerAiReviewQueueItem:
        updated = self.repository.update_trainer_ai_review_queue(
            trainer_id,
            queue_id,
            {
                "reviewer_status": "rejected",
                "reviewer_notes": reviewer_notes,
                "reviewed_at": _now_iso(),
            },
        )
        if not updated:
            raise ValueError("Trainer AI review item not found")
        self.audit_logger.log(
            event_type="trainer_ai_review_queue",
            actor_type="trainer",
            action="rejected",
            metadata={"trainer_id": trainer_id, "queue_id": queue_id},
        )
        return TrainerAiReviewQueueItem(**updated)

    def delete_queue_item(self, trainer_id: str, queue_id: str) -> dict[str, Any]:
        deleted = self.repository.delete_trainer_ai_review_queue(trainer_id, queue_id)
        if not deleted:
            raise ValueError("Trainer AI review item not found")
        self.audit_logger.log(
            event_type="trainer_ai_review_queue",
            actor_type="trainer",
            action="deleted",
            metadata={"trainer_id": trainer_id, "queue_id": queue_id},
        )
        return {"deleted": True, "id": queue_id}

    def list_knowledge(self, trainer_id: str, *, status: str | None = "approved", limit: int = 100) -> list[TrainerAiKnowledgeItem]:
        return [
            TrainerAiKnowledgeItem(**row)
            for row in self.repository.list_trainer_ai_knowledge(trainer_id, status=status, limit=limit)
        ]

    def retire_knowledge(self, trainer_id: str, knowledge_id: str) -> TrainerAiKnowledgeItem:
        row = self.repository.update_trainer_ai_knowledge(
            trainer_id,
            knowledge_id,
            {
                "status": "retired",
                "updated_at": _now_iso(),
            },
        )
        if not row:
            raise ValueError("Trainer AI knowledge not found")
        self.audit_logger.log(
            event_type="trainer_ai_knowledge",
            actor_type="trainer",
            action="retired",
            metadata={"trainer_id": trainer_id, "knowledge_id": knowledge_id},
        )
        return TrainerAiKnowledgeItem(**row)


class TrainerAiKnowledgeRepository:
    def __init__(self, repository: AtlasRepository):
        self.repository = repository

    def list_approved(self, trainer_id: str, *, limit: int = 100) -> list[TrainerAiKnowledgeItem]:
        return [
            TrainerAiKnowledgeItem(**row)
            for row in self.repository.list_trainer_ai_knowledge(trainer_id, status="approved", limit=limit)
        ]


class AtlasObserverService:
    def __init__(
        self,
        repository: AtlasRepository,
        *,
        sanitizer: AtlasPiiSanitizer | None = None,
        extractor: AtlasLearningExtractor | None = None,
        router: AtlasTenantLearningRouter | None = None,
        trainer_ai_manager: AtlasTrainerAiManager | None = None,
        review_queue_service: AtlasReviewQueueService | None = None,
    ):
        self.repository = repository
        self.sanitizer = sanitizer or AtlasPiiSanitizer()
        self.extractor = extractor or AtlasLearningExtractor()
        self.router = router or AtlasTenantLearningRouter()
        self.trainer_ai_manager = trainer_ai_manager or AtlasTrainerAiManager(repository)
        self.review_queue_service = review_queue_service or AtlasReviewQueueService(repository)

    def observe_ai_feedback_event(self, *, output: Any, feedback_event: Any, raw_source_type: str | None = None) -> None:
        if not self._enabled():
            return
        event_type = self._map_feedback_event_type(_field(feedback_event, "event_type"))
        if not event_type:
            return
        trainer_id = _as_text(_field(output, "trainer_id"))
        client_id = _as_text(_field(output, "client_id")) or None
        source_type = raw_source_type or _as_text(_field(output, "source_type")) or "ai_feedback"
        raw_text = self._feedback_event_text(output=output, feedback_event=feedback_event)
        self._observe_text_event(
            event_type=event_type,
            raw_source_type=source_type,
            trainer_id=trainer_id,
            client_id=client_id,
            raw_text=raw_text,
        )

    def observe_resolved_review_item(
        self,
        *,
        trainer_id: str,
        approved_answer: str,
        queue_id: str | None = None,
        response_tags: list[str] | None = None,
    ) -> None:
        if not self._enabled():
            return
        raw_text = " ".join(
            part for part in [
                "Resolved review item.",
                approved_answer,
                " ".join(response_tags or []),
            ] if part
        )
        self._observe_text_event(
            event_type="resolved_review_item",
            raw_source_type="trainer_review_queue",
            trainer_id=trainer_id,
            client_id=None,
            raw_text=raw_text,
            metadata={"queue_id": queue_id},
        )

    def _observe_text_event(
        self,
        *,
        event_type: str,
        raw_source_type: str,
        trainer_id: str | None,
        client_id: str | None,
        raw_text: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        try:
            trainer_identity = self.repository.get_trainer_identity(trainer_id)
            client_identity = self.repository.get_client_identity(client_id)
            known_names = [
                _as_text((trainer_identity or {}).get("display_name")),
                _as_text((client_identity or {}).get("client_name")),
            ]
            known_identity_values = [
                _as_text((trainer_identity or {}).get("id")),
                _as_text((client_identity or {}).get("id")),
                _as_text((trainer_identity or {}).get("user_id")),
                _as_text((client_identity or {}).get("user_id")),
            ]
            sanitized = self.sanitizer.sanitize(
                raw_text,
                known_names=[name for name in known_names if name],
                known_identity_values=[value for value in known_identity_values if value],
            )
            candidate = self.extractor.extract(
                event_type=event_type,
                sanitized_summary=sanitized.sanitized_text,
                privacy_risk_score=sanitized.privacy_risk_score,
                privacy_flags=sanitized.privacy_flags,
            )
            route = self.router.route(candidate)
            if route in {"trainer_specific", "both"} and trainer_id:
                self.trainer_ai_manager.propose_rule(
                    trainer_id=trainer_id,
                    event_type=event_type,
                    sanitized_summary=sanitized.sanitized_text,
                    candidate=candidate,
                )
            if route in {"atlas_level", "both"}:
                self.review_queue_service.queue_candidate(
                    candidate=candidate,
                    event_type=event_type,
                    raw_source_type=raw_source_type,
                    sanitized_summary=sanitized.sanitized_text,
                )
        except Exception:
            logger.exception("Atlas observation failed event_type=%s metadata=%s", event_type, metadata or {})

    def _feedback_event_text(self, *, output: Any, feedback_event: Any) -> str:
        metadata = _field(feedback_event, "metadata", {}) or {}
        chunks = [
            f"Original output: {_as_text(_field(feedback_event, 'original_output_text') or _field(output, 'output_text'))}",
            f"Reviewed output: {_as_text(_field(feedback_event, 'edited_output_text') or _field(output, 'reviewed_output_text'))}",
            f"Feedback metadata: {json.dumps(metadata, sort_keys=True)[:500] if isinstance(metadata, dict) else ''}",
        ]
        return " ".join(chunk for chunk in chunks if chunk.strip())

    def _map_feedback_event_type(self, event_type: Any) -> str | None:
        normalized = _as_text(event_type).lower()
        if normalized == "edited":
            return "trainer_correction"
        if normalized == "approved":
            return "trainer_approval"
        if normalized == "rejected":
            return "trainer_rejection"
        return None

    def _enabled(self) -> bool:
        return bool(settings.atlas_enabled and settings.atlas_background_learning_enabled)


class AtlasTrainerDeletionObserver:
    def __init__(
        self,
        repository: AtlasRepository,
        *,
        sanitizer: AtlasPiiSanitizer | None = None,
        extractor: AtlasLearningExtractor | None = None,
        review_queue_service: AtlasReviewQueueService | None = None,
    ):
        self.repository = repository
        self.sanitizer = sanitizer or AtlasPiiSanitizer()
        self.extractor = extractor or AtlasLearningExtractor()
        self.review_queue_service = review_queue_service or AtlasReviewQueueService(repository)

    def observe_before_trainer_deletion(
        self,
        *,
        trainer_ids: list[str],
        deletion_request_id: str | None = None,
    ) -> dict[str, int]:
        if not settings.atlas_enabled or not settings.atlas_trainer_deletion_learning_enabled:
            return {"atlas_deletion_extractions": 0}
        rows = self.repository.list_trainer_ai_knowledge_for_trainers(trainer_ids)
        extracted = 0
        for row in rows:
            raw_text = " ".join(
                part for part in [
                    _as_text(row.get("learned_rule")),
                    _as_text(row.get("example_pattern_sanitized")),
                ] if part
            )
            sanitized = self.sanitizer.sanitize(raw_text)
            candidate = self.extractor.extract(
                event_type="trainer_deleted_extraction",
                sanitized_summary=sanitized.sanitized_text,
                privacy_risk_score=sanitized.privacy_risk_score,
                privacy_flags=sanitized.privacy_flags,
            )
            if candidate.should_store and candidate.privacy_risk_score < 0.35:
                self.review_queue_service.queue_candidate(
                    candidate=candidate,
                    event_type="trainer_deleted_extraction",
                    raw_source_type="trainer_ai_knowledge",
                    sanitized_summary=sanitized.sanitized_text,
                )
                extracted += 1
        return {"atlas_deletion_extractions": extracted}
