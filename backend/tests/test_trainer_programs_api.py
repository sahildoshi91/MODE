import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_trainer_context, get_trainer_program_service
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.trainer_programs.schemas import (
    TrainerProgramTemplate,
    TrainerProgramTemplateCreateRequest,
    TrainerProgramTemplateListResponse,
    TrainerProgramTemplatePatchRequest,
)


class FakeTrainerProgramService:
    def __init__(self):
        self.templates = {}
        self.counter = 0

    def list_templates(self, trainer_context, include_archived=False, limit=120):
        del limit
        rows = [
            row for row in self.templates.values()
            if row.trainer_id == trainer_context.trainer_id and (include_archived or not row.is_archived)
        ]
        return TrainerProgramTemplateListResponse(
            count=len(rows),
            items=rows,
        )

    def create_template(self, trainer_context, request: TrainerProgramTemplateCreateRequest):
        self.counter += 1
        now = datetime.now(timezone.utc)
        template = TrainerProgramTemplate(
            id=f"tmpl-{self.counter}",
            trainer_id=trainer_context.trainer_id,
            name=request.name,
            goal_type=request.goal_type,
            experience_level=request.experience_level,
            equipment_access=request.equipment_access,
            frequency=request.frequency,
            template_json=request.template_json,
            metadata=request.metadata,
            is_archived=False,
            created_at=now,
            updated_at=now,
        )
        self.templates[template.id] = template
        return template

    def update_template(self, trainer_context, template_id, request: TrainerProgramTemplatePatchRequest):
        template = self.templates.get(template_id)
        if not template or template.trainer_id != trainer_context.trainer_id:
            raise ValueError("Program template not found")
        update_fields = request.model_dump(exclude_unset=True)
        merged = template.model_dump()
        merged.update(update_fields)
        merged["updated_at"] = datetime.now(timezone.utc)
        updated = TrainerProgramTemplate(**merged)
        self.templates[template_id] = updated
        return updated

    def archive_template(self, trainer_context, template_id):
        template = self.templates.get(template_id)
        if not template or template.trainer_id != trainer_context.trainer_id:
            raise ValueError("Program template not found")
        archived = template.model_copy(update={"is_archived": True, "updated_at": datetime.now(timezone.utc)})
        self.templates[template_id] = archived
        return archived


class TrainerProgramsApiTests(unittest.TestCase):
    def setUp(self):
        self.service = FakeTrainerProgramService()
        self.trainer_1_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach One",
            client_id=None,
        )
        self.trainer_2_context = TrainerContext(
            tenant_id="tenant-2",
            trainer_id="trainer-2",
            trainer_user_id="trainer-user-2",
            trainer_display_name="Coach Two",
            client_id=None,
        )
        self.active_context = self.trainer_1_context
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="trainer-user-1",
            email="trainer1@example.com",
            access_token="token-1",
        )
        app.dependency_overrides[get_trainer_context] = lambda: self.active_context
        app.dependency_overrides[get_trainer_program_service] = lambda: self.service
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_create_list_patch_and_archive_template(self):
        create_response = self.client.post(
            "/api/v1/trainer-programs/templates",
            json={
                "name": "Strength Base",
                "frequency": 3,
                "template_json": {"blocks": []},
                "metadata": {"source": "test"},
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(create_response.status_code, 200, create_response.text)
        template_id = create_response.json()["id"]

        list_response = self.client.get(
            "/api/v1/trainer-programs/templates?limit=120",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(list_response.status_code, 200, list_response.text)
        self.assertEqual(list_response.json()["count"], 1)

        patch_response = self.client.patch(
            f"/api/v1/trainer-programs/templates/{template_id}",
            json={"name": "Strength Base Updated", "frequency": 4},
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(patch_response.status_code, 200, patch_response.text)
        self.assertEqual(patch_response.json()["frequency"], 4)

        archive_response = self.client.post(
            f"/api/v1/trainer-programs/templates/{template_id}/archive",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(archive_response.status_code, 200, archive_response.text)
        self.assertTrue(archive_response.json()["is_archived"])

    def test_cross_trainer_patch_maps_to_404(self):
        create_response = self.client.post(
            "/api/v1/trainer-programs/templates",
            json={"name": "Owner Template"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(create_response.status_code, 200, create_response.text)
        template_id = create_response.json()["id"]

        self.active_context = self.trainer_2_context
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="trainer-user-2",
            email="trainer2@example.com",
            access_token="token-2",
        )
        patch_response = self.client.patch(
            f"/api/v1/trainer-programs/templates/{template_id}",
            json={"name": "Cross tenant update"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(patch_response.status_code, 404, patch_response.text)

    def test_trainer_only_enforcement_blocks_client_actor(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="client-user-1",
            email="client@example.com",
            access_token="token-client",
        )
        response = self.client.get(
            "/api/v1/trainer-programs/templates",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 403, response.text)


if __name__ == "__main__":
    unittest.main()
