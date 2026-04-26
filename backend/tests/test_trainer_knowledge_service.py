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
    TrainerKnowledgeEntryCreateRequest,
    TrainerKnowledgeEntryUpdateRequest,
    TrainerKnowledgeIngestRequest,
)
from app.modules.trainer_knowledge.service import TrainerKnowledgeService


class FakeTrainerKnowledgeRepository:
    def __init__(self, *, fail_create_rule: bool = False, fail_create_rule_version: bool = False):
        self.fail_create_rule = fail_create_rule
        self.fail_create_rule_version = fail_create_rule_version
        self.created_rules = []
        self.created_rule_versions = []
        self.created_entry_versions = []
        self.updated_documents = []
        self.updated_rules = []
        self.deleted_documents = []
        self.deleted_rule_documents = []
        self.updated_entries = []
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
        self.entries = {
            "entry-1": {
                "id": "entry-1",
                "tenant_id": "tenant-1",
                "trainer_id": "trainer-1",
                "client_id": "client-1",
                "title": "Existing client note",
                "raw_content": "Reduce intensity when sleep is poor.",
                "structured_summary": "Reduce intensity when sleep is poor.",
                "knowledge_type": "coaching_rule",
                "scope": "client_specific",
                "tags": ["sleep"],
                "ai_enabled": True,
                "status": "active",
                "source": "manual_note",
                "confidence_score": 0.81,
                "embedding_status": "embedded",
                "last_embedded_at": "2026-04-24T10:00:00+00:00",
                "version_count": 1,
                "last_used_at": None,
                "usage_count": 0,
                "conflict_group_id": None,
                "metadata": {},
                "created_at": "2026-04-24T09:00:00+00:00",
                "updated_at": "2026-04-24T10:00:00+00:00",
                "archived_at": None,
            }
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

    def delete_document(self, trainer_id, document_id):
        existing = self.get_document(trainer_id, document_id)
        if existing:
            self.deleted_documents.append(document_id)
            self.documents.pop(document_id, None)
        return [existing] if existing else []

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

    def delete_rules_by_document(self, trainer_id, document_id):
        rules = [
            {**rule}
            for rule in self.document_rules.get(document_id, [])
            if rule.get("trainer_id") == trainer_id
        ]
        self.deleted_rule_documents.append(document_id)
        self.document_rules[document_id] = []
        return rules

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

    def list_entries_by_trainer(
        self,
        trainer_id,
        *,
        include_archived=False,
        scope=None,
        ai_enabled=None,
        limit=120,
        offset=0,
    ):
        del limit, offset
        rows = [row for row in self.entries.values() if row.get("trainer_id") == trainer_id]
        if not include_archived:
            rows = [row for row in rows if row.get("status") != "archived"]
        if scope:
            normalized_scope = str(scope).strip().lower().replace("-", "_")
            if normalized_scope in {"client", "client_specific", "clientspecific"}:
                rows = [
                    row for row in rows
                    if str(row.get("scope") or "").strip().lower().replace("-", "_") in {
                        "client",
                        "client_specific",
                        "clientspecific",
                    }
                ]
            elif normalized_scope == "global":
                rows = [row for row in rows if str(row.get("scope") or "").strip().lower() == "global"]
        if isinstance(ai_enabled, bool):
            rows = [row for row in rows if bool(row.get("ai_enabled")) == ai_enabled]
        return [dict(row) for row in rows]

    def list_conflict_candidates(self, trainer_id, *, limit=120):
        del limit
        return [
            {
                "id": row["id"],
                "client_id": row.get("client_id"),
                "title": row.get("title"),
                "raw_content": row.get("raw_content"),
                "structured_summary": row.get("structured_summary"),
                "knowledge_type": row.get("knowledge_type"),
                "scope": row.get("scope"),
                "tags": row.get("tags") or [],
                "updated_at": row.get("updated_at"),
            }
            for row in self.entries.values()
            if row.get("trainer_id") == trainer_id and row.get("status") == "active"
        ]

    def create_entry(self, payload):
        entry_id = f"entry-{len(self.entries) + 1}"
        created = {
            "id": entry_id,
            "tenant_id": payload["tenant_id"],
            "trainer_id": payload["trainer_id"],
            "client_id": payload.get("client_id"),
            "title": payload["title"],
            "raw_content": payload["raw_content"],
            "structured_summary": payload.get("structured_summary"),
            "knowledge_type": payload.get("knowledge_type", "other"),
            "scope": payload.get("scope", "global"),
            "tags": payload.get("tags") or [],
            "ai_enabled": bool(payload.get("ai_enabled", True)),
            "status": payload.get("status", "active"),
            "source": payload.get("source", "manual_note"),
            "confidence_score": payload.get("confidence_score"),
            "embedding_status": payload.get("embedding_status", "pending"),
            "last_embedded_at": payload.get("last_embedded_at"),
            "version_count": int(payload.get("version_count") or 1),
            "last_used_at": payload.get("last_used_at"),
            "usage_count": int(payload.get("usage_count") or 0),
            "conflict_group_id": payload.get("conflict_group_id"),
            "metadata": payload.get("metadata") or {},
            "created_at": payload.get("created_at"),
            "updated_at": payload.get("updated_at"),
            "archived_at": payload.get("archived_at"),
        }
        self.entries[entry_id] = created
        return dict(created)

    def get_entry(self, trainer_id, entry_id):
        row = self.entries.get(entry_id)
        if not row or row.get("trainer_id") != trainer_id:
            return None
        return dict(row)

    def update_entry(self, trainer_id, entry_id, payload):
        row = self.entries.get(entry_id)
        if not row or row.get("trainer_id") != trainer_id:
            return {}
        updated = {
            **row,
            **payload,
        }
        self.entries[entry_id] = updated
        self.updated_entries.append({"entry_id": entry_id, "payload": payload})
        return dict(updated)

    def create_entry_version(self, payload):
        created = {"id": f"entry-version-{len(self.created_entry_versions) + 1}", **payload}
        self.created_entry_versions.append(created)
        return created

    def list_entry_versions(self, trainer_id, knowledge_entry_id, *, limit=50):
        del trainer_id, knowledge_entry_id, limit
        return [*self.created_entry_versions]


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

    def test_delete_document_removes_document_and_linked_rules(self):
        repository = FakeTrainerKnowledgeRepository()
        service = TrainerKnowledgeService(repository=repository, extractor=ReturningExtractor())

        deleted = service.delete_document(self.trainer_context, "doc-1")

        self.assertEqual(deleted.id, "doc-1")
        self.assertIn("doc-1", repository.deleted_documents)
        self.assertIn("doc-1", repository.deleted_rule_documents)
        self.assertIsNone(repository.get_document("trainer-1", "doc-1"))
        self.assertEqual(repository.list_rules_by_document("trainer-1", "doc-1"), [])

    def test_create_entry_accepts_client_scope_alias_and_sets_embedding_pending(self):
        repository = FakeTrainerKnowledgeRepository()
        service = TrainerKnowledgeService(repository=repository, extractor=ReturningExtractor())

        response = service.create_entry(
            self.trainer_context,
            TrainerKnowledgeEntryCreateRequest(
                title="Client sleep rule",
                raw_content="For this client, reduce intensity when sleep is poor.",
                scope="client",
                client_id="client-123",
                ai_enabled=True,
                knowledge_type="coaching_rule",
                tags=["sleep"],
            ),
        )

        self.assertEqual(response.entry.scope, "client")
        self.assertEqual(response.entry.client_id, "client-123")
        self.assertEqual(response.entry.embedding_status, "pending")
        self.assertIsNone(response.entry.last_embedded_at)

    def test_update_entry_with_ai_enabled_content_change_marks_embedding_pending(self):
        repository = FakeTrainerKnowledgeRepository()
        service = TrainerKnowledgeService(repository=repository, extractor=ReturningExtractor())

        response = service.update_entry(
            self.trainer_context,
            "entry-1",
            TrainerKnowledgeEntryUpdateRequest(
                raw_content="Reduce intensity and trim accessory volume when sleep is poor.",
                ai_enabled=True,
            ),
        )

        self.assertEqual(response.entry.embedding_status, "pending")
        self.assertIsNone(response.entry.last_embedded_at)
        self.assertGreaterEqual(response.entry.version_count, 2)
        self.assertTrue(any(
            update["payload"].get("embedding_status") == "pending"
            for update in repository.updated_entries
        ))

    def test_list_entries_scope_alias_client_maps_to_client(self):
        repository = FakeTrainerKnowledgeRepository()
        service = TrainerKnowledgeService(repository=repository, extractor=ReturningExtractor())

        rows = service.list_entries(
            self.trainer_context,
            scope="client",
            client_id="client-1",
            include_archived=False,
        )

        self.assertGreaterEqual(len(rows), 1)
        self.assertTrue(all(row.scope == "client" for row in rows))


if __name__ == "__main__":
    unittest.main()
