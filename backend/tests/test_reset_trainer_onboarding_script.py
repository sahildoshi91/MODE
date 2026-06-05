import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from scripts.reset_trainer_onboarding import reset_trainer_onboarding


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeTableQuery:
    def __init__(self, admin, table_name):
        self.admin = admin
        self.table_name = table_name
        self.filters = {}
        self.limit_value = None
        self.operation = "select"
        self.payload = None
        self.on_conflict = None

    def select(self, _fields):
        self.operation = "select"
        return self

    def eq(self, field, value):
        self.filters[field] = value
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def upsert(self, payload, on_conflict=None):
        self.operation = "upsert"
        self.payload = payload
        self.on_conflict = on_conflict
        return self

    def execute(self):
        self.admin.operations.append(
            {
                "table": self.table_name,
                "operation": self.operation,
                "filters": dict(self.filters),
                "payload": self.payload,
            }
        )
        if self.operation == "select":
            rows = [
                dict(row)
                for row in self.admin.tables.get(self.table_name, [])
                if all(row.get(field) == value for field, value in self.filters.items())
            ]
            if self.limit_value is not None:
                rows = rows[: self.limit_value]
            return FakeResponse(rows)

        if self.operation == "insert":
            row = dict(self.payload)
            row.setdefault("id", f"{self.table_name}-{len(self.admin.tables.get(self.table_name, [])) + 1}")
            self.admin.tables.setdefault(self.table_name, []).append(row)
            return FakeResponse([dict(row)])

        if self.operation == "update":
            updated = []
            for row in self.admin.tables.get(self.table_name, []):
                if all(row.get(field) == value for field, value in self.filters.items()):
                    row.update(self.payload)
                    updated.append(dict(row))
            return FakeResponse(updated)

        if self.operation == "upsert":
            conflict_field = self.on_conflict or "id"
            conflict_value = self.payload.get(conflict_field)
            for row in self.admin.tables.get(self.table_name, []):
                if row.get(conflict_field) == conflict_value:
                    row.update(self.payload)
                    return FakeResponse([dict(row)])
            row = dict(self.payload)
            row.setdefault("id", f"{self.table_name}-{len(self.admin.tables.get(self.table_name, [])) + 1}")
            self.admin.tables.setdefault(self.table_name, []).append(row)
            return FakeResponse([dict(row)])

        raise AssertionError(f"Unsupported operation: {self.operation}")


class FakeAuthAdmin:
    def __init__(self, users):
        self._users = users

    def list_users(self):
        return self._users


class FakeAdmin:
    def __init__(self, *, include_user=True, include_trainer=True):
        self.operations = []
        self.auth = SimpleNamespace(
            admin=FakeAuthAdmin(
                [
                    SimpleNamespace(id="user-trainer", email="test.trainer@mode.local")
                ]
                if include_user
                else []
            )
        )
        self.tables = {
            "user_accounts": [
                {
                    "id": "account-1",
                    "auth_user_id": "user-trainer",
                    "email": "old@example.com",
                }
            ],
            "user_roles": [
                {
                    "id": "role-1",
                    "user_account_id": "account-1",
                    "role": "trainer",
                    "is_active": True,
                }
            ],
            "onboarding_states": [
                {
                    "id": "state-1",
                    "user_account_id": "account-1",
                    "flow_key": "trainer_stub_v1",
                    "status": "completed",
                    "current_step": "done",
                    "payload": {"done": True},
                    "completed_at": "2026-01-01T00:00:00+00:00",
                }
            ],
            "trainers": [
                {
                    "id": "trainer-1",
                    "tenant_id": "tenant-1",
                    "user_id": "user-trainer",
                    "display_name": "Test Trainer",
                    "is_active": True,
                    "is_legacy": True,
                }
            ]
            if include_trainer
            else [],
            "trainer_onboarding_profiles": [
                {
                    "id": "profile-1",
                    "tenant_id": "tenant-1",
                    "trainer_id": "trainer-1",
                    "onboarding_status": "completed",
                    "onboarding_progress": {
                        "completed_steps": 8,
                        "total_steps": 8,
                        "current_step": "complete",
                    },
                    "last_completed_step": "final_calibration",
                    "retrain_draft": {"onboarding_status": "in_progress"},
                    "identity": {"agent_name": "Old Coach"},
                }
            ],
            "trainer_personas": [
                {
                    "id": "persona-1",
                    "trainer_id": "trainer-1",
                    "onboarding_preferences": {
                        "trainer_onboarding_completed": True,
                        "trainer_onboarding_answers": {"x": "y"},
                        "other": "keep",
                    },
                }
            ],
        }

    def table(self, table_name):
        return FakeTableQuery(self, table_name)


