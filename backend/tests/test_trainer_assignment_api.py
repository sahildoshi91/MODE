import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app


class FakeResponse:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return self


class FakeTableQuery:
    def __init__(self, rows):
        self.rows = rows
        self.filters = {}

    def select(self, _fields):
        return self

    def eq(self, field, value):
        self.filters[field] = value
        return self

    def order(self, _field):
        return self

    def execute(self):
        filtered_rows = [
            row for row in self.rows
            if all(row.get(field) == value for field, value in self.filters.items())
        ]
        return FakeResponse(filtered_rows)


class FakeAdminClient:
    def __init__(self, trainers=None, clients=None):
        self.trainers = trainers or []
        self.clients = clients or []
        self.rpc_calls = []

    def table(self, name):
        if name == "trainers":
            return FakeTableQuery(self.trainers)
        if name == "clients":
            return FakeTableQuery(self.clients)
        raise AssertionError(f"Unexpected table requested: {name}")

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        return FakeResponse([{"ok": True}])


class TrainerAssignmentApiTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="user-123",
            email="user@example.com",
            access_token="token-123",
        )
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_status_lists_available_trainers_for_unassigned_user(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id=None,
            trainer_id=None,
            trainer_user_id=None,
            trainer_display_name=None,
            client_id=None,
        )
        fake_admin_client = FakeAdminClient(
            trainers=[
                {"id": "trainer-1", "tenant_id": "tenant-1", "display_name": "Coach Maya", "is_active": True},
                {"id": "trainer-2", "tenant_id": "tenant-2", "display_name": "Coach Alex", "is_active": True},
            ]
        )

        with patch("app.api.v1.trainer_assignment.get_supabase_client", return_value=fake_admin_client):
            response = self.client.get(
                "/api/v1/trainer-assignment/status",
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["needs_assignment"])
        self.assertEqual(len(response.json()["available_trainers"]), 2)

    def test_assign_trainer_uses_rpc_for_unassigned_user(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-1",
            trainer_id=None,
            trainer_user_id=None,
            trainer_display_name=None,
            client_id="client-123",
        )
        fake_admin_client = FakeAdminClient(
            trainers=[
                {"id": "trainer-1", "tenant_id": "tenant-1", "display_name": "Coach Maya", "is_active": True},
            ],
            clients=[
                {"id": "client-123", "user_id": "user-123", "tenant_id": "tenant-1", "assigned_trainer_id": None},
            ],
        )

        with patch("app.api.v1.trainer_assignment.get_supabase_client", return_value=fake_admin_client):
            response = self.client.post(
                "/api/v1/trainer-assignment/assign",
                json={"trainer_id": "trainer-1"},
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["needs_assignment"])
        self.assertEqual(response.json()["assigned_trainer_id"], "trainer-1")
        self.assertEqual(
            fake_admin_client.rpc_calls,
            [("assign_client_to_trainer", {"client_user_id": "user-123", "trainer_record_id": "trainer-1"})],
        )

    def test_assign_trainer_rejects_cross_tenant_client_record(self):
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-legacy",
            trainer_id=None,
            trainer_user_id=None,
            trainer_display_name=None,
            client_id="client-legacy",
        )
        fake_admin_client = FakeAdminClient(
            trainers=[
                {"id": "trainer-1", "tenant_id": "tenant-1", "display_name": "Coach Maya", "is_active": True},
            ],
            clients=[
                {"id": "client-legacy", "user_id": "user-123", "tenant_id": "tenant-legacy", "assigned_trainer_id": None},
            ],
        )

        with patch("app.api.v1.trainer_assignment.get_supabase_client", return_value=fake_admin_client):
            response = self.client.post(
                "/api/v1/trainer-assignment/assign",
                json={"trainer_id": "trainer-1"},
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"],
            "User is already linked to a different tenant and cannot self-assign to this trainer",
        )


if __name__ == "__main__":
    unittest.main()
