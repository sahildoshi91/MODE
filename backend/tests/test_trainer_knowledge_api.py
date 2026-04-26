import os
import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_trainer_context, get_trainer_knowledge_service
from app.core.tenancy import TrainerContext
from app.main import app


class FakeTrainerKnowledgeService:
    def __init__(self):
        self.last_create = None
        self.last_update = None
        self.last_delete_document_id = None
        self.documents = [
            {
                "id": "doc-1",
                "trainer_id": "trainer-123",
                "title": "Programming Rules",
                "file_url": None,
                "document_type": "text",
                "raw_text": "Always prioritize movement quality before volume.",
                "metadata": {"source": "trainer_home"},
                "indexing_status": "pending",
                "created_at": "2026-04-11T10:00:00+00:00",
            }
        ]
        self.rules = [
            {
                "id": "rule-1",
                "tenant_id": "tenant-1",
                "trainer_id": "trainer-123",
                "document_id": "doc-1",
                "category": "training_philosophy",
                "rule_text": "Prioritize quality reps before adding load.",
                "confidence": 0.76,
                "source_excerpt": "Prioritize quality reps before adding load.",
                "metadata": {"source": "deterministic"},
                "is_archived": False,
                "current_version": 1,
                "created_at": "2026-04-11T10:00:00+00:00",
                "updated_at": "2026-04-11T10:00:00+00:00",
            }
        ]
        self.entries = [
            {
                "id": "entry-1",
                "tenant_id": "tenant-1",
                "trainer_id": "trainer-123",
                "client_id": None,
                "title": "Adjust intensity when sleep is poor",
                "raw_content": "When sleep is poor, lower volume and focus on movement quality.",
                "structured_summary": "Lower volume when sleep is poor.",
                "knowledge_type": "rule",
                "scope": "global",
                "tags": ["sleep", "recovery"],
                "ai_enabled": True,
                "status": "active",
                "source": "manual",
                "confidence_score": 0.84,
                "embedding_status": "embedded",
                "last_embedded_at": "2026-04-11T10:00:00+00:00",
                "version_count": 1,
                "last_used_at": None,
                "usage_count": 0,
                "conflict_group_id": None,
                "metadata": {},
                "created_at": "2026-04-11T10:00:00+00:00",
                "updated_at": "2026-04-11T10:00:00+00:00",
                "archived_at": None,
            }
        ]
        self.entry_versions = {
            "entry-1": [
                {
                    "id": "version-1",
                    "tenant_id": "tenant-1",
                    "trainer_id": "trainer-123",
                    "knowledge_entry_id": "entry-1",
                    "version_number": 1,
                    "content": "When sleep is poor, lower volume and focus on movement quality.",
                    "structured_summary": "Lower volume when sleep is poor.",
                    "edited_by": "trainer-user-123",
                    "created_at": "2026-04-11T10:00:00+00:00",
                    "change_reason": "Created knowledge entry",
                }
            ]
        }

    @staticmethod
    def _normalize_scope(scope_value):
        normalized = str(scope_value or "global").strip().lower().replace("-", "_")
        if normalized in {"client", "clientspecific", "client_specific"}:
            return "client"
        return "global"

    def list_documents(self, trainer_id: str):
        del trainer_id
        return [*self.documents]

    def create_document(self, trainer_id: str, document):
        self.last_create = {
            "trainer_id": trainer_id,
            "document": document.model_dump(),
        }
        created = {
            "id": "doc-1",
            "trainer_id": trainer_id,
            "title": document.title,
            "file_url": document.file_url,
            "document_type": document.document_type,
            "raw_text": document.raw_text,
            "metadata": document.metadata,
            "indexing_status": "pending",
            "created_at": "2026-04-11T10:00:00+00:00",
        }
        self.documents = [created, *self.documents]
        return created

    def ingest_document(self, trainer_context, request):
        return {
            "document": {
                "id": "doc-ingest-1",
                "trainer_id": trainer_context.trainer_id,
                "title": request.title,
                "file_url": request.file_url,
                "document_type": request.document_type,
                "raw_text": request.raw_text,
                "metadata": request.metadata,
                "indexing_status": "pending",
                "created_at": "2026-04-11T10:00:00+00:00",
            },
            "extracted_rules": self.rules,
            "extraction": {
                "strategy": "hybrid_llm_normalized",
                "llm_attempted": True,
                "llm_succeeded": True,
                "fallback_reason": None,
                "rules_created": len(self.rules),
            },
        }

    def update_document(self, trainer_context, document_id, request):
        del trainer_context
        target = next((doc for doc in self.documents if doc["id"] == document_id), None)
        if not target:
            raise ValueError("Document not found")

        payload = request.model_dump()
        self.last_update = {
            "document_id": document_id,
            "payload": payload,
        }
        if request.title is not None:
            target["title"] = request.title
        if request.raw_text is not None:
            target["raw_text"] = request.raw_text
        if request.document_type is not None:
            target["document_type"] = request.document_type
        if request.file_url is not None:
            target["file_url"] = request.file_url
        if request.metadata is not None:
            target["metadata"] = request.metadata

        return {
            "document": target,
            "extracted_rules": self.rules,
            "extraction": {
                "strategy": "deterministic",
                "llm_attempted": False,
                "llm_succeeded": False,
                "fallback_reason": None,
                "rules_created": len(self.rules),
            },
        }

    def delete_document(self, trainer_context, document_id):
        del trainer_context
        target = next((doc for doc in self.documents if doc["id"] == document_id), None)
        if not target:
            raise ValueError("Document not found")

        self.last_delete_document_id = document_id
        self.documents = [doc for doc in self.documents if doc["id"] != document_id]
        self.rules = [rule for rule in self.rules if rule.get("document_id") != document_id]
        return target

    def list_rules(self, trainer_id: str, include_archived=False, category=None):
        del trainer_id
        rules = [*self.rules]
        if not include_archived:
            rules = [rule for rule in rules if not rule.get("is_archived")]
        if category:
            rules = [rule for rule in rules if rule.get("category") == category]
        return rules

    def update_rule(self, trainer_context, rule_id, request):
        del trainer_context
        for rule in self.rules:
            if rule["id"] != rule_id:
                continue
            if request.category is not None:
                rule["category"] = request.category
            if request.rule_text is not None:
                rule["rule_text"] = request.rule_text
            rule["current_version"] = int(rule.get("current_version") or 1) + 1
            return rule
        raise ValueError("Rule not found")

    def archive_rule(self, trainer_context, rule_id):
        del trainer_context
        for rule in self.rules:
            if rule["id"] == rule_id:
                rule["is_archived"] = True
                rule["current_version"] = int(rule.get("current_version") or 1) + 1
                return rule
        raise ValueError("Rule not found")

    def list_entries(
        self,
        trainer_context,
        include_archived=False,
        scope=None,
        ai_enabled=None,
        client_id=None,
        query=None,
        limit=120,
        offset=0,
    ):
        del trainer_context, limit, offset
        rows = [*self.entries]
        if not include_archived:
            rows = [entry for entry in rows if entry.get("status") != "archived"]
        if scope:
            rows = [entry for entry in rows if entry.get("scope") == scope]
        if isinstance(ai_enabled, bool):
            rows = [entry for entry in rows if bool(entry.get("ai_enabled")) == ai_enabled]
        if client_id:
            rows = [
                entry
                for entry in rows
                if entry.get("scope") == "global" or entry.get("client_id") == client_id
            ]
        if query:
            q = str(query).strip().lower()
            rows = [
                entry for entry in rows
                if q in str(entry.get("title") or "").lower()
                or q in str(entry.get("raw_content") or "").lower()
                or q in " ".join(entry.get("tags") or []).lower()
            ]
        return rows

    def classify_entry(self, trainer_context, request):
        del trainer_context
        return {
            "title": request.title or "Suggested title",
            "structured_summary": "Suggested summary",
            "knowledge_type": request.preferred_knowledge_type or "rule",
            "type": request.preferred_knowledge_type or "rule",
            "scope": request.preferred_scope or "global",
            "tags": ["sleep", "recovery"],
            "ai_usable": True,
            "ai_enabled": True,
            "confidence": 0.91,
            "client_id": request.client_id,
            "rationale": "Heuristic suggestion",
        }

    def create_entry(self, trainer_context, request):
        normalized_scope = self._normalize_scope(request.scope)
        entry = {
            "id": f"entry-{len(self.entries) + 1}",
            "tenant_id": trainer_context.tenant_id,
            "trainer_id": trainer_context.trainer_id,
            "client_id": request.client_id,
            "title": request.title or "Created entry",
            "body": request.body or request.raw_content,
            "raw_content": request.body or request.raw_content,
            "structured_summary": request.structured_summary,
            "type": request.type or request.knowledge_type or "note",
            "knowledge_type": request.type or request.knowledge_type or "note",
            "scope": normalized_scope,
            "tags": request.tags,
            "ai_usable": request.ai_usable if request.ai_usable is not None else request.ai_enabled,
            "ai_enabled": request.ai_usable if request.ai_usable is not None else request.ai_enabled,
            "status": "active",
            "source": request.source,
            "source_message_id": request.source_message_id,
            "confidence_score": request.confidence_score,
            "embedding_status": "pending",
            "last_embedded_at": None,
            "version_count": 1,
            "last_used_at": None,
            "usage_count": 0,
            "conflict_group_id": None,
            "metadata": request.metadata,
            "created_at": "2026-04-11T10:00:00+00:00",
            "updated_at": "2026-04-11T10:00:00+00:00",
            "archived_at": None,
        }
        self.entries = [entry, *self.entries]
        self.entry_versions.setdefault(entry["id"], []).append(
            {
                "id": f"version-{len(self.entry_versions) + 1}",
                "tenant_id": trainer_context.tenant_id,
                "trainer_id": trainer_context.trainer_id,
                "knowledge_entry_id": entry["id"],
                "version_number": 1,
                "content": entry["raw_content"],
                "structured_summary": entry.get("structured_summary"),
                "edited_by": trainer_context.trainer_user_id,
                "created_at": "2026-04-11T10:00:00+00:00",
                "change_reason": request.change_reason,
            }
        )
        return {
            "entry": entry,
            "safety": {"ai_enabled_forced_off": False, "issues": [], "message": None, "severity": None},
            "conflicts": [],
            "warnings": [],
        }

    def update_entry(self, trainer_context, entry_id, request):
        del trainer_context
        for entry in self.entries:
            if entry["id"] != entry_id:
                continue
            if request.title is not None:
                entry["title"] = request.title
            if request.body is not None:
                entry["body"] = request.body
                entry["raw_content"] = request.body
            if request.raw_content is not None:
                entry["raw_content"] = request.raw_content
                entry["body"] = request.raw_content
            if request.type is not None:
                entry["type"] = request.type
                entry["knowledge_type"] = request.type
            if request.knowledge_type is not None:
                entry["knowledge_type"] = request.knowledge_type
            if request.scope is not None:
                entry["scope"] = self._normalize_scope(request.scope)
            if request.tags is not None:
                entry["tags"] = request.tags
            if request.ai_usable is not None:
                entry["ai_usable"] = request.ai_usable
                entry["ai_enabled"] = request.ai_usable
            if request.ai_enabled is not None:
                entry["ai_enabled"] = request.ai_enabled
                entry["ai_usable"] = request.ai_enabled
            if request.ai_enabled is True and request.raw_content is not None:
                entry["embedding_status"] = "pending"
                entry["last_embedded_at"] = None
            if request.source_message_id is not None:
                entry["source_message_id"] = request.source_message_id
            if request.status is not None:
                entry["status"] = request.status
            entry["version_count"] = int(entry.get("version_count") or 1) + 1
            entry["updated_at"] = "2026-04-12T10:00:00+00:00"
            if entry["status"] == "archived":
                entry["archived_at"] = "2026-04-12T10:00:00+00:00"
            return {
                "entry": entry,
                "safety": {"ai_enabled_forced_off": False, "issues": [], "message": None, "severity": None},
                "conflicts": [],
                "warnings": [],
            }
        raise ValueError("Entry not found")

    def archive_entry(self, trainer_context, entry_id):
        for entry in self.entries:
            if entry["id"] == entry_id:
                entry["status"] = "archived"
                entry["ai_enabled"] = False
                entry["version_count"] = int(entry.get("version_count") or 1) + 1
                entry["updated_at"] = "2026-04-12T10:00:00+00:00"
                entry["archived_at"] = "2026-04-12T10:00:00+00:00"
                return {
                    "entry": entry,
                    "safety": {"ai_enabled_forced_off": False, "issues": [], "message": None, "severity": None},
                    "conflicts": [],
                    "warnings": [],
                }
        raise ValueError("Entry not found")

    def refine_entry(self, trainer_context, entry_id, request):
        suffix = f"{request.action}: {request.content}" if request.content else request.action
        for entry in self.entries:
            if entry["id"] == entry_id:
                entry["raw_content"] = f"{entry['raw_content']}\n\n{suffix}".strip()
                entry["version_count"] = int(entry.get("version_count") or 1) + 1
                entry["updated_at"] = "2026-04-12T10:00:00+00:00"
                return {
                    "entry": entry,
                    "safety": {"ai_enabled_forced_off": False, "issues": [], "message": None, "severity": None},
                    "conflicts": [],
                    "warnings": [],
                }
        raise ValueError("Entry not found")

    def list_entry_versions(self, trainer_context, entry_id, limit=50):
        del trainer_context
        rows = self.entry_versions.get(entry_id, [])
        return rows[:limit]