class FakeCache:
    def __init__(self):
        self.deleted = []

    def delete(self, *keys):
        self.deleted.extend(keys)


class ResetTrainerOnboardingScriptTests(unittest.TestCase):
    def test_dry_run_performs_no_writes(self):
        admin = FakeAdmin()
        cache = FakeCache()

        result = reset_trainer_onboarding(
            email="test.trainer@mode.local",
            dry_run=True,
            admin=admin,
            cache=cache,
        )

        self.assertTrue(result["dry_run"])
        self.assertEqual(result["trainer_id"], "trainer-1")
        self.assertEqual(result["before"]["trainer"]["is_legacy"], True)
        self.assertEqual(cache.deleted, [])
        self.assertFalse(any(op["operation"] != "select" for op in admin.operations))

    def test_mode_local_reset_updates_state_profile_persona_and_cache(self):
        admin = FakeAdmin()
        cache = FakeCache()

        result = reset_trainer_onboarding(
            email="test.trainer@mode.local",
            admin=admin,
            cache=cache,
        )

        self.assertFalse(result["dry_run"])
        self.assertEqual(cache.deleted, ["mode:tenant_context:user-trainer"])

        trainer = admin.tables["trainers"][0]
        self.assertFalse(trainer["is_legacy"])

        account = admin.tables["user_accounts"][0]
        self.assertEqual(account["email"], "test.trainer@mode.local")

        role = admin.tables["user_roles"][0]
        self.assertEqual(role["role"], "trainer")
        self.assertTrue(role["is_active"])

        state = admin.tables["onboarding_states"][0]
        self.assertEqual(state["flow_key"], "trainer_stub_v1")
        self.assertEqual(state["status"], "not_started")
        self.assertEqual(state["current_step"], "trainer_stub")
        self.assertIsNone(state["completed_at"])
        self.assertEqual(state["payload"], {})

        profile = admin.tables["trainer_onboarding_profiles"][0]
        self.assertEqual(profile["onboarding_status"], "not_started")
        self.assertEqual(profile["onboarding_progress"]["current_step"], "welcome")
        self.assertEqual(profile["onboarding_progress"]["completed_steps"], 0)
        self.assertIsNone(profile["last_completed_step"])
        self.assertIsNone(profile["retrain_draft"])
        self.assertEqual(profile["identity"], {})

        persona = admin.tables["trainer_personas"][0]
        self.assertEqual(persona["onboarding_preferences"], {"other": "keep"})

    def test_non_mode_local_email_requires_force(self):
        admin = FakeAdmin()
        admin.auth.admin._users = [
            SimpleNamespace(id="user-trainer", email="trainer@example.com")
        ]

        with self.assertRaisesRegex(RuntimeError, "--force"):
            reset_trainer_onboarding(email="trainer@example.com", admin=admin, cache=FakeCache())

        result = reset_trainer_onboarding(
            email="trainer@example.com",
            force=True,
            admin=admin,
            cache=FakeCache(),
        )
        self.assertEqual(result["email"], "trainer@example.com")

    def test_missing_auth_user_fails_clearly(self):
        with self.assertRaisesRegex(RuntimeError, "Auth user not found"):
            reset_trainer_onboarding(
                email="test.trainer@mode.local",
                admin=FakeAdmin(include_user=False),
                cache=FakeCache(),
            )

    def test_missing_trainer_row_fails_clearly(self):
        with self.assertRaisesRegex(RuntimeError, "Trainer row not found"):
            reset_trainer_onboarding(
                email="test.trainer@mode.local",
                admin=FakeAdmin(include_trainer=False),
                cache=FakeCache(),
            )


if __name__ == "__main__":
    unittest.main()
