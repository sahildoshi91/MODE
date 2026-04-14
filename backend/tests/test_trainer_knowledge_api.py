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
