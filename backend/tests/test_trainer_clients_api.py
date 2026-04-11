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
from app.core.dependencies import get_trainer_client_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app


class FakeTrainerClientService:
    def __init__(self):
        self.memory_rows = [
            {
                "id": "mem-1",
                "trainer_id": "trainer-123",
                "client_id": "client-1",
                "memory_type": "note",
                "memory_key": "session_focus",
                "visibility": "ai_usable",
                "is_archived": False,
                "text": "Prioritize tempo control.",
                "tags": ["tempo"],
                "structured_data": {},
                "value_json": {"visibility": "ai_usable", "is_archived": False, "text": "Prioritize tempo control."},
                "created_at": "2026-04-11T10:00:00+00:00",
                "updated_at": "2026-04-11T10:00:00+00:00",
            }
        ]

    def get_client_detail(self, trainer_context, client_id, target_date=None):
        del trainer_context, target_date
        if client_id != "client-1":
            raise ValueError("Client not found for trainer")
        return {
            "client": {
                "client_id": "client-1",
                "client_name": "Taylor",
                "tenant_id": "tenant-1",
                "user_id": "client-user-1",
            },
            "profile_snapshot": {
                "client_id": "client-1",
                "primary_goal": "Build strength",
                "onboarding_status": "completed",
            },
            "activity_summary": {
                "checkins_completed_7d": 4,
                "workouts_completed_7d": 3,
                "avg_score_7d": 17.5,
                "avg_mode_7d": "BUILD",
                "latest_checkin_date": "2026-04-11",
                "latest_mode": "BUILD",
                "days_since_last_checkin": 0,
                "scheduled_today": True,
                "session_status": "scheduled",
                "session_type": "strength",
                "session_start_at": "2026-04-11T17:00:00+00:00",
                "session_end_at": "2026-04-11T18:00:00+00:00",
            },
            "memory_counts": {
                "total": len(self.memory_rows),
                "ai_usable": 1,
                "internal_only": 0,
                "archived": 0,
            },
        }

    def list_memory(self, trainer_context, client_id, include_archived=False):
        del trainer_context, include_archived
        if client_id != "client-1":
            raise ValueError("Client not found for trainer")
        return self.memory_rows

    def create_memory(self, trainer_context, client_id, request):
        del trainer_context
        if client_id != "client-1":
            raise ValueError("Client not found for trainer")
        created = {
            "id": "mem-2",
            "trainer_id": "trainer-123",
            "client_id": "client-1",
            "memory_type": request.memory_type,
            "memory_key": request.memory_key or "note_1",
            "visibility": request.visibility,
            "is_archived": False,
            "text": request.text,
            "tags": request.tags,
            "structured_data": request.structured_data,
            "value_json": {
                "visibility": request.visibility,
                "is_archived": False,
                "text": request.text,
                "tags": request.tags,
                "structured_data": request.structured_data,
            },
            "created_at": "2026-04-11T11:00:00+00:00",
            "updated_at": "2026-04-11T11:00:00+00:00",
        }
        self.memory_rows = [created, *self.memory_rows]
        return created

    def update_memory(self, trainer_context, client_id, memory_id, request):
        del trainer_context
        if client_id != "client-1":
            raise ValueError("Client not found for trainer")
        for row in self.memory_rows:
            if row["id"] != memory_id:
                continue
            if request.text is not None:
                row["text"] = request.text
                row["value_json"]["text"] = request.text
            if request.visibility is not None:
                row["visibility"] = request.visibility
                row["value_json"]["visibility"] = request.visibility
            if request.is_archived is not None:
                row["is_archived"] = request.is_archived
                row["value_json"]["is_archived"] = request.is_archived
            return row
        raise ValueError("Memory not found")

    def archive_memory(self, trainer_context, client_id, memory_id):
        class FakeRequest:
            text = None
            visibility = None
            is_archived = True

        return self.update_memory(trainer_context, client_id, memory_id, FakeRequest())

    def get_ai_context(self, trainer_context, client_id):
        del trainer_context
        if client_id != "client-1":
            raise ValueError("Client not found for trainer")
        return {
            "client_id": "client-1",
            "applied_ai_usable_memory": [
                {
                    "id": "mem-1",
                    "memory_type": "note",
                    "memory_key": "session_focus",
                    "text": "Prioritize tempo control.",
                    "tags": ["tempo"],
                    "structured_data": {},
                }
            ],
            "internal_only_memory_count": 0,
            "profile_snapshot": {
                "client_id": "client-1",
                "primary_goal": "Build strength",
            },
            "trainer_rule_summary": [
                {
                    "category": "training_philosophy",
                    "rule_count": 3,
                }
            ],
            "context_preview_text": "Preview context text",
        }


class TrainerClientsApiTests(unittest.TestCase):
    def setUp(self):
        self.fake_service = FakeTrainerClientService()
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
        app.dependency_overrides[get_trainer_client_service] = lambda: self.fake_service
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_trainer_client_detail_memory_and_ai_context_flow(self):
        detail_response = self.client.get(
            "/api/v1/trainer-clients/client-1/detail",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(detail_response.json()["client"]["client_name"], "Taylor")

        list_response = self.client.get(
            "/api/v1/trainer-clients/client-1/memory",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.json()), 1)

        create_response = self.client.post(
            "/api/v1/trainer-clients/client-1/memory",
            json={
                "memory_type": "note",
                "text": "Keep warm-ups under 8 minutes.",
                "visibility": "internal_only",
                "tags": ["warmup"],
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(create_response.status_code, 200)
        self.assertEqual(create_response.json()["text"], "Keep warm-ups under 8 minutes.")

        patch_response = self.client.patch(
            "/api/v1/trainer-clients/client-1/memory/mem-1",
            json={"visibility": "internal_only"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.json()["visibility"], "internal_only")

        delete_response = self.client.delete(
            "/api/v1/trainer-clients/client-1/memory/mem-1",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(delete_response.status_code, 200)
        self.assertTrue(delete_response.json()["is_archived"])

        context_response = self.client.get(
            "/api/v1/trainer-clients/client-1/ai-context",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(context_response.status_code, 200)
        self.assertEqual(context_response.json()["client_id"], "client-1")
        self.assertEqual(context_response.json()["context_preview_text"], "Preview context text")

    def test_trainer_endpoints_reject_non_trainer_actor(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="not-the-trainer",
            email="trainer@example.com",
            access_token="token-123",
        )
        response = self.client.get(
            "/api/v1/trainer-clients/client-1/detail",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Trainer-only endpoint")

    def test_memory_not_found_maps_to_404(self):
        response = self.client.patch(
            "/api/v1/trainer-clients/client-1/memory/missing-id",
            json={"text": "Update"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "Memory not found")


if __name__ == "__main__":
    unittest.main()
