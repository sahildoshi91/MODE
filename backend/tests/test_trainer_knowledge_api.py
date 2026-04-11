import os
import sys
import unittest
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
        return []

    def create_document(self, trainer_id: str, document):
        self.last_create = {
            "trainer_id": trainer_id,
            "document": document.model_dump(),
        }
        return {
            "id": "doc-1",
            "trainer_id": trainer_id,
            "title": document.title,
            "file_url": document.file_url,
            "document_type": document.document_type,
            "raw_text": document.raw_text,
            "metadata": document.metadata,
            "indexing_status": "pending",
        }

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

    def test_write_endpoints_reject_non_trainer_actor(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="not-the-trainer",
            email="trainer@example.com",
            access_token="token-123",
        )

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


if __name__ == "__main__":
    unittest.main()
