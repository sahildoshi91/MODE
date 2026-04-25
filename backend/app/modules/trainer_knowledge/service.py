from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from app.core.tenancy import TrainerContext
from app.modules.trainer_knowledge.extractor import TrainerRuleExtractor
from app.modules.trainer_knowledge.repository import TrainerKnowledgeRepository
from app.modules.trainer_knowledge.schemas import (
    TrainerKnowledgeDocument,
    TrainerKnowledgeDocumentCreate,
    TrainerKnowledgeDocumentUpdateRequest,
    TrainerKnowledgeEntry,
    TrainerKnowledgeEntryCreateRequest,
    TrainerKnowledgeEntryMutationResponse,
    TrainerKnowledgeEntryUpdateRequest,
    TrainerKnowledgeClassificationRequest,
    TrainerKnowledgeClassificationSuggestion,
    TrainerKnowledgeConflictCandidate,
    TrainerKnowledgeExtractionSummary,
    TrainerKnowledgeIngestRequest,
    TrainerKnowledgeRefineRequest,
    TrainerKnowledgeSafetyCheckResult,
    TrainerKnowledgeSaveResponse,
    TrainerKnowledgeVersion,
    TrainerRule,
    TrainerRuleUpdateRequest,
)

logger = logging.getLogger(__name__)
TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
TAG_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "for",
    "from",
    "if",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "with",
}
KNOWLEDGE_TYPE_VALUES = {
    "coaching_rule",
    "programming_preference",
    "nutrition_principle",
    "client_pattern",
    "communication_style",
    "business_policy",
    "other",
}
KNOWLEDGE_SCOPE_VALUES = {"global", "client_specific"}
KNOWLEDGE_STATUS_VALUES = {"active", "archived"}
KNOWLEDGE_SOURCE_VALUES = {"manual_note", "chat_capture", "ai_suggestion", "imported_doc"}
SAFETY_HIGH_RISK_PATTERNS = (
    "ignore pain",
    "push through pain",
    "skip medical",
    "starve",
    "extreme calorie",
    "very low calorie",
    "disordered eating",
    "self-medicate",
    "stop medication",
)
SAFETY_REVIEW_PATTERNS = (
    "supplement",
    "medication",
    "diagnose",
    "injury",
    "rapid weight loss",
)
NEGATION_TOKENS = {"avoid", "never", "no", "skip", "reduce", "limit", "without"}
AFFIRMATION_TOKENS = {"use", "include", "prioritize", "always", "keep", "increase", "primary"}


