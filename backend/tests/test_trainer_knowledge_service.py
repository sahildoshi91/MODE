import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.tenancy import TrainerContext
from app.modules.trainer_knowledge.schemas import (
    TrainerKnowledgeDocumentUpdateRequest,
    TrainerKnowledgeIngestRequest,
)
from app.modules.trainer_knowledge.service import TrainerKnowledgeService


class FakeTrainerKnowledgeRepository:
    def __init__(self, *, fail_create_rule: bool = False, fail_create_rule_version: bool = False):
        self.fail_create_rule = fail_create_rule
        self.fail_create_rule_version = fail_create_rule_version
        self.created_rules = []
        self.created_rule_versions = []
        self.updated_documents = []
        self.updated_rules = []
        self.documents = {
            "doc-1": {
                "id": "doc-1",
                "trainer_id": "trainer-1",
                "title": "Methodology",
                "file_url": None,
                "document_type": "text",
                "raw_text": "Coach quality before load.",
                "metadata": {"source": "agent_lab"},
                "indexing_status": "pending",
                "created_at": "2026-04-13T10:00:00+00:00",
            }
        }
        self.document_rules = {
            "doc-1": [
                {
                    "id": "rule-existing-1",
                    "tenant_id": "tenant-1",
                    "trainer_id": "trainer-1",
                    "document_id": "doc-1",
                    "category": "general_coaching",
                    "rule_text": "Existing rule",
                    "confidence": 0.6,
                    "source_excerpt": "Existing rule",
                    "metadata": {},
                    "is_archived": False,
                    "current_version": 1,
                    "created_at": "2026-04-13T10:00:00+00:00",
                    "updated_at": "2026-04-13T10:00:00+00:00",
                }
            ]
        }

    def create(self, payload):
        return {
            "id": "doc-ingest-1",
            "trainer_id": payload["trainer_id"],
            "title": payload["title"],
            "file_url": payload.get("file_url"),
            "document_type": payload.get("document_type"),
            "raw_text": payload.get("raw_text"),
            "metadata": payload.get("metadata") or {},
            "indexing_status": "pending",
            "created_at": "2026-04-13T10:00:00+00:00",
        }

    def get_document(self, trainer_id, document_id):
        doc = self.documents.get(document_id)
        if not doc or doc.get("trainer_id") != trainer_id:
            return None
        return {**doc}

    def update_document(self, trainer_id, document_id, payload):
        existing = self.get_document(trainer_id, document_id)
        if not existing:
            return {}
        updated = {
            **existing,
            **payload,
        }
        self.documents[document_id] = updated
        self.updated_documents.append({"document_id": document_id, "payload": payload})
        return {**updated}

    def list_rules_by_document(self, trainer_id, document_id, include_archived=False):
        rules = [
            {**rule}
            for rule in self.document_rules.get(document_id, [])
            if rule.get("trainer_id") == trainer_id
        ]
        if not include_archived:
            rules = [rule for rule in rules if not rule.get("is_archived")]
        return rules

    def update_rule(self, trainer_id, rule_id, payload):
        for doc_id, rules in self.document_rules.items():
            for index, rule in enumerate(rules):
                if rule.get("trainer_id") != trainer_id or rule.get("id") != rule_id:
                    continue
                updated = {
                    **rule,
                    **payload,
                }
                rules[index] = updated
                self.updated_rules.append({"document_id": doc_id, "rule_id": rule_id, "payload": payload})
                return {**updated}
        return {}

    def create_rule(self, payload):
        if self.fail_create_rule:
            raise RuntimeError("create_rule_failure")

        created = {
            "id": f"rule-{len(self.created_rules) + 1}",
            "tenant_id": payload["tenant_id"],
            "trainer_id": payload["trainer_id"],
            "document_id": payload.get("document_id"),
            "category": payload["category"],
            "rule_text": payload["rule_text"],
            "confidence": payload.get("confidence"),
            "source_excerpt": payload.get("source_excerpt"),
            "metadata": payload.get("metadata") or {},
            "is_archived": False,
            "current_version": 1,
            "created_at": "2026-04-13T10:00:00+00:00",
            "updated_at": payload.get("updated_at"),
        }
        self.created_rules.append(created)
        if created["document_id"]:
            self.document_rules.setdefault(created["document_id"], []).append(created)
        return created

    def create_rule_version(self, payload):
        if self.fail_create_rule_version:
            raise RuntimeError("create_rule_version_failure")
        created = {"id": f"rule-version-{len(self.created_rule_versions) + 1}", **payload}
        self.created_rule_versions.append(created)
        return created


class RaisingExtractor:
    def extract(self, *, raw_text, title, max_rules=24):
        del raw_text, title, max_rules
        raise RuntimeError("extractor_failure")


class ReturningExtractor:
    def extract(self, *, raw_text, title, max_rules=24):
        del raw_text, title, max_rules
        return (
            [
                {
                    "category": "general_coaching",
                    "rule_text": "Coach quality before load.",
                    "confidence": 0.8,
                    "source_excerpt": "Coach quality before load.",
                    "metadata": {"source": "deterministic"},
                }
            ],
            {
                "strategy": "deterministic",
                "llm_attempted": False,
                "llm_succeeded": False,
                "fallback_reason": None,
                "rules_created": 1,
            },
        )


