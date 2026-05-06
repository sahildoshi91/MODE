import os
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.tenancy import TrainerContext
from app.modules.trainer_clients.schemas import (
    TrainerClientConnectionRequestDecisionRequest,
    TrainerClientInviteCodeCreateRequest,
    TrainerRuleSummaryItem,
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
            {
                "id": "client-3",
                "tenant_id": "tenant-1",
                "user_id": "client-user-3",
                "client_name": "Morgan",
                "assigned_trainer_id": "trainer-123",
                "created_at": "2026-04-08T10:00:00+00:00",
            },
            {
                "id": "client-4",
                "tenant_id": "tenant-1",
                "user_id": "client-user-4",
                "client_name": "New Client",
                "assigned_trainer_id": None,
                "created_at": "2026-04-07T10:00:00+00:00",
            },
        ]
        self.profile_status_by_client_id = {
            "client-1": "completed",
            "client-2": "in_progress",
            # client-3 intentionally missing profile to validate default pending behavior.
        }
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
        self.connection_requests = [
            {
                "id": "request-1",
                "client_id": "client-4",
                "trainer_id": "trainer-123",
                "requested_by_user_id": "client-user-4",
                "request_text": "assign me to test.trainer",
                "status": "pending",
                "trainer_response_note": None,
                "metadata": {"source": "atlas_client_chat"},
                "created_at": "2026-04-12T09:00:00+00:00",
                "updated_at": "2026-04-12T09:00:00+00:00",
                "resolved_at": None,
            },
            {
                "id": "request-2",
                "client_id": "client-4",
                "trainer_id": "trainer-123",
                "requested_by_user_id": "client-user-4",
                "request_text": "connect me to test.trainer",
                "status": "pending",
                "trainer_response_note": None,
                "metadata": {"source": "atlas_client_chat"},
                "created_at": "2026-04-12T09:05:00+00:00",
                "updated_at": "2026-04-12T09:05:00+00:00",
                "resolved_at": None,
            },
        ]
        self.checkins = [
            {
                "client_id": "client-1",
                "date": "2026-04-11",
                "inputs": {"sleep": 2, "stress": 3, "soreness": 4, "nutrition": 4, "motivation": 2},
                "total_score": 15,
                "assigned_mode": "RECOVER",
            },
            {
                "client_id": "client-1",
                "date": "2026-04-09",
                "inputs": {"sleep": 2, "stress": 4, "soreness": 4, "nutrition": 5, "motivation": 2},
                "total_score": 17,
                "assigned_mode": "BUILD",
            },
            {
                "client_id": "client-1",
                "date": "2026-04-07",
                "inputs": {"sleep": 3, "stress": 4, "soreness": 4, "nutrition": 4, "motivation": 1},
                "total_score": 16,
                "assigned_mode": "BUILD",
            },
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

    def get_client_by_id(self, client_id: str):
        for row in self.clients:
            if row["id"] == client_id:
                return dict(row)
        return None

    def update_client_assignment(self, *, client_id: str, tenant_id: str, trainer_id: str):
        for row in self.clients:
            if row["id"] == client_id and row["tenant_id"] == tenant_id:
                row["assigned_trainer_id"] = trainer_id
                return dict(row)
        return None

    def insert_assignment_history(self, *, client_id: str, trainer_id: str):
        row = {
            "id": f"assign-{len(self.assignments) + 1}",
            "client_id": client_id,
            "trainer_id": trainer_id,
            "assigned_at": "2026-04-12T10:00:00+00:00",
            "unassigned_at": None,
        }
        self.assignments.append(row)
        return dict(row)

    def list_connection_requests_for_trainer(self, *, trainer_id: str, status: str | None = "pending"):
        rows = [
            dict(row)
            for row in self.connection_requests
            if row["trainer_id"] == trainer_id
        ]
        if status:
            rows = [row for row in rows if row["status"] == status]
        return rows

    def get_connection_request_for_trainer(self, *, trainer_id: str, request_id: str):
        for row in self.connection_requests:
            if row["id"] == request_id and row["trainer_id"] == trainer_id:
                return dict(row)
        return None

    def update_connection_request(self, *, request_id: str, trainer_id: str, fields: dict):
        for row in self.connection_requests:
            if row["id"] == request_id and row["trainer_id"] == trainer_id:
                row.update(fields)
                row["updated_at"] = "2026-04-12T10:00:00+00:00"
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

    def list_profile_onboarding_status_for_clients(self, client_ids: list[str]):
        return {
            client_id: self.profile_status_by_client_id.get(client_id)
            for client_id in client_ids
            if client_id in self.profile_status_by_client_id
        }

    def get_trainer_settings(self, trainer_id: str):
        del trainer_id
        return {
            "id": "trainer-123",
            "display_name": "Coach Alex",
            "default_meeting_location": "Main Gym",
            "auto_fill_meeting_location": True,
        }

    def get_schedule_preferences(self, trainer_id: str, client_id: str):
        del trainer_id, client_id
        return None

    def get_schedule_exception_for_day(self, trainer_id: str, client_id: str, session_date):
        del trainer_id, client_id, session_date
        return None

    def list_schedule_exceptions_between(self, trainer_id: str, start_date, end_date, client_ids=None):
        del trainer_id, start_date, end_date, client_ids
        return []

    def get_profile(self, client_id: str):
        return {
            "client_id": client_id,
            "primary_goal": "Build strength",
            "onboarding_status": "completed",
        }

    def create_empty_profile(self, client_id: str):
        return {"client_id": client_id}

    def list_checkins_between(self, client_id: str, start_date, end_date):
        return [
            dict(row)
            for row in self.checkins
            if row["client_id"] == client_id
            and start_date.isoformat() <= row["date"] <= end_date.isoformat()
        ]

    def get_latest_checkin(self, client_id: str):
        rows = [dict(row) for row in self.checkins if row["client_id"] == client_id]
        return sorted(rows, key=lambda row: row["date"], reverse=True)[0] if rows else None

    def list_completed_workouts_between(self, user_id: str, start_time, end_time):
        del user_id, start_time, end_time
        return []

    def get_schedule_for_day(self, trainer_id: str, client_id: str, session_date):
        del trainer_id, client_id, session_date
        return None

    def list_memory(self, trainer_id: str, client_id: str, include_archived=False):
        del trainer_id, client_id, include_archived
        return []


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

    def test_context_preview_names_user_why_as_motivation_baseline(self):
        preview = self.service._build_context_preview_text(
            client_name="Taylor",
            profile_snapshot={
                "primary_goal": "strength",
                "user_why": "Dance until I am 100 and never tell my kids I am tired.",
                "onboarding_status": "completed",
            },
            ai_usable=[],
            internal_only_count=2,
            summary_items=[TrainerRuleSummaryItem(category="progression", rule_count=1)],
        )

        self.assertIn("Motivation baseline: Dance until I am 100", preview)
        self.assertIn("primary goal 'strength'", preview)

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

    def test_list_clients_marks_pending_users_from_onboarding_status(self):
        listing = self.service.list_clients(self.trainer_context, limit=10, offset=0)
        self.assertEqual(listing.count, 3)

        by_client_id = {item.client_id: item for item in listing.items}
        self.assertFalse(by_client_id["client-1"].is_pending_user)
        self.assertTrue(by_client_id["client-2"].is_pending_user)
        self.assertTrue(by_client_id["client-3"].is_pending_user)

    def test_connection_request_approval_assigns_client_and_records_history(self):
        listing = self.service.list_connection_requests(self.trainer_context)
        self.assertEqual(listing.count, 2)
        self.assertEqual(listing.items[0].client_name, "New Client")

        approved = self.service.approve_connection_request(
            self.trainer_context,
            "request-1",
            TrainerClientConnectionRequestDecisionRequest(trainer_response_note="Welcome aboard."),
        )

        client = self.repository.get_client_by_id("client-4")
        self.assertEqual(client["assigned_trainer_id"], "trainer-123")
        self.assertEqual(approved.status, "approved")
        self.assertEqual(approved.trainer_response_note, "Welcome aboard.")
        self.assertTrue(any(
            row["client_id"] == "client-4"
            and row["trainer_id"] == "trainer-123"
            and row.get("unassigned_at") is None
            for row in self.repository.assignments
        ))

    def test_connection_request_reject_leaves_client_unassigned(self):
        rejected = self.service.reject_connection_request(
            self.trainer_context,
            "request-2",
            TrainerClientConnectionRequestDecisionRequest(trainer_response_note="Not a fit right now."),
        )

        client = self.repository.get_client_by_id("client-4")
        self.assertIsNone(client["assigned_trainer_id"])
        self.assertEqual(rejected.status, "rejected")
        self.assertEqual(rejected.trainer_response_note, "Not a fit right now.")

    def test_client_detail_includes_question_summaries_with_missing_days(self):
        detail = self.service.get_client_detail(
            self.trainer_context,
            "client-1",
            target_date=date(2026, 4, 11),
        )

        summaries = {item.key: item for item in detail.activity_summary.question_summaries}
        self.assertEqual(len(summaries), 5)
        self.assertEqual(summaries["sleep"].average_7d, 2.33)
        self.assertEqual(summaries["sleep"].responses_7d, 3)
        self.assertEqual(summaries["sleep"].status, "low")
        self.assertEqual(summaries["sleep"].daily_responses[1].score, None)
        self.assertEqual(summaries["motivation"].latest_score, 2)
        self.assertEqual(summaries["motivation"].low_days_7d, 3)

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
