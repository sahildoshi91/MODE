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


if __name__ == "__main__":
    unittest.main()