class TrainerKnowledgeApiTests(unittest.TestCase):
    def setUp(self):
        self.fake_service = FakeTrainerKnowledgeService()
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="trainer-user-123",
            email="trainer@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
        )
        app.dependency_overrides[get_trainer_knowledge_service] = lambda: self.fake_service
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_create_document_uses_trainer_context_and_accepts_payload_without_trainer_id(self):
        response = self.client.post(
            "/api/v1/trainer-knowledge",
            json={
                "title": "Programming Rules",
                "raw_text": "Always prioritize movement quality before volume.",
                "document_type": "text",
                "metadata": {"source": "trainer_home"},
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["trainer_id"], "trainer-123")
        self.assertEqual(payload["title"], "Programming Rules")
        self.assertEqual(self.fake_service.last_create["trainer_id"], "trainer-123")
        self.assertNotIn("trainer_id", self.fake_service.last_create["document"])
        self.assertEqual(
            self.fake_service.last_create["document"]["raw_text"],
            "Always prioritize movement quality before volume.",
        )

    def test_create_document_rejects_non_https_file_url(self):
        response = self.client.post(
            "/api/v1/trainer-knowledge",
            json={
                "title": "Programming Rules",
                "raw_text": "Always prioritize movement quality before volume.",
                "file_url": "javascript:alert(1)",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("file_url", response.text)

    def test_list_documents_returns_created_at(self):
        response = self.client.get(
            "/api/v1/trainer-knowledge",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreaterEqual(len(payload), 1)
        self.assertEqual(payload[0]["id"], "doc-1")
        created_at = payload[0].get("created_at")
        self.assertIsInstance(created_at, str)
        self.assertIsNotNone(datetime.fromisoformat(created_at.replace("Z", "+00:00")))

    def test_ingest_document_returns_document_and_extracted_rules(self):
        response = self.client.post(
            "/api/v1/trainer-knowledge/ingest",
            json={
                "title": "Methodology",
                "raw_text": "Use movement quality first and progress load when execution is stable.",
                "document_type": "text",
                "metadata": {"source": "agent_lab"},
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["document"]["title"], "Methodology")
        self.assertEqual(payload["extraction"]["strategy"], "hybrid_llm_normalized")
        self.assertEqual(len(payload["extracted_rules"]), 1)

    def test_rule_endpoints_support_list_update_and_archive(self):
        list_response = self.client.get(
            "/api/v1/trainer-knowledge/rules",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.json()), 1)

        patch_response = self.client.patch(
            "/api/v1/trainer-knowledge/rules/rule-1",
            json={"rule_text": "Always coach quality first."},
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.json()["rule_text"], "Always coach quality first.")

        archive_response = self.client.delete(
            "/api/v1/trainer-knowledge/rules/rule-1",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(archive_response.status_code, 200)
        self.assertTrue(archive_response.json()["is_archived"])

    def test_entry_endpoints_support_list_classify_and_create(self):
        list_response = self.client.get(
            "/api/v1/trainer-knowledge/entries",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(list_response.status_code, 200)
        self.assertGreaterEqual(len(list_response.json()), 1)

        classify_response = self.client.post(
            "/api/v1/trainer-knowledge/entries/classify",
            json={
                "raw_content": "When sleep is poor, reduce intensity.",
                "preferred_scope": "global",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(classify_response.status_code, 200)
        self.assertEqual(classify_response.json()["knowledge_type"], "rule")

        create_response = self.client.post(
            "/api/v1/trainer-knowledge/entries",
            json={
                "title": "Sleep adjustment",
                "raw_content": "When sleep is poor, reduce intensity.",
                "type": "rule",
                "scope": "global",
                "tags": ["sleep"],
                "ai_usable": True,
                "source": "manual",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(create_response.status_code, 200)
        create_payload = create_response.json()
        self.assertEqual(create_payload["entry"]["title"], "Sleep adjustment")
        self.assertEqual(create_payload["entry"]["scope"], "global")

    def test_entry_endpoints_support_update_archive_refine_and_versions(self):
        update_response = self.client.patch(
            "/api/v1/trainer-knowledge/entries/entry-1",
            json={
                "title": "Updated title",
                "raw_content": "Updated content",
                "type": "rule",
                "scope": "global",
                "tags": ["sleep", "quality"],
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()["entry"]["title"], "Updated title")

        refine_response = self.client.post(
            "/api/v1/trainer-knowledge/entries/entry-1/refine",
            json={
                "action": "add_exception",
                "content": "If readiness is high before competition, keep primary intensity.",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(refine_response.status_code, 200)
        self.assertIn("add_exception", refine_response.json()["entry"]["raw_content"])

        versions_response = self.client.get(
            "/api/v1/trainer-knowledge/entries/entry-1/versions",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(versions_response.status_code, 200)
        self.assertGreaterEqual(len(versions_response.json()), 1)

        archive_response = self.client.delete(
            "/api/v1/trainer-knowledge/entries/entry-1",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(archive_response.status_code, 200)
        self.assertEqual(archive_response.json()["entry"]["status"], "archived")

    def test_entry_create_accepts_client_scope_alias(self):
        create_response = self.client.post(
            "/api/v1/trainer-knowledge/entries",
            json={
                "title": "Client-specific sleep adjustment",
                "raw_content": "For this client, reduce intensity when sleep is poor.",
                "type": "rule",
                "scope": "client",
                "client_id": "client-42",
                "tags": ["sleep"],
                "ai_usable": True,
                "source": "manual",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(create_response.status_code, 200)
        self.assertEqual(create_response.json()["entry"]["scope"], "client")

    def test_patch_document_updates_and_returns_extraction(self):
        response = self.client.patch(
            "/api/v1/trainer-knowledge/doc-1",
            json={
                "title": "Updated Methodology",
                "raw_text": "Always coach quality before load increases.",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["document"]["title"], "Updated Methodology")
        self.assertEqual(payload["extraction"]["rules_created"], 1)
        self.assertEqual(self.fake_service.last_update["document_id"], "doc-1")

    def test_patch_document_rejects_non_https_file_url(self):
        response = self.client.patch(
            "/api/v1/trainer-knowledge/doc-1",
            json={
                "file_url": "ftp://example.com/file.pdf",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("file_url", response.text)

    def test_delete_document_removes_saved_knowledge(self):
        response = self.client.delete(
            "/api/v1/trainer-knowledge/doc-1",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["id"], "doc-1")
        self.assertEqual(self.fake_service.last_delete_document_id, "doc-1")

    def test_delete_document_options_preflight_allows_delete(self):
        response = self.client.options(
            "/api/v1/trainer-knowledge/doc-1",
            headers={
                "Origin": "http://localhost:19006",
                "Access-Control-Request-Method": "DELETE",
            },
        )

        self.assertEqual(response.status_code, 200)
        allow_methods = (response.headers.get("access-control-allow-methods") or "").upper()
        self.assertIn("DELETE", allow_methods)

    def test_trainer_only_access_rejects_non_trainer_actor(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="not-the-trainer",
            email="trainer@example.com",
            access_token="token-123",
        )

        list_response = self.client.get(
            "/api/v1/trainer-knowledge",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(list_response.status_code, 403)
        self.assertEqual(list_response.json()["detail"], "Trainer-only endpoint")

        create_response = self.client.post(
            "/api/v1/trainer-knowledge",
            json={
                "title": "Should fail",
                "raw_text": "This request is from a non-trainer actor.",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(create_response.status_code, 403)
        self.assertEqual(create_response.json()["detail"], "Trainer-only endpoint")

        ingest_response = self.client.post(
            "/api/v1/trainer-knowledge/ingest",
            json={
                "title": "Should fail",
                "raw_text": "This request is from a non-trainer actor.",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(ingest_response.status_code, 403)
        self.assertEqual(ingest_response.json()["detail"], "Trainer-only endpoint")

        patch_response = self.client.patch(
            "/api/v1/trainer-knowledge/doc-1",
            json={
                "title": "Should fail",
                "raw_text": "This request is from a non-trainer actor.",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(patch_response.status_code, 403)
        self.assertEqual(patch_response.json()["detail"], "Trainer-only endpoint")


if __name__ == "__main__":
    unittest.main()
