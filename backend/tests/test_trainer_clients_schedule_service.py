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
    TrainerScheduleExceptionCreateRequest,
    TrainerSchedulePreferencesUpdateRequest,
)
from app.modules.trainer_clients.service import TrainerClientService


class FakeTrainerClientRepository:
    def __init__(self):
        self.preference_row = {
            "trainer_id": "trainer-1",
            "client_id": "client-1",
            "recurring_weekdays": [1, 3, 5],
            "preferred_meeting_location": "Client Home",
            "auto_use_trainer_default_location": True,
        }
        self.trainer_settings = {
            "id": "trainer-1",
            "display_name": "Coach Maya",
            "default_meeting_location": "Main Gym",
            "auto_fill_meeting_location": True,
        }
        self.exceptions = {}

    def get_client_for_trainer(self, trainer_id, client_id):
        if trainer_id == "trainer-1" and client_id == "client-1":
            return {
                "id": "client-1",
                "tenant_id": "tenant-1",
                "user_id": "client-user-1",
                "client_name": "Taylor",
            }
        return None

    def get_trainer_settings(self, trainer_id):
        return self.trainer_settings if trainer_id == "trainer-1" else None

    def get_schedule_preferences(self, trainer_id, client_id):
        if trainer_id != "trainer-1" or client_id != "client-1":
            return None
        return self.preference_row

    def list_schedule_exceptions_between(self, trainer_id, start_date, end_date, client_ids=None):
        if trainer_id != "trainer-1":
            return []
        allowed_ids = set(client_ids or [])
        rows = []
        for (exception_client_id, exception_date), payload in self.exceptions.items():
            if allowed_ids and exception_client_id not in allowed_ids:
                continue
            if exception_date < start_date or exception_date > end_date:
                continue
            rows.append(payload)
        rows.sort(key=lambda row: row.get("session_date"))
        return rows

    def get_schedule_exception_for_day(self, trainer_id, client_id, session_date):
        if trainer_id != "trainer-1":
            return None
        return self.exceptions.get((client_id, session_date))

    def upsert_schedule_preferences(self, payload):
        self.preference_row = {
            "trainer_id": payload["trainer_id"],
            "client_id": payload["client_id"],
            "recurring_weekdays": payload["recurring_weekdays"],
            "preferred_meeting_location": payload.get("preferred_meeting_location"),
            "auto_use_trainer_default_location": payload.get("auto_use_trainer_default_location", True),
        }
        return self.preference_row

    def upsert_schedule_exception(self, payload):
        session_date = date.fromisoformat(payload["session_date"])
        normalized = {
            "id": "exception-1",
            "trainer_id": payload["trainer_id"],
            "client_id": payload["client_id"],
            "session_date": payload["session_date"],
            "exception_type": payload["exception_type"],
            "meeting_location_override": payload.get("meeting_location_override"),
        }
        self.exceptions[(payload["client_id"], session_date)] = normalized
        return normalized

    def delete_schedule_exception_for_day(self, trainer_id, client_id, session_date):
        if trainer_id != "trainer-1":
            return None
        return self.exceptions.pop((client_id, session_date), None)


class TrainerClientScheduleServiceTests(unittest.TestCase):
    def setUp(self):
        self.repository = FakeTrainerClientRepository()
        self.service = TrainerClientService(self.repository)
        self.trainer_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id=None,
        )

    def test_resolver_precedence_concrete_schedule_wins(self):
        resolved = self.service._resolve_schedule_for_day(
            target_date=date(2026, 4, 20),
            concrete_schedule={
                "status": "completed",
                "session_type": "strength",
                "session_start_at": "2026-04-20T17:00:00+00:00",
                "session_end_at": "2026-04-20T18:00:00+00:00",
                "meeting_location": "Concrete Gym",
            },
            recurring_weekdays=[1, 3, 5],
            selected_date_exception_type="skip",
            selected_date_exception_location="Override Location",
            preferred_meeting_location="Client Home",
            auto_use_trainer_default_location=True,
            trainer_default_meeting_location="Main Gym",
            trainer_auto_fill_meeting_location=True,
        )
        self.assertTrue(resolved["scheduled"])
        self.assertEqual(resolved["session_status"], "completed")
        self.assertEqual(resolved["meeting_location"], "Concrete Gym")

    def test_resolver_applies_recurring_exceptions_and_location_fallback(self):
        skipped = self.service._resolve_schedule_for_day(
            target_date=date(2026, 4, 20),
            concrete_schedule=None,
            recurring_weekdays=[1],
            selected_date_exception_type="skip",
            selected_date_exception_location=None,
            preferred_meeting_location="Client Home",
            auto_use_trainer_default_location=True,
            trainer_default_meeting_location="Main Gym",
            trainer_auto_fill_meeting_location=True,
        )
        self.assertFalse(skipped["scheduled"])
        self.assertIsNone(skipped["meeting_location"])

        added_with_override = self.service._resolve_schedule_for_day(
            target_date=date(2026, 4, 22),
            concrete_schedule=None,
            recurring_weekdays=[],
            selected_date_exception_type="add",
            selected_date_exception_location="Pop-up Park",
            preferred_meeting_location=None,
            auto_use_trainer_default_location=True,
            trainer_default_meeting_location="Main Gym",
            trainer_auto_fill_meeting_location=True,
        )
        self.assertTrue(added_with_override["scheduled"])
        self.assertEqual(added_with_override["meeting_location"], "Pop-up Park")

        added_with_default = self.service._resolve_schedule_for_day(
            target_date=date(2026, 4, 23),
            concrete_schedule=None,
            recurring_weekdays=[],
            selected_date_exception_type="add",
            selected_date_exception_location=None,
            preferred_meeting_location=None,
            auto_use_trainer_default_location=True,
            trainer_default_meeting_location="Main Gym",
            trainer_auto_fill_meeting_location=True,
        )
        self.assertTrue(added_with_default["scheduled"])
        self.assertEqual(added_with_default["meeting_location"], "Main Gym")

    def test_update_schedule_preferences_validates_weekdays(self):
        with self.assertRaises(ValueError):
            self.service.update_schedule_preferences(
                self.trainer_context,
                "client-1",
                TrainerSchedulePreferencesUpdateRequest(recurring_weekdays=[1, 8]),
            )

    def test_schedule_exception_create_and_delete(self):
        created = self.service.create_schedule_exception(
            self.trainer_context,
            "client-1",
            TrainerScheduleExceptionCreateRequest(
                session_date=date(2026, 4, 21),
                exception_type="add",
                meeting_location_override="Satellite Studio",
            ),
        )
        self.assertEqual(created.exception_type, "add")
        self.assertEqual(created.meeting_location_override, "Satellite Studio")

        deleted = self.service.delete_schedule_exception(
            self.trainer_context,
            "client-1",
            session_date=date(2026, 4, 21),
        )
        self.assertEqual(deleted.exception_type, "add")

        with self.assertRaises(ValueError):
            self.service.delete_schedule_exception(
                self.trainer_context,
                "client-1",
                session_date=date(2026, 4, 21),
            )


if __name__ == "__main__":
    unittest.main()
