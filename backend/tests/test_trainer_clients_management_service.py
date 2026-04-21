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
from app.modules.trainer_clients.schemas import (
    TrainerClientInviteCodeCreateRequest,
    TrainerClientUpdateRequest,
)
from app.modules.trainer_clients.service import TrainerClientService


class FakeTrainerClientRepository:
    def __init__(self):
        self.clients = [
            {
                "id": "client-1",
                "tenant_id": "tenant-1",
                "user_id": "client-user-1",
                "client_name": "Taylor",
                "assigned_trainer_id": "trainer-123",
                "created_at": "2026-04-10T10:00:00+00:00",
            },
            {
                "id": "client-2",
                "tenant_id": "tenant-1",
                "user_id": "client-user-2",
                "client_name": "Jordan",
                "assigned_trainer_id": "trainer-123",
                "created_at": "2026-04-09T10:00:00+00:00",
            },
        ]
        self.assignments = [
            {
                "id": "assign-old",
                "client_id": "client-1",
                "trainer_id": "trainer-123",
                "assigned_at": "2026-04-01T10:00:00+00:00",
                "unassigned_at": "2026-04-02T10:00:00+00:00",
            },
            {
                "id": "assign-active",
                "client_id": "client-1",
                "trainer_id": "trainer-123",
                "assigned_at": "2026-04-05T10:00:00+00:00",
                "unassigned_at": None,
            },
        ]
        self.invite_codes = [
            {
                "id": "invite-1",
                "code": "MODE1234",
                "trainer_id": "trainer-123",
                "tenant_id": "tenant-1",
                "is_active": True,
                "expires_at": None,
                "metadata": {"source": "seed"},
                "created_at": "2026-04-11T09:00:00+00:00",
                "updated_at": "2026-04-11T09:00:00+00:00",
            }
        ]

    def list_clients_for_trainer(self, trainer_id: str):
        return [row for row in self.clients if row.get("assigned_trainer_id") == trainer_id]

    def get_client_for_trainer(self, trainer_id: str, client_id: str):
        for row in self.clients:
            if row["id"] == client_id and row.get("assigned_trainer_id") == trainer_id:
                return dict(row)
        return None

    def update_client_for_trainer(self, trainer_id: str, client_id: str, fields: dict):
        for row in self.clients:
            if row["id"] == client_id and row.get("assigned_trainer_id") == trainer_id:
                row.update(fields)
                return dict(row)
        return None

    def get_latest_active_assignment(self, trainer_id: str, client_id: str):
        active = [
            row
            for row in self.assignments
            if row["trainer_id"] == trainer_id
            and row["client_id"] == client_id
            and row.get("unassigned_at") is None
        ]
        if not active:
            return None
        return sorted(active, key=lambda row: row["assigned_at"], reverse=True)[0]

    def mark_assignment_unassigned(self, assignment_id: str, *, unassigned_at: str):
        for row in self.assignments:
            if row["id"] == assignment_id:
                row["unassigned_at"] = unassigned_at
                return dict(row)
        return None

    def list_invite_codes_for_trainer(self, trainer_id: str, tenant_id: str):
        return [
            dict(row)
            for row in self.invite_codes
            if row["trainer_id"] == trainer_id and row["tenant_id"] == tenant_id
        ]

    def get_invite_code_for_trainer(self, trainer_id: str, tenant_id: str, invite_id: str):
        for row in self.invite_codes:
            if row["id"] == invite_id and row["trainer_id"] == trainer_id and row["tenant_id"] == tenant_id:
                return dict(row)
        return None

    def get_invite_code_by_code(self, *, code: str):
        normalized = code.strip().lower()
        for row in self.invite_codes:
            if str(row["code"]).strip().lower() == normalized:
                return dict(row)
        return None

    def create_invite_code(self, payload: dict):
        created = {
            "id": f"invite-{len(self.invite_codes) + 1}",
            "created_at": "2026-04-12T09:00:00+00:00",
            "updated_at": "2026-04-12T09:00:00+00:00",
            **payload,
        }
        self.invite_codes.insert(0, created)
        return dict(created)

    def update_invite_code_for_trainer(self, trainer_id: str, tenant_id: str, invite_id: str, fields: dict):
        for row in self.invite_codes:
            if row["id"] == invite_id and row["trainer_id"] == trainer_id and row["tenant_id"] == tenant_id:
                row.update(fields)
                row["updated_at"] = "2026-04-12T10:00:00+00:00"
                return dict(row)
        return None


class TrainerClientManagementServiceTests(unittest.TestCase):
    def setUp(self):
        self.repository = FakeTrainerClientRepository()
        self.service = TrainerClientService(self.repository)
        self.trainer_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
        )

    def test_update_and_remove_client_preserve_expected_state(self):
        updated = self.service.update_client(
            self.trainer_context,
            "client-1",
            TrainerClientUpdateRequest(client_name="Taylor R."),
        )
        self.assertEqual(updated.client_name, "Taylor R.")
        self.assertTrue(updated.is_assigned_to_trainer)

        removed = self.service.remove_client(self.trainer_context, "client-1")
        self.assertEqual(removed.client_id, "client-1")
        self.assertFalse(removed.is_assigned_to_trainer)
        active_assignment = next(
            row for row in self.repository.assignments if row["id"] == "assign-active"
        )
        self.assertIsNotNone(active_assignment["unassigned_at"])

    def test_invite_code_lifecycle(self):
        created = self.service.create_invite_code(
            self.trainer_context,
            TrainerClientInviteCodeCreateRequest(
                code="fresh42",
                metadata={"source": "system-hub"},
            ),
        )
        self.assertEqual(created.code, "FRESH42")
        self.assertTrue(created.is_active)

        listing = self.service.list_invite_codes(self.trainer_context, limit=10, offset=0)
        self.assertEqual(listing.count, 2)
        self.assertEqual(listing.items[0].code, "FRESH42")

        deactivated = self.service.deactivate_invite_code(self.trainer_context, created.id)
        self.assertFalse(deactivated.is_active)

    def test_duplicate_invite_code_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Invite code already exists"):
            self.service.create_invite_code(
                self.trainer_context,
                TrainerClientInviteCodeCreateRequest(code="mode1234"),
            )

    def test_cross_tenant_context_cannot_mutate_clients(self):
        cross_tenant_context = TrainerContext(
            tenant_id="tenant-2",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
        )

        listing = self.service.list_clients(cross_tenant_context, limit=20, offset=0)
        self.assertEqual(listing.count, 0)
        self.assertEqual(listing.items, [])

        with self.assertRaisesRegex(ValueError, "Client not found for trainer"):
            self.service.update_client(
                cross_tenant_context,
                "client-1",
                TrainerClientUpdateRequest(client_name="Taylor"),
            )

        with self.assertRaisesRegex(ValueError, "Client not found for trainer"):
            self.service.remove_client(cross_tenant_context, "client-1")


if __name__ == "__main__":
    unittest.main()