class TrainerKnowledgeService:
    def __init__(
        self,
        repository: TrainerKnowledgeRepository,
        extractor: TrainerRuleExtractor | None = None,
    ):
        self.repository = repository
        self.extractor = extractor or TrainerRuleExtractor()

    def list_entries(
        self,
        trainer_context: TrainerContext,
        *,
        include_archived: bool = False,
        scope: str | None = None,
        ai_enabled: bool | None = None,
        client_id: str | None = None,
        query: str | None = None,
        limit: int = 120,
        offset: int = 0,
    ) -> list[TrainerKnowledgeEntry]:
        trainer_id = trainer_context.trainer_id
        if not trainer_id:
            return []
        rows = self.repository.list_entries_by_trainer(
            trainer_id,
            include_archived=include_archived,
            scope=self._normalize_scope(scope) if scope else None,
            ai_enabled=ai_enabled,
            limit=limit,
            offset=offset,
        )
        normalized_query = str(query or "").strip().lower()
        client_filter = str(client_id or "").strip() or None
        entries: list[TrainerKnowledgeEntry] = []
        for row in rows:
            if client_filter:
                row_scope = self._normalize_scope(row.get("scope"))
                row_client_id = str(row.get("client_id") or "").strip() or None
                if row_scope == "client_specific" and row_client_id != client_filter:
                    continue
            if normalized_query and not self._matches_entry_query(row, normalized_query):
                continue
            try:
                entries.append(TrainerKnowledgeEntry(**row))
            except Exception:
                logger.exception(
                    "Failed to parse trainer knowledge entry id=%s trainer_id=%s",
                    row.get("id"),
                    trainer_id,
                )
        return entries

    def classify_entry(
        self,
        trainer_context: TrainerContext,
        request: TrainerKnowledgeClassificationRequest,
    ) -> TrainerKnowledgeClassificationSuggestion:
        if not trainer_context.trainer_id:
            raise ValueError("No trainer context found")
        raw_content = str(request.raw_content or "").strip()
        if not raw_content:
            raise ValueError("Raw content is required")
        return self._suggest_structure(
            raw_content=raw_content,
            title=request.title,
            client_id=request.client_id,
            preferred_scope=request.preferred_scope,
            preferred_knowledge_type=request.preferred_knowledge_type,
        )

    def create_entry(
        self,
        trainer_context: TrainerContext,
        request: TrainerKnowledgeEntryCreateRequest,
    ) -> TrainerKnowledgeEntryMutationResponse:
        trainer_id = trainer_context.trainer_id
        tenant_id = trainer_context.tenant_id
        if not trainer_id or not tenant_id:
            raise ValueError("No trainer context found")

        raw_content = str(request.raw_content or "").strip()
        if not raw_content:
            raise ValueError("Raw content is required")

        suggestion = self._suggest_structure(
            raw_content=raw_content,
            title=request.title,
            client_id=request.client_id,
            preferred_scope=request.scope,
            preferred_knowledge_type=request.knowledge_type,
        )
        resolved_scope = self._normalize_scope(request.scope or suggestion.scope)
        resolved_client_id = str(request.client_id or suggestion.client_id or "").strip() or None
        if resolved_scope == "client_specific" and not resolved_client_id:
            raise ValueError("Client-specific scope requires client_id")
        if resolved_scope == "global":
            resolved_client_id = None

        resolved_title = str(request.title or "").strip() or suggestion.title or self._build_default_title(raw_content)
        resolved_summary = self._coerce_optional_text(request.structured_summary) or suggestion.structured_summary
        resolved_type = self._normalize_knowledge_type(request.knowledge_type or suggestion.knowledge_type)
        resolved_tags = self._normalize_tags(request.tags or suggestion.tags)
        resolved_source = self._normalize_source(request.source or "manual_note")
        resolved_confidence = self._normalize_confidence(
            request.confidence_score if request.confidence_score is not None else suggestion.confidence
        )
        resolved_ai_enabled = bool(request.ai_enabled)
        safety = self._review_safety(raw_content)
        warnings: list[str] = []
        if safety.ai_enabled_forced_off:
            resolved_ai_enabled = False
            if safety.message:
                warnings.append(safety.message)

        now_iso = datetime.now(timezone.utc).isoformat()
        created_row = self.repository.create_entry(
            {
                "tenant_id": tenant_id,
                "trainer_id": trainer_id,
                "client_id": resolved_client_id,
                "title": resolved_title,
                "raw_content": raw_content,
                "structured_summary": resolved_summary,
                "knowledge_type": resolved_type,
                "scope": resolved_scope,
                "tags": resolved_tags,
                "ai_enabled": resolved_ai_enabled,
                "status": "active",
                "source": resolved_source,
                "confidence_score": resolved_confidence,
                "version_count": 1,
                "metadata": request.metadata or {},
                "created_at": now_iso,
                "updated_at": now_iso,
                "archived_at": None,
            }
        )
        if not created_row:
            raise ValueError("Entry create failed")
        entry = TrainerKnowledgeEntry(**created_row)
        self._create_entry_version(
            entry=entry,
            version_number=1,
            edited_by=trainer_context.trainer_user_id,
            change_reason=request.change_reason or "Created knowledge entry",
        )
        conflicts = self._detect_conflicts(
            trainer_context=trainer_context,
            target_entry=entry,
            ignore_entry_id=entry.id,
        )
        return TrainerKnowledgeEntryMutationResponse(
            entry=entry,
            safety=safety,
            conflicts=conflicts,
            warnings=warnings,
        )

    def update_entry(
        self,
        trainer_context: TrainerContext,
        entry_id: str,
        request: TrainerKnowledgeEntryUpdateRequest,
    ) -> TrainerKnowledgeEntryMutationResponse:
        trainer_id = trainer_context.trainer_id
        if not trainer_id:
            raise ValueError("No trainer context found")

        existing = self.repository.get_entry(trainer_id, entry_id)
        if not existing:
            raise ValueError("Entry not found")

        current = TrainerKnowledgeEntry(**existing)
        updates: dict[str, Any] = {}

        if request.title is not None:
            title = str(request.title).strip()
            if not title:
                raise ValueError("Title cannot be empty")
            updates["title"] = title
        if request.raw_content is not None:
            raw_content = str(request.raw_content).strip()
            if not raw_content:
                raise ValueError("Raw content cannot be empty")
            updates["raw_content"] = raw_content
        if request.structured_summary is not None:
            updates["structured_summary"] = self._coerce_optional_text(request.structured_summary)
        if request.knowledge_type is not None:
            updates["knowledge_type"] = self._normalize_knowledge_type(request.knowledge_type)
        if request.scope is not None:
            updates["scope"] = self._normalize_scope(request.scope)
        if request.tags is not None:
            updates["tags"] = self._normalize_tags(request.tags)
        if request.ai_enabled is not None:
            updates["ai_enabled"] = bool(request.ai_enabled)
        if request.status is not None:
            updates["status"] = self._normalize_status(request.status)
        if request.confidence_score is not None:
            updates["confidence_score"] = self._normalize_confidence(request.confidence_score)
        if request.client_id is not None:
            updates["client_id"] = str(request.client_id).strip() or None
        if request.metadata is not None:
            updates["metadata"] = request.metadata

        resolved_scope = updates.get("scope", current.scope)
        resolved_client_id = updates.get("client_id", current.client_id)
        if resolved_scope == "client_specific" and not resolved_client_id:
            raise ValueError("Client-specific scope requires client_id")
        if resolved_scope == "global":
            updates["client_id"] = None

        resolved_raw_content = str(updates.get("raw_content", current.raw_content) or "").strip()
        if not resolved_raw_content:
            raise ValueError("Raw content cannot be empty")
        safety = self._review_safety(resolved_raw_content)
        warnings: list[str] = []
        if safety.ai_enabled_forced_off and updates.get("ai_enabled", current.ai_enabled):
            updates["ai_enabled"] = False
            if safety.message:
                warnings.append(safety.message)

        if not updates:
            return TrainerKnowledgeEntryMutationResponse(
                entry=current,
                safety=safety,
                conflicts=[],
                warnings=warnings,
            )

        now_iso = datetime.now(timezone.utc).isoformat()
        next_version = int(current.version_count or 1) + 1
        updates["version_count"] = next_version
        updates["updated_at"] = now_iso
        status = updates.get("status", current.status)
        if status == "archived":
            updates["archived_at"] = now_iso
        elif status == "active":
            updates["archived_at"] = None

        updated_row = self.repository.update_entry(trainer_id, entry_id, updates)
        if not updated_row:
            raise ValueError("Entry update failed")
        entry = TrainerKnowledgeEntry(**updated_row)
        self._create_entry_version(
            entry=entry,
            version_number=next_version,
            edited_by=trainer_context.trainer_user_id,
            change_reason=request.change_reason or "Updated knowledge entry",
        )
        conflicts = self._detect_conflicts(
            trainer_context=trainer_context,
            target_entry=entry,
            ignore_entry_id=entry.id,
        ) if entry.status == "active" else []
        return TrainerKnowledgeEntryMutationResponse(
            entry=entry,
            safety=safety,
            conflicts=conflicts,
            warnings=warnings,
        )

    def archive_entry(
        self,
        trainer_context: TrainerContext,
        entry_id: str,
        *,
        change_reason: str | None = None,
    ) -> TrainerKnowledgeEntryMutationResponse:
        request = TrainerKnowledgeEntryUpdateRequest(
            status="archived",
            change_reason=change_reason or "Archived knowledge entry",
        )
        return self.update_entry(trainer_context, entry_id, request)

    def refine_entry(
        self,
        trainer_context: TrainerContext,
        entry_id: str,
        request: TrainerKnowledgeRefineRequest,
    ) -> TrainerKnowledgeEntryMutationResponse:
        action = str(request.action or "").strip().lower()
        if action == "archive":
            return self.archive_entry(
                trainer_context,
                entry_id,
                change_reason=request.change_reason or "Refinement action: archive",
            )

        existing = self.repository.get_entry(trainer_context.trainer_id or "", entry_id)
        if not existing:
            raise ValueError("Entry not found")
        current = TrainerKnowledgeEntry(**existing)
        additional = str(request.content or "").strip()
        if not additional:
            raise ValueError("Refinement content is required")

        prefix_map = {
            "add_example": "Example",
            "add_exception": "Exception",
            "clarify_rule": "Clarification",
        }
        if action not in prefix_map:
            raise ValueError("Unsupported refinement action")

        merged_content = (
            f"{current.raw_content.rstrip()}\n\n{prefix_map[action]}: {additional}"
            if current.raw_content.strip()
            else additional
        )
        return self.update_entry(
            trainer_context,
            entry_id,
            TrainerKnowledgeEntryUpdateRequest(
                raw_content=merged_content,
                change_reason=request.change_reason or f"Refinement action: {action}",
            ),
        )

    def list_entry_versions(
        self,
        trainer_context: TrainerContext,
        entry_id: str,
        *,
        limit: int = 50,
    ) -> list[TrainerKnowledgeVersion]:
        trainer_id = trainer_context.trainer_id
        if not trainer_id:
            return []
        rows = self.repository.list_entry_versions(trainer_id, entry_id, limit=limit)
        return [TrainerKnowledgeVersion(**row) for row in rows]

    def list_documents(self, trainer_id: str) -> list[TrainerKnowledgeDocument]:
        return [TrainerKnowledgeDocument(**row) for row in self.repository.list_by_trainer(trainer_id)]

    def create_document(self, trainer_id: str, document: TrainerKnowledgeDocumentCreate) -> TrainerKnowledgeDocument:
        payload = document.model_dump()
        payload["trainer_id"] = trainer_id
        created = self.repository.create(payload)
        return TrainerKnowledgeDocument(**created)

    def ingest_document(
        self,
        trainer_context: TrainerContext,
        request: TrainerKnowledgeIngestRequest,
    ) -> TrainerKnowledgeSaveResponse:
        if not trainer_context.trainer_id:
            raise ValueError("No trainer context found")

        document_payload = request.model_dump()
        document_payload["trainer_id"] = trainer_context.trainer_id
        if not document_payload.get("document_type"):
            document_payload["document_type"] = "text"

        created_document = self.repository.create(document_payload)
        document = TrainerKnowledgeDocument(**created_document)
        extracted_rules, extraction_summary = self._extract_and_persist_rules(
            trainer_context=trainer_context,
            document=document,
            raw_text=(request.raw_text or ""),
            title=request.title,
            replace_document_rules=False,
            archive_change_summary="Replaced due to document ingest",
            create_change_summary="Created from Agent Lab ingest",
        )
        return TrainerKnowledgeSaveResponse(
            document=document,
            extracted_rules=extracted_rules,
            extraction=extraction_summary,
        )

    def update_document(
        self,
        trainer_context: TrainerContext,
        document_id: str,
        request: TrainerKnowledgeDocumentUpdateRequest,
    ) -> TrainerKnowledgeSaveResponse:
        trainer_id = trainer_context.trainer_id
        if not trainer_id:
            raise ValueError("No trainer context found")

        existing = self.repository.get_document(trainer_id, document_id)
        if not existing:
            raise ValueError("Document not found")

        updates: dict[str, Any] = {}
        if request.title is not None:
            title = request.title.strip()
            if not title:
                raise ValueError("Title cannot be empty")
            updates["title"] = title
        if request.raw_text is not None:
            raw_text = request.raw_text.strip()
            if not raw_text:
                raise ValueError("Raw text cannot be empty")
            updates["raw_text"] = raw_text
        if request.document_type is not None:
            document_type = request.document_type.strip()
            updates["document_type"] = document_type or "text"
        if request.file_url is not None:
            updates["file_url"] = request.file_url
        if request.metadata is not None:
            updates["metadata"] = request.metadata

        updated_row = existing
        if updates:
            updated = self.repository.update_document(trainer_id, document_id, updates)
            if not updated:
                raise ValueError("Document update failed")
            updated_row = updated

        document = TrainerKnowledgeDocument(**updated_row)
        extracted_rules, extraction_summary = self._extract_and_persist_rules(
            trainer_context=trainer_context,
            document=document,
            raw_text=(document.raw_text or ""),
            title=document.title,
            replace_document_rules=True,
            archive_change_summary="Archived due to knowledge document resave",
            create_change_summary="Created from knowledge document resave",
        )
        return TrainerKnowledgeSaveResponse(
            document=document,
            extracted_rules=extracted_rules,
            extraction=extraction_summary,
        )

    def delete_document(
        self,
        trainer_context: TrainerContext,
        document_id: str,
    ) -> TrainerKnowledgeDocument:
        trainer_id = trainer_context.trainer_id
        if not trainer_id:
            raise ValueError("No trainer context found")

        existing = self.repository.get_document(trainer_id, document_id)
        if not existing:
            raise ValueError("Document not found")

        self.repository.delete_rules_by_document(trainer_id, document_id)
        self.repository.delete_document(trainer_id, document_id)
        return TrainerKnowledgeDocument(**existing)

    def list_rules(
        self,
        trainer_id: str,
        *,
        include_archived: bool = False,
        category: str | None = None,
    ) -> list[TrainerRule]:
        rows = self.repository.list_rules_by_trainer(
            trainer_id,
            include_archived=include_archived,
            category=category.strip().lower() if isinstance(category, str) and category.strip() else None,
        )
        return [TrainerRule(**row) for row in rows]

    def update_rule(
        self,
        trainer_context: TrainerContext,
        rule_id: str,
        request: TrainerRuleUpdateRequest,
    ) -> TrainerRule:
        if not trainer_context.trainer_id:
            raise ValueError("No trainer context found")

        existing = self.repository.get_rule(trainer_context.trainer_id, rule_id)
        if not existing:
            raise ValueError("Rule not found")

        updates: dict[str, Any] = {}
        if request.category is not None:
            category = request.category.strip().lower()
            if not category:
                raise ValueError("Category cannot be empty")
            updates["category"] = category
        if request.rule_text is not None:
            rule_text = request.rule_text.strip()
            if not rule_text:
                raise ValueError("Rule text cannot be empty")
            updates["rule_text"] = rule_text
        if request.confidence is not None:
            updates["confidence"] = max(0.0, min(1.0, float(request.confidence)))
        if request.source_excerpt is not None:
            updates["source_excerpt"] = request.source_excerpt
        if request.metadata is not None:
            updates["metadata"] = request.metadata

        if not updates:
            return TrainerRule(**existing)

        next_version = int(existing.get("current_version") or 1) + 1
        updates["current_version"] = next_version
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()

        updated = self.repository.update_rule(trainer_context.trainer_id, rule_id, updates)
        if not updated:
            raise ValueError("Rule update failed")

        self._create_rule_version(
            rule=updated,
            version_number=next_version,
            change_type="updated",
            change_summary="Trainer edited rule",
        )
        return TrainerRule(**updated)

    def archive_rule(
        self,
        trainer_context: TrainerContext,
        rule_id: str,
    ) -> TrainerRule:
        if not trainer_context.trainer_id:
            raise ValueError("No trainer context found")

        existing = self.repository.get_rule(trainer_context.trainer_id, rule_id)
        if not existing:
            raise ValueError("Rule not found")
        if existing.get("is_archived"):
            return TrainerRule(**existing)

        next_version = int(existing.get("current_version") or 1) + 1
        updates = {
            "is_archived": True,
            "current_version": next_version,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        updated = self.repository.update_rule(trainer_context.trainer_id, rule_id, updates)
        if not updated:
            raise ValueError("Rule archive failed")

        self._create_rule_version(
            rule=updated,
            version_number=next_version,
            change_type="archived",
            change_summary="Trainer archived rule",
        )
        return TrainerRule(**updated)

    def _create_entry_version(
        self,
        *,
        entry: TrainerKnowledgeEntry,
        version_number: int,
        edited_by: str | None,
        change_reason: str | None,
    ) -> None:
        self.repository.create_entry_version(
            {
                "tenant_id": entry.tenant_id,
                "trainer_id": entry.trainer_id,
                "knowledge_entry_id": entry.id,
                "version_number": int(version_number),
                "content": entry.raw_content,
                "structured_summary": entry.structured_summary,
                "edited_by": edited_by,
                "change_reason": change_reason,
            }
        )

    def _matches_entry_query(self, row: dict[str, Any], normalized_query: str) -> bool:
        if not normalized_query:
            return True
        haystacks = [
            str(row.get("title") or ""),
            str(row.get("raw_content") or ""),
            str(row.get("structured_summary") or ""),
            str(row.get("knowledge_type") or ""),
            str((row.get("metadata") or {}).get("client_name") or ""),
        ]
        tags = row.get("tags")
        if isinstance(tags, list):
            haystacks.extend([str(tag or "") for tag in tags])
        combined = " ".join(haystacks).lower()
        return normalized_query in combined

    def _coerce_optional_text(self, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _normalize_scope(self, value: Any) -> str:
        normalized = str(value or "global").strip().lower().replace("-", "_")
        if normalized not in KNOWLEDGE_SCOPE_VALUES:
            return "global"
        return normalized

    def _normalize_status(self, value: Any) -> str:
        normalized = str(value or "active").strip().lower()
        if normalized not in KNOWLEDGE_STATUS_VALUES:
            return "active"
        return normalized

    def _normalize_source(self, value: Any) -> str:
        normalized = str(value or "manual_note").strip().lower()
        if normalized not in KNOWLEDGE_SOURCE_VALUES:
            return "manual_note"
        return normalized

    def _normalize_knowledge_type(self, value: Any) -> str:
        normalized = str(value or "other").strip().lower().replace("/", "_").replace(" ", "_")
        if normalized in {"coaching", "coaching_rules", "rule"}:
            normalized = "coaching_rule"
        if normalized in {"programming", "programming_rule", "programming_preferences"}:
            normalized = "programming_preference"
        if normalized in {"nutrition", "nutrition_rules"}:
            normalized = "nutrition_principle"
        if normalized in {"client", "pattern"}:
            normalized = "client_pattern"
        if normalized in {"communication", "style"}:
            normalized = "communication_style"
        if normalized in {"business", "policy"}:
            normalized = "business_policy"
        if normalized not in KNOWLEDGE_TYPE_VALUES:
            normalized = "other"
        return normalized

    def _normalize_confidence(self, value: Any) -> float | None:
        if value is None:
            return None
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return None
        return max(0.0, min(1.0, numeric))

    def _normalize_tags(self, tags: Any) -> list[str]:
        values = tags if isinstance(tags, list) else []
        normalized: list[str] = []
        seen: set[str] = set()
        for item in values:
            tag = str(item or "").strip().lower()
            if not tag:
                continue
            tag = tag.replace(" ", "_")
            if tag in seen:
                continue
            seen.add(tag)
            normalized.append(tag[:48])
        return normalized[:16]

    def _tokenize(self, text: str) -> set[str]:
        tokens: set[str] = set()
        for token in TOKEN_PATTERN.findall(str(text or "").lower()):
            if token in TAG_STOPWORDS or len(token) < 3:
                continue
            tokens.add(token)
        return tokens

    def _build_default_title(self, raw_content: str) -> str:
        sentence = str(raw_content or "").strip().split(".")[0].strip()
        if sentence:
            return sentence[:72]
        return "Coaching knowledge"

    def _infer_knowledge_type(self, raw_content: str, tags: list[str]) -> str:
        text = f"{raw_content} {' '.join(tags)}".lower()
        if any(keyword in text for keyword in ("macro", "protein", "calorie", "nutrition", "meal")):
            return "nutrition_principle"
        if any(keyword in text for keyword in ("tone", "language", "message", "phrasing", "communicat")):
            return "communication_style"
        if any(keyword in text for keyword in ("policy", "refund", "billing", "business", "session")):
            return "business_policy"
        if any(keyword in text for keyword in ("client tends", "pattern", "usually struggles", "often misses")):
            return "client_pattern"
        if any(keyword in text for keyword in ("program", "sets", "reps", "intensity", "volume", "exercise")):
            return "programming_preference"
        if any(keyword in text for keyword in ("always", "never", "should", "avoid", "rule", "when")):
            return "coaching_rule"
        return "other"

    def _infer_scope(self, raw_content: str, client_id: str | None) -> str:
        text = raw_content.lower()
        if client_id:
            if any(keyword in text for keyword in ("this client", "for client", "specific client")):
                return "client_specific"
            if any(keyword in text for keyword in ("all clients", "every client", "global")):
                return "global"
            return "client_specific"
        return "global"

    def _extract_tags(self, raw_content: str) -> list[str]:
        candidate_map = {
            "sleep": ("sleep", "sleep_deprived", "insomnia"),
            "recovery": ("recovery", "fatigue", "readiness", "deload"),
            "intensity": ("intensity", "volume", "load", "effort"),
            "knee_pain": ("knee", "patella", "lunge"),
            "nutrition": ("nutrition", "calorie", "protein", "macro"),
            "communication": ("communication", "tone", "message"),
            "policy": ("policy", "billing", "refund"),
        }
        text = raw_content.lower()
        tags: list[str] = []
        for tag, keywords in candidate_map.items():
            if any(keyword in text for keyword in keywords):
                tags.append(tag)
        return self._normalize_tags(tags)

    def _suggest_structure(
        self,
        *,
        raw_content: str,
        title: str | None,
        client_id: str | None,
        preferred_scope: str | None,
        preferred_knowledge_type: str | None,
    ) -> TrainerKnowledgeClassificationSuggestion:
        resolved_tags = self._extract_tags(raw_content)
        inferred_type = self._infer_knowledge_type(raw_content, resolved_tags)
        resolved_type = self._normalize_knowledge_type(preferred_knowledge_type or inferred_type)
        inferred_scope = self._infer_scope(raw_content, client_id)
        resolved_scope = self._normalize_scope(preferred_scope or inferred_scope)
        confidence = 0.58
        if resolved_tags:
            confidence += 0.1
        if resolved_type != "other":
            confidence += 0.14
        if resolved_scope == "client_specific" and client_id:
            confidence += 0.08
        safety = self._review_safety(raw_content)
        if safety.ai_enabled_forced_off:
            confidence -= 0.15
        resolved_title = str(title or "").strip() or self._build_default_title(raw_content)
        structured_summary = raw_content.strip()[:220] if raw_content.strip() else None
        return TrainerKnowledgeClassificationSuggestion(
            title=resolved_title,
            structured_summary=structured_summary,
            knowledge_type=resolved_type,
            scope=resolved_scope,
            tags=resolved_tags,
            ai_enabled=not safety.ai_enabled_forced_off,
            confidence=max(0.0, min(1.0, confidence)),
            client_id=client_id if resolved_scope == "client_specific" else None,
            rationale="Heuristic classification based on content keywords, scope signals, and safety checks.",
        )

    def _review_safety(self, raw_content: str) -> TrainerKnowledgeSafetyCheckResult:
        text = raw_content.lower()
        matched_high_risk = [pattern for pattern in SAFETY_HIGH_RISK_PATTERNS if pattern in text]
        if matched_high_risk:
            return TrainerKnowledgeSafetyCheckResult(
                ai_enabled_forced_off=True,
                issues=matched_high_risk,
                message="This was saved, but AI usage is off until reviewed.",
                severity="high",
            )
        matched_review = [pattern for pattern in SAFETY_REVIEW_PATTERNS if pattern in text]
        if matched_review:
            return TrainerKnowledgeSafetyCheckResult(
                ai_enabled_forced_off=False,
                issues=matched_review,
                message=None,
                severity="review",
            )
        return TrainerKnowledgeSafetyCheckResult(
            ai_enabled_forced_off=False,
            issues=[],
            message=None,
            severity=None,
        )

    def _detect_conflicts(
        self,
        *,
        trainer_context: TrainerContext,
        target_entry: TrainerKnowledgeEntry,
        ignore_entry_id: str | None,
    ) -> list[TrainerKnowledgeConflictCandidate]:
        trainer_id = trainer_context.trainer_id
        if not trainer_id:
            return []
        candidates = self.repository.list_conflict_candidates(trainer_id, limit=160)
        target_tokens = self._tokenize(f"{target_entry.title} {target_entry.raw_content} {' '.join(target_entry.tags)}")
        if not target_tokens:
            return []
        target_neg = len(target_tokens.intersection(NEGATION_TOKENS)) > 0
        target_pos = len(target_tokens.intersection(AFFIRMATION_TOKENS)) > 0

        conflicts: list[TrainerKnowledgeConflictCandidate] = []
        for candidate in candidates:
            candidate_id = str(candidate.get("id") or "").strip()
            if not candidate_id or candidate_id == ignore_entry_id:
                continue
            candidate_scope = self._normalize_scope(candidate.get("scope"))
            candidate_client_id = str(candidate.get("client_id") or "").strip() or None
            if target_entry.scope == "client_specific":
                if candidate_scope == "client_specific" and candidate_client_id != target_entry.client_id:
                    continue
            candidate_tokens = self._tokenize(
                f"{candidate.get('title') or ''} {candidate.get('raw_content') or ''} {' '.join(candidate.get('tags') or [])}"
            )
            if not candidate_tokens:
                continue
            overlap = target_tokens.intersection(candidate_tokens)
            if len(overlap) < 3:
                continue
            candidate_neg = len(candidate_tokens.intersection(NEGATION_TOKENS)) > 0
            candidate_pos = len(candidate_tokens.intersection(AFFIRMATION_TOKENS)) > 0
            polarity_conflict = (target_neg and candidate_pos) or (target_pos and candidate_neg)
            overlap_ratio = len(overlap) / max(1, min(len(target_tokens), len(candidate_tokens)))
            if not polarity_conflict and overlap_ratio < 0.72:
                continue
            score = round(min(0.99, (0.45 if polarity_conflict else 0.2) + overlap_ratio * 0.6), 3)
            if score < 0.55:
                continue
            conflicts.append(
                TrainerKnowledgeConflictCandidate(
                    knowledge_entry_id=candidate_id,
                    title=str(candidate.get("title") or "Existing knowledge"),
                    structured_summary=self._coerce_optional_text(candidate.get("structured_summary")),
                    knowledge_type=self._normalize_knowledge_type(candidate.get("knowledge_type")),
                    score=score,
                    suggested_resolution="review",
                )
            )
        conflicts.sort(key=lambda item: item.score, reverse=True)
        return conflicts[:5]

    def _create_extracted_rule(
        self,
        *,
        trainer_context: TrainerContext,
        document: TrainerKnowledgeDocument,
        candidate: dict[str, Any],
        create_change_summary: str = "Created from Agent Lab ingest",
    ) -> dict[str, Any] | None:
        trainer_id = trainer_context.trainer_id
        tenant_id = trainer_context.tenant_id
        if not trainer_id or not tenant_id:
            return None

        payload = {
            "tenant_id": tenant_id,
            "trainer_id": trainer_id,
            "document_id": document.id,
            "category": candidate.get("category", "general_coaching"),
            "rule_text": candidate.get("rule_text"),
            "confidence": candidate.get("confidence"),
            "source_excerpt": candidate.get("source_excerpt"),
            "metadata": {
                **(candidate.get("metadata") or {}),
                "ingest_source": "agent_lab",
                "document_title": document.title,
            },
            "is_archived": False,
            "current_version": 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if not isinstance(payload.get("rule_text"), str) or not payload["rule_text"].strip():
            return None

        created = self.repository.create_rule(payload)
        if not created:
            return None

        self._create_rule_version(
            rule=created,
            version_number=1,
            change_type="created",
            change_summary=create_change_summary,
        )
        return created

    def _extract_and_persist_rules(
        self,
        *,
        trainer_context: TrainerContext,
        document: TrainerKnowledgeDocument,
        raw_text: str,
        title: str | None,
        replace_document_rules: bool,
        archive_change_summary: str,
        create_change_summary: str,
    ) -> tuple[list[TrainerRule], TrainerKnowledgeExtractionSummary]:
        normalized_raw_text = raw_text.strip()
        if not normalized_raw_text:
            return [], TrainerKnowledgeExtractionSummary(
                strategy="deterministic",
                llm_attempted=False,
                llm_succeeded=False,
                fallback_reason="raw_text_missing",
                rules_created=0,
            )

        if not trainer_context.tenant_id:
            return [], TrainerKnowledgeExtractionSummary(
                strategy="deterministic",
                llm_attempted=False,
                llm_succeeded=False,
                fallback_reason="tenant_context_missing_for_extraction",
                rules_created=0,
            )

        try:
            extracted_candidates, extraction_summary = self.extractor.extract(
                raw_text=normalized_raw_text,
                title=title,
            )
        except Exception as exc:
            logger.exception(
                "Trainer knowledge extraction failed for trainer_id=%s",
                trainer_context.trainer_id,
            )
            return [], TrainerKnowledgeExtractionSummary(
                strategy="deterministic",
                llm_attempted=False,
                llm_succeeded=False,
                fallback_reason=f"extractor_exception:{exc.__class__.__name__}",
                rules_created=0,
            )

        created_rules: list[TrainerRule] = []
        try:
            if replace_document_rules:
                self._archive_document_rules(
                    trainer_context=trainer_context,
                    document_id=document.id,
                    change_summary=archive_change_summary,
                )

            for candidate in extracted_candidates:
                created = self._create_extracted_rule(
                    trainer_context=trainer_context,
                    document=document,
                    candidate=candidate,
                    create_change_summary=create_change_summary,
                )
                if created:
                    created_rules.append(TrainerRule(**created))
        except Exception as exc:
            logger.exception(
                "Trainer rule persistence failed for trainer_id=%s",
                trainer_context.trainer_id,
            )
            summary_payload = {
                **extraction_summary,
                "fallback_reason": f"rule_persistence_exception:{exc.__class__.__name__}",
                "rules_created": 0,
            }
            return [], TrainerKnowledgeExtractionSummary(**summary_payload)

        summary_payload = {
            **extraction_summary,
            "rules_created": len(created_rules),
        }
        return created_rules, TrainerKnowledgeExtractionSummary(**summary_payload)

    def _archive_document_rules(
        self,
        *,
        trainer_context: TrainerContext,
        document_id: str | None,
        change_summary: str,
    ) -> None:
        trainer_id = trainer_context.trainer_id
        if not trainer_id or not document_id:
            return

        existing_rules = self.repository.list_rules_by_document(
            trainer_id,
            document_id,
            include_archived=False,
        )
        for existing in existing_rules:
            rule_id = existing.get("id")
            if not rule_id:
                continue

            next_version = int(existing.get("current_version") or 1) + 1
            updates = {
                "is_archived": True,
                "current_version": next_version,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            updated = self.repository.update_rule(trainer_id, rule_id, updates)
            if not updated:
                raise ValueError("Rule archive failed")

            self._create_rule_version(
                rule=updated,
                version_number=next_version,
                change_type="archived",
                change_summary=change_summary,
            )

    def _create_rule_version(
        self,
        *,
        rule: dict[str, Any],
        version_number: int,
        change_type: str,
        change_summary: str | None,
    ) -> None:
        self.repository.create_rule_version(
            {
                "tenant_id": rule.get("tenant_id"),
                "trainer_id": rule.get("trainer_id"),
                "rule_id": rule.get("id"),
                "version_number": version_number,
                "change_type": change_type,
                "rule_snapshot": self._snapshot_rule(rule),
                "change_summary": change_summary,
            }
        )

    def _snapshot_rule(self, rule: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": rule.get("id"),
            "tenant_id": rule.get("tenant_id"),
            "trainer_id": rule.get("trainer_id"),
            "document_id": rule.get("document_id"),
            "category": rule.get("category"),
            "rule_text": rule.get("rule_text"),
            "confidence": rule.get("confidence"),
            "source_excerpt": rule.get("source_excerpt"),
            "metadata": rule.get("metadata") or {},
            "is_archived": bool(rule.get("is_archived")),
            "current_version": int(rule.get("current_version") or 1),
            "updated_at": rule.get("updated_at"),
        }
