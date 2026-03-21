import os
import sys
import unittest
from unittest.mock import patch


os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_request_scoped_supabase_client
from app.main import app


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeTableQuery:
    def __init__(self, table_name, state):
        self.table_name = table_name
        self.state = state
        self.operation = None
        self.filters = {}
        self.insert_payload = None

    def select(self, _columns):
        self.operation = "select"
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def limit(self, _limit):
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.insert_payload = payload
        return self

    def execute(self):
        if self.table_name == "profiles" and self.operation == "select":
            user_id = self.filters.get("id")
            if user_id == self.state["user_id"]:
                return FakeResponse(
                    [
                        {
                            "id": user_id,
                            "fitness_level": "intermediate",
                            "equipment": ["dumbbells"],
                            "goals": ["strength"],
                            "injuries": [],
                            "duration": 30,
                            "workout_type": "Full body",
                        }
                    ]
                )
            return FakeResponse([])

        if self.table_name == "workout_plans" and self.operation == "insert":
            self.state["inserted_plan"] = self.insert_payload
            return FakeResponse([{"id": "plan-123"}])

        if self.table_name == "workouts" and self.operation == "insert":
            self.state["inserted_workout"] = self.insert_payload
            return FakeResponse([{"id": "workout-456"}])

        raise AssertionError(f"Unexpected operation {self.operation} on {self.table_name}")


class FakeSupabaseClient:
    def __init__(self, user_id):
        self.state = {
            "user_id": user_id,
            "inserted_plan": None,
            "inserted_workout": None,
        }

    def table(self, table_name):
        return FakeTableQuery(table_name, self.state)


class GenerateWorkoutIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.user_id = "user-123"
        self.fake_client = FakeSupabaseClient(self.user_id)
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id=self.user_id,
            email="user@example.com",
            access_token="jwt-token",
        )
        app.dependency_overrides[get_request_scoped_supabase_client] = lambda: self.fake_client
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_generate_workout_uses_authenticated_user_scope(self):
        fake_workout = {
            "exercises": [
                {
                    "name": "Goblet Squat",
                    "sets": 3,
                    "reps": 10,
                    "rest_seconds": 60,
                    "coaching_cue": "Keep your chest tall.",
                    "muscle_group": "legs",
                }
            ]
        }

        with patch(
            "app.modules.workout.service.generate_workout_with_ai",
            return_value=fake_workout,
        ) as mock_generate:
            response = self.client.post(
                "/workouts/generate",
                json={"duration": 30, "workout_type": "Full body"},
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["plan_id"], "plan-123")
        self.assertEqual(payload["workout"], fake_workout)

        mock_generate.assert_called_once()
        self.assertEqual(mock_generate.call_args.args[-1], self.user_id)

        inserted_plan = self.fake_client.state["inserted_plan"]
        inserted_workout = self.fake_client.state["inserted_workout"]
        self.assertIsNotNone(inserted_plan)
        self.assertIsNotNone(inserted_workout)
        self.assertEqual(inserted_plan["user_id"], self.user_id)
        self.assertEqual(inserted_workout["user_id"], self.user_id)


if __name__ == "__main__":
    unittest.main()
