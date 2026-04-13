from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.core.tenancy import TrainerContext
from app.modules.trainer_knowledge.extractor import TrainerRuleExtractor
from app.modules.trainer_knowledge.repository import TrainerKnowledgeRepository
from app.modules.trainer_knowledge.schemas import (
    TrainerKnowledgeDocument,
    TrainerKnowledgeDocumentCreate,
    TrainerKnowledgeDocumentUpdateRequest,
    TrainerKnowledgeExtractionSummary,
    TrainerKnowledgeIngestRequest,
    TrainerKnowledgeSaveResponse,
    TrainerRule,
    TrainerRuleUpdateRequest,
)

logger = logging.getLogger(__name__)


class TrainerKnowledgeService:
    def __init__(
        self,
        repository: TrainerKnowledgeRepository,
        extractor: TrainerRuleExtractor | None = None,
    ):
        self.repository = repository
        self.extractor = extractor or TrainerRuleExtractor()

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
