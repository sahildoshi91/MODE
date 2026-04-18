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
        self.meeting_locations = {
            ("client-1", "2026-04-11"): "Downtown Performance Lab",
        }
        self.schedule_preferences_by_client = {
            "client-1": {
                "recurring_weekdays": [1, 3, 5],
                "preferred_meeting_location": None,
                "auto_use_trainer_default_location": True,
                "trainer_default_meeting_location": "My Gym",
                "trainer_auto_fill_meeting_location": True,
            }
        }
        self.schedule_exceptions_by_key = {}
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
                "meeting_location": self.meeting_locations.get(("client-1", "2026-04-11")),
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

    def update_meeting_location(self, trainer_context, client_id, request):
        del trainer_context
        if client_id != "client-1":
            raise ValueError("Client not found for trainer")
        session_date = request.session_date.isoformat()
        if session_date != "2026-04-11":
            raise ValueError("No scheduled session found for client on requested date")
        self.meeting_locations[(client_id, session_date)] = request.meeting_location
        return {
            "schedule_id": "schedule-1",
            "client_id": client_id,
            "session_date": session_date,
            "meeting_location": request.meeting_location,
        }

    def _ensure_client(self, client_id):
        if client_id != "client-1":
            raise ValueError("Client not found for trainer")

    def _normalize_weekdays(self, values):
        if values is None:
            return []
        if not isinstance(values, list):
            raise ValueError("Recurring weekdays must be a list")
        normalized = []
        for item in values:
            day = int(item)
            if day < 1 or day > 7:
                raise ValueError("Recurring weekdays must contain integers 1 through 7")
            if day not in normalized:
                normalized.append(day)
        return sorted(normalized)

    def _build_schedule_preferences(self, client_id, selected_date=None):
        base = self.schedule_preferences_by_client.get(client_id) or {
            "recurring_weekdays": [],
            "preferred_meeting_location": None,
            "auto_use_trainer_default_location": True,
            "trainer_default_meeting_location": "My Gym",
            "trainer_auto_fill_meeting_location": True,
        }
        selected_key = (client_id, selected_date.isoformat()) if selected_date else None
        selected_exception = self.schedule_exceptions_by_key.get(selected_key) if selected_key else None
        upcoming_exceptions = sorted(
            [
                exception
                for (exception_client_id, _session_date), exception in self.schedule_exceptions_by_key.items()
                if exception_client_id == client_id
            ],
            key=lambda row: row["session_date"],
        )
        return {
            "trainer_id": "trainer-123",
            "client_id": client_id,
            "recurring_weekdays": list(base["recurring_weekdays"]),
            "preferred_meeting_location": base["preferred_meeting_location"],
            "auto_use_trainer_default_location": bool(base["auto_use_trainer_default_location"]),
            "trainer_default_meeting_location": base["trainer_default_meeting_location"],
            "trainer_auto_fill_meeting_location": bool(base["trainer_auto_fill_meeting_location"]),
            "selected_date": selected_date.isoformat() if selected_date else None,
            "selected_date_exception_type": (selected_exception or {}).get("exception_type"),
            "selected_date_meeting_location_override": (selected_exception or {}).get("meeting_location_override"),
            "upcoming_exceptions": upcoming_exceptions,
        }

    def get_schedule_preferences(self, trainer_context, client_id, selected_date=None):
        del trainer_context
        self._ensure_client(client_id)
        return self._build_schedule_preferences(client_id, selected_date=selected_date)

    def update_schedule_preferences(self, trainer_context, client_id, request):
        del trainer_context
        self._ensure_client(client_id)
        base = self.schedule_preferences_by_client.get(client_id) or {
            "recurring_weekdays": [],
            "preferred_meeting_location": None,
            "auto_use_trainer_default_location": True,
            "trainer_default_meeting_location": "My Gym",
            "trainer_auto_fill_meeting_location": True,
        }
        provided_fields = set(getattr(request, "model_fields_set", set()))
        if "recurring_weekdays" in provided_fields:
            base["recurring_weekdays"] = self._normalize_weekdays(request.recurring_weekdays)
        if "preferred_meeting_location" in provided_fields:
            preferred = request.preferred_meeting_location
            base["preferred_meeting_location"] = preferred.strip() if isinstance(preferred, str) and preferred.strip() else None
        if "auto_use_trainer_default_location" in provided_fields:
            base["auto_use_trainer_default_location"] = bool(request.auto_use_trainer_default_location)
        self.schedule_preferences_by_client[client_id] = base
        return self._build_schedule_preferences(client_id, selected_date=None)

    def create_schedule_exception(self, trainer_context, client_id, request):
        del trainer_context
        self._ensure_client(client_id)
        session_date = request.session_date.isoformat()
        key = (client_id, session_date)
        record = {
            "id": self.schedule_exceptions_by_key.get(key, {}).get("id", f"ex-{len(self.schedule_exceptions_by_key) + 1}"),
            "trainer_id": "trainer-123",
            "client_id": client_id,
            "session_date": session_date,
            "exception_type": request.exception_type,
            "meeting_location_override": request.meeting_location_override,
        }
        self.schedule_exceptions_by_key[key] = record
        return record

    def delete_schedule_exception(self, trainer_context, client_id, session_date):
        del trainer_context
        self._ensure_client(client_id)
        key = (client_id, session_date.isoformat())
        record = self.schedule_exceptions_by_key.get(key)
        if not record:
            raise ValueError("Schedule exception not found")
        del self.schedule_exceptions_by_key[key]
        return record


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
        self.assertEqual(
            detail_response.json()["activity_summary"]["meeting_location"],
            "Downtown Performance Lab",
        )

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

        location_response = self.client.patch(
            "/api/v1/trainer-clients/client-1/meeting-location",
            json={
                "session_date": "2026-04-11",
                "meeting_location": "Midtown Strength Studio",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(location_response.status_code, 200)
        self.assertEqual(location_response.json()["meeting_location"], "Midtown Strength Studio")

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

    def test_meeting_location_requires_existing_scheduled_session(self):
        response = self.client.patch(
            "/api/v1/trainer-clients/client-1/meeting-location",
            json={
                "session_date": "2026-04-12",
                "meeting_location": "No session gym",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "No scheduled session found for client on requested date")

    def test_schedule_preferences_and_exceptions_crud_flow(self):
        get_response = self.client.get(
            "/api/v1/trainer-clients/client-1/schedule-preferences?date=2026-04-11",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.json()["recurring_weekdays"], [1, 3, 5])
        self.assertIsNone(get_response.json()["selected_date_exception_type"])

        patch_response = self.client.patch(
            "/api/v1/trainer-clients/client-1/schedule-preferences",
            json={
                "recurring_weekdays": [2, 4],
                "preferred_meeting_location": "Client Home",
                "auto_use_trainer_default_location": False,
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.json()["recurring_weekdays"], [2, 4])
        self.assertEqual(patch_response.json()["preferred_meeting_location"], "Client Home")
        self.assertFalse(patch_response.json()["auto_use_trainer_default_location"])

        post_response = self.client.post(
            "/api/v1/trainer-clients/client-1/schedule-exceptions",
            json={
                "session_date": "2026-04-12",
                "exception_type": "add",
                "meeting_location_override": "Downtown Studio",
            },
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(post_response.status_code, 200)
        self.assertEqual(post_response.json()["exception_type"], "add")
        self.assertEqual(post_response.json()["meeting_location_override"], "Downtown Studio")

        selected_response = self.client.get(
            "/api/v1/trainer-clients/client-1/schedule-preferences?date=2026-04-12",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(selected_response.status_code, 200)
        self.assertEqual(selected_response.json()["selected_date_exception_type"], "add")
        self.assertEqual(selected_response.json()["selected_date_meeting_location_override"], "Downtown Studio")
        self.assertEqual(len(selected_response.json()["upcoming_exceptions"]), 1)

        delete_response = self.client.delete(
            "/api/v1/trainer-clients/client-1/schedule-exceptions/2026-04-12",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(delete_response.json()["exception_type"], "add")

        after_delete_response = self.client.get(
            "/api/v1/trainer-clients/client-1/schedule-preferences?date=2026-04-12",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(after_delete_response.status_code, 200)
        self.assertIsNone(after_delete_response.json()["selected_date_exception_type"])
        self.assertEqual(after_delete_response.json()["upcoming_exceptions"], [])

    def test_schedule_exception_delete_not_found_maps_to_404(self):
        response = self.client.delete(
            "/api/v1/trainer-clients/client-1/schedule-exceptions/2026-04-16",
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "Schedule exception not found")

    def test_schedule_writes_reject_non_trainer_actor(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="not-the-trainer",
            email="trainer@example.com",
            access_token="token-123",
        )
        response = self.client.patch(
            "/api/v1/trainer-clients/client-1/schedule-preferences",
            json={"recurring_weekdays": [1, 2]},
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Trainer-only endpoint")


if __name__ == "__main__":
    unittest.main()
