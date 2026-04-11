import os
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.tenancy import TrainerContext
from app.modules.trainer_home.service import TrainerHomeService


class FakeCommandCenterRepository:
    def __init__(self):
        self.cache = {}
        self.upsert_calls = []

    def list_clients_for_trainer(self, trainer_id):
        del trainer_id
        return [
            {"id": "client-1", "tenant_id": "tenant-1", "user_id": "client-user-1", "client_name": "Taylor"},
            {"id": "client-2", "tenant_id": "tenant-1", "user_id": "client-user-2", "client_name": "Jordan"},
        ]

    def list_schedule_for_day(self, trainer_id, session_date):
        del trainer_id, session_date
        return [
            {
                "id": "schedule-1",
                "trainer_id": "trainer-1",
                "client_id": "client-1",
                "session_date": "2026-04-11",
                "session_start_at": "2026-04-11T17:00:00+00:00",
                "session_end_at": "2026-04-11T18:00:00+00:00",
                "session_type": "strength",
                "status": "scheduled",
            }
        ]

    def list_schedule_between(self, trainer_id, start_date, end_date):
        del trainer_id, start_date, end_date
        return [
            {
                "id": "history-1",
                "trainer_id": "trainer-1",
                "client_id": "client-2",
                "session_date": "2026-04-09",
                "session_start_at": "2026-04-09T18:00:00+00:00",
                "session_end_at": "2026-04-09T19:00:00+00:00",
                "session_type": "strength",
                "status": "no_show",
            }
        ]

    def list_checkins_between(self, start_date, end_date):
        del start_date, end_date
        return [
            {"client_id": "client-1", "date": "2026-04-11", "total_score": 18, "assigned_mode": "BUILD"},
            {"client_id": "client-1", "date": "2026-04-10", "total_score": 17, "assigned_mode": "BUILD"},
            {"client_id": "client-2", "date": "2026-04-07", "total_score": 12, "assigned_mode": "RECOVER"},
        ]

    def list_completed_workouts_between(self, start_time, end_time):
        del start_time, end_time
        return [
            {"id": "w-1", "user_id": "client-user-1", "completed": True, "created_at": "2026-04-10T12:00:00+00:00"},
            {"id": "w-2", "user_id": "client-user-1", "completed": True, "created_at": "2026-04-09T12:00:00+00:00"},
        ]

    def list_coach_memory_for_trainer(self, trainer_id):
        del trainer_id
        return [
            {
                "id": "mem-1",
                "trainer_id": "trainer-1",
                "client_id": "client-2",
                "memory_type": "constraint",
                "memory_key": "knee",
                "value_json": {
                    "visibility": "ai_usable",
                    "is_archived": False,
                    "text": "Avoid deep knee flexion when symptoms flare.",
                    "tags": ["knee"],
                },
            }
        ]

    def get_talking_points_cache(self, trainer_id, client_id):
        return self.cache.get((trainer_id, client_id))

    def upsert_talking_points_cache(self, payload):
        self.upsert_calls.append(payload)
        key = (payload["trainer_id"], payload["client_id"])
        self.cache[key] = {
            **payload,
            "generated_at": payload.get("generated_at"),
            "expires_at": payload.get("expires_at"),
        }
        return self.cache[key]


class TrainerHomeCommandCenterServiceTests(unittest.TestCase):
    def test_build_command_center_prioritizes_clients_and_returns_three_talking_points(self):
        repository = FakeCommandCenterRepository()
        service = TrainerHomeService(repository, openai_client=False)
        trainer_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id=None,
        )

        response = service.build_command_center(trainer_context, date(2026, 4, 11))

        self.assertEqual(response.totals.assigned_clients, 2)
        self.assertEqual(response.totals.scheduled_today, 1)
        self.assertEqual(len(response.clients), 2)

        first_client = response.clients[0]
        second_client = response.clients[1]
        self.assertEqual(first_client.client_id, "client-2")
        self.assertEqual(first_client.priority_tier, "critical")
        self.assertEqual(second_client.client_id, "client-1")
        self.assertEqual(second_client.priority_tier, "low")

        self.assertEqual(len(first_client.talking_points.points), 3)
        self.assertEqual(len(second_client.talking_points.points), 3)
        self.assertTrue(
            any("knee" in point.lower() for point in first_client.talking_points.points),
            msg=f"Unexpected talking points: {first_client.talking_points.points}",
        )
        self.assertEqual(len(repository.upsert_calls), 2)

    def test_build_command_center_uses_cache_when_fresh(self):
        repository = FakeCommandCenterRepository()
        repository.cache[("trainer-1", "client-1")] = {
            "trainer_id": "trainer-1",
            "client_id": "client-1",
            "points_json": [
                "Cache point 1",
                "Cache point 2",
                "Cache point 3",
            ],
            "generation_strategy": "llm",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
        }
        repository.cache[("trainer-1", "client-2")] = {
            "trainer_id": "trainer-1",
            "client_id": "client-2",
            "points_json": [
                "Cache point A",
                "Cache point B",
                "Cache point C",
            ],
            "generation_strategy": "deterministic",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
        }
        service = TrainerHomeService(repository, openai_client=False)
        trainer_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id=None,
        )

        response = service.build_command_center(trainer_context, date(2026, 4, 11))

        self.assertEqual(len(repository.upsert_calls), 0)
        for client in response.clients:
            self.assertTrue(client.talking_points.cache_hit)
            self.assertTrue(client.talking_points.generation_strategy.startswith("cache:"))
            self.assertEqual(len(client.talking_points.points), 3)


if __name__ == "__main__":
    unittest.main()
