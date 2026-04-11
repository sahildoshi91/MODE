from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.core.tenancy import TrainerContext
from app.modules.trainer_knowledge.extractor import TrainerRuleExtractor
from app.modules.trainer_knowledge.repository import TrainerKnowledgeRepository
from app.modules.trainer_knowledge.schemas import (
    TrainerKnowledgeDocument,
    TrainerKnowledgeDocumentCreate,
    TrainerKnowledgeExtractionSummary,
    TrainerKnowledgeIngestRequest,
    TrainerKnowledgeIngestResponse,
    TrainerRule,
    TrainerRuleUpdateRequest,
)


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
    ) -> TrainerKnowledgeIngestResponse:
        if not trainer_context.trainer_id:
            raise ValueError("No trainer context found")
        if not trainer_context.tenant_id:
            raise ValueError("Trainer tenant context is missing")

        document_payload = request.model_dump()
        document_payload["trainer_id"] = trainer_context.trainer_id
        if not document_payload.get("document_type"):
            document_payload["document_type"] = "text"

        created_document = self.repository.create(document_payload)
        document = TrainerKnowledgeDocument(**created_document)

        raw_text = (request.raw_text or "").strip()
        if not raw_text:
            return TrainerKnowledgeIngestResponse(
                document=document,
                extracted_rules=[],
                extraction=TrainerKnowledgeExtractionSummary(
                    strategy="deterministic",
                    llm_attempted=False,
                    llm_succeeded=False,
                    fallback_reason="raw_text_missing",
                    rules_created=0,
                ),
            )

        extracted_candidates, extraction_summary = self.extractor.extract(
            raw_text=raw_text,
            title=request.title,
        )
        created_rules: list[TrainerRule] = []
        for candidate in extracted_candidates:
            created = self._create_extracted_rule(
                trainer_context=trainer_context,
                document=document,
                candidate=candidate,
            )
            if created:
                created_rules.append(TrainerRule(**created))

        summary_payload = {
            **extraction_summary,
            "rules_created": len(created_rules),
        }
        return TrainerKnowledgeIngestResponse(
            document=document,
            extracted_rules=created_rules,
            extraction=TrainerKnowledgeExtractionSummary(**summary_payload),
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
            change_summary="Created from Agent Lab ingest",
        )
        return created

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