class TrainerKnowledgeServiceTests(unittest.TestCase):
    def setUp(self):
        self.trainer_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id=None,
        )
        self.request = TrainerKnowledgeIngestRequest(
            title="Methodology",
            raw_text="Coach quality before load.",
            document_type="text",
            metadata={"source": "agent_lab"},
        )

    def test_ingest_document_succeeds_with_extractor_failure_fallback(self):
        repository = FakeTrainerKnowledgeRepository()
        service = TrainerKnowledgeService(repository=repository, extractor=RaisingExtractor())

        response = service.ingest_document(self.trainer_context, self.request)

        self.assertEqual(response.document.title, "Methodology")
        self.assertEqual(response.extraction.rules_created, 0)
        self.assertEqual(response.extracted_rules, [])
        self.assertTrue(
            isinstance(response.extraction.fallback_reason, str)
            and response.extraction.fallback_reason.startswith("extractor_exception:")
        )

    def test_ingest_document_succeeds_with_rule_create_failure_fallback(self):
        repository = FakeTrainerKnowledgeRepository(fail_create_rule=True)
        service = TrainerKnowledgeService(repository=repository, extractor=ReturningExtractor())

        response = service.ingest_document(self.trainer_context, self.request)

        self.assertEqual(response.document.title, "Methodology")
        self.assertEqual(response.extraction.rules_created, 0)
        self.assertEqual(response.extracted_rules, [])
        self.assertTrue(
            isinstance(response.extraction.fallback_reason, str)
            and response.extraction.fallback_reason.startswith("rule_persistence_exception:")
        )

    def test_ingest_document_succeeds_with_rule_version_failure_fallback(self):
        repository = FakeTrainerKnowledgeRepository(fail_create_rule_version=True)
        service = TrainerKnowledgeService(repository=repository, extractor=ReturningExtractor())

        response = service.ingest_document(self.trainer_context, self.request)

        self.assertEqual(response.document.title, "Methodology")
        self.assertEqual(response.extraction.rules_created, 0)
        self.assertEqual(response.extracted_rules, [])
        self.assertTrue(
            isinstance(response.extraction.fallback_reason, str)
            and response.extraction.fallback_reason.startswith("rule_persistence_exception:")
        )

    def test_ingest_document_with_missing_tenant_context_saves_and_defers_extraction(self):
        repository = FakeTrainerKnowledgeRepository()
        service = TrainerKnowledgeService(repository=repository, extractor=ReturningExtractor())
        context_without_tenant = TrainerContext(
            tenant_id=None,
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id=None,
        )

        response = service.ingest_document(context_without_tenant, self.request)

        self.assertEqual(response.document.title, "Methodology")
        self.assertEqual(response.extraction.rules_created, 0)
        self.assertEqual(response.extracted_rules, [])
        self.assertEqual(response.extraction.fallback_reason, "tenant_context_missing_for_extraction")

    def test_update_document_reextracts_and_archives_existing_document_rules(self):
        repository = FakeTrainerKnowledgeRepository()
        service = TrainerKnowledgeService(repository=repository, extractor=ReturningExtractor())
        request = TrainerKnowledgeDocumentUpdateRequest(
            title="Updated Methodology",
            raw_text="Coach quality before load, then progress deliberately.",
        )

        response = service.update_document(self.trainer_context, "doc-1", request)

        self.assertEqual(response.document.title, "Updated Methodology")
        self.assertEqual(response.extraction.rules_created, 1)
        self.assertEqual(len(repository.updated_rules), 1)
        self.assertTrue(repository.updated_rules[0]["payload"]["is_archived"])
        self.assertGreaterEqual(len(repository.created_rule_versions), 2)

    def test_update_document_succeeds_with_extractor_failure_fallback(self):
        repository = FakeTrainerKnowledgeRepository()
        service = TrainerKnowledgeService(repository=repository, extractor=RaisingExtractor())
        request = TrainerKnowledgeDocumentUpdateRequest(
            title="Updated Methodology",
            raw_text="Updated content",
        )

        response = service.update_document(self.trainer_context, "doc-1", request)

        self.assertEqual(response.document.title, "Updated Methodology")
        self.assertEqual(response.extracted_rules, [])
        self.assertEqual(response.extraction.rules_created, 0)
        self.assertTrue(
            isinstance(response.extraction.fallback_reason, str)
            and response.extraction.fallback_reason.startswith("extractor_exception:")
        )

    def test_update_document_succeeds_with_rule_persistence_failure_fallback(self):
        repository = FakeTrainerKnowledgeRepository(fail_create_rule=True)
        service = TrainerKnowledgeService(repository=repository, extractor=ReturningExtractor())
        request = TrainerKnowledgeDocumentUpdateRequest(
            title="Updated Methodology",
            raw_text="Updated content",
        )

        response = service.update_document(self.trainer_context, "doc-1", request)

        self.assertEqual(response.document.title, "Updated Methodology")
        self.assertEqual(response.extracted_rules, [])
        self.assertEqual(response.extraction.rules_created, 0)
        self.assertTrue(
            isinstance(response.extraction.fallback_reason, str)
            and response.extraction.fallback_reason.startswith("rule_persistence_exception:")
        )

    def test_update_document_not_found_raises(self):
        repository = FakeTrainerKnowledgeRepository()
        service = TrainerKnowledgeService(repository=repository, extractor=ReturningExtractor())
        request = TrainerKnowledgeDocumentUpdateRequest(
            title="Missing",
            raw_text="Missing",
        )

        with self.assertRaises(ValueError) as context:
            service.update_document(self.trainer_context, "doc-missing", request)
        self.assertEqual(str(context.exception), "Document not found")


if __name__ == "__main__":
    unittest.main()
