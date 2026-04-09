import os
import sys
import unittest
from datetime import date
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from supabase import create_client
from supabase.lib.client_options import SyncClientOptions

from app.core.config import settings
from app.db.client import get_supabase_admin_client, get_supabase_user_client
from app.main import app


def _staging_env_ready() -> bool:
    return bool(
        os.getenv("MODE_RUN_STAGING_SUPABASE_TESTS") == "1"
        and settings.supabase_url
        and settings.supabase_anon_key
        and settings.supabase_service_role_key
    )


@unittest.skipUnless(
    _staging_env_ready(),
    "Set MODE_RUN_STAGING_SUPABASE_TESTS=1 with real SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY to run.",
)
class DailyCheckinStagingIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin = get_supabase_admin_client()
        cls.anon = create_client(
            settings.supabase_url,
            settings.supabase_anon_key,
            options=SyncClientOptions(
                auto_refresh_token=False,
                persist_session=False,
            ),
        )
        cls.client = TestClient(app)
        cls.run_id = uuid4().hex
        cls.password = f"ModeStage!{cls.run_id[:12]}"
        cls.user_ids = []
        cls.tenant_id = None
        cls.trainer_id = None
        cls.client_id = None

        cls.trainer_user = cls._create_auth_user(f"mode-checkin-trainer+{cls.run_id}@example.com")
        cls.client_user = cls._create_auth_user(f"mode-checkin-client+{cls.run_id}@example.com")

        tenant_row = (
            cls.admin.table("tenants")
            .insert(
                {
                    "name": f"MODE Checkin {cls.run_id}",
                    "slug": f"mode-checkin-{cls.run_id}",
                }
            )
            .execute()
            .data[0]
        )
        cls.tenant_id = tenant_row["id"]

        trainer_row = (
            cls.admin.table("trainers")
            .insert(
                {
                    "tenant_id": cls.tenant_id,
                    "user_id": cls.trainer_user["id"],
                    "display_name": "Coach Checkin",
                }
            )
            .execute()
            .data[0]
        )
        cls.trainer_id = trainer_row["id"]

        cls.admin.table("trainer_personas").insert(
            {
                "trainer_id": cls.trainer_id,
                "persona_name": "Checkin Coach",
                "tone_description": "Warm, direct, practical.",
                "coaching_philosophy": "Protect reliability before adding complexity.",
                "is_default": True,
            }
        ).execute()

        client_row = (
            cls.admin.table("clients")
            .insert(
                {
                    "tenant_id": cls.tenant_id,
                    "user_id": cls.client_user["id"],
                    "assigned_trainer_id": cls.trainer_id,
                }
            )
            .execute()
            .data[0]
        )
        cls.client_id = client_row["id"]

        cls.client_access_token = cls._sign_in_and_get_access_token(cls.client_user["email"])

    @classmethod
    def tearDownClass(cls):
        if cls.tenant_id:
            cls.admin.table("tenants").delete().eq("id", cls.tenant_id).execute()

        for user_id in cls.user_ids:
            try:
                cls.admin.auth.admin.delete_user(user_id)
            except Exception:
                pass

    @classmethod
    def _create_auth_user(cls, email):
        response = cls.admin.auth.admin.create_user(
            {
                "email": email,
                "password": cls.password,
                "email_confirm": True,
            }
        )
        user = response.user
        cls.user_ids.append(user.id)
        return {"id": user.id, "email": email}

    @classmethod
    def _sign_in_and_get_access_token(cls, email):
        response = cls.anon.auth.sign_in_with_password(
            {
                "email": email,
                "password": cls.password,
            }
        )
        session = getattr(response, "session", None)
        if not session or not session.access_token:
            raise RuntimeError(f"Failed to sign in staging test user {email}")
        return session.access_token

    def _generate_training_plan(
        self,
        *,
        headers: dict[str, str],
        checkin_id: str,
        environment: str,
        time_available: int,
        refresh_requested: bool = False,
        include_yesterday_context: bool = True,
    ) -> dict:
        response = self.client.post(
            "/api/v1/checkin/generate-plan",
            json={
                "checkin_id": checkin_id,
                "plan_type": "training",
                "environment": environment,
                "time_available": time_available,
                "include_yesterday_context": include_yesterday_context,
                "refresh_requested": refresh_requested,
            },
            headers=headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["plan_type"], "training")
        self.assertTrue(payload.get("plan_id"))
        self.assertTrue(payload.get("request_fingerprint"))
        self.assertIsInstance(payload.get("revision_number"), int)
        self.assertIsInstance(payload.get("structured"), dict)
        self.assertIsInstance(payload.get("workout_context"), dict)
        self.assertEqual(payload["workout_context"]["generated_plan_id"], payload["plan_id"])
        self.assertEqual(payload["workout_context"]["request_fingerprint"], payload["request_fingerprint"])
        self.assertEqual(payload["workout_context"]["revision_number"], payload["revision_number"])
        self.assertEqual(payload["workout_context"]["environment"], environment)
        self.assertEqual(payload["workout_context"]["time_available"], time_available)
        return payload

    def test_checkin_submit_persists_and_roundtrips_with_rls(self):
        checkin_date = date.today().isoformat()
        headers = {"Authorization": f"Bearer {self.client_access_token}"}

        pending_response = self.client.get(
            "/api/v1/checkin/today",
            params={"request_date": checkin_date},
            headers=headers,
        )
        self.assertEqual(pending_response.status_code, 200, pending_response.text)
        pending_payload = pending_response.json()
        self.assertFalse(pending_payload["completed"])
        self.assertIsNone(pending_payload["checkin"])

        inputs = {
            "sleep": 4,
            "stress": 4,
            "soreness": 4,
            "nutrition": 4,
            "motivation": 4,
        }
        submit_response = self.client.post(
            "/api/v1/checkin",
            json={
                "date": checkin_date,
                "inputs": inputs,
                "time_to_complete": 11,
            },
            headers=headers,
        )
        self.assertEqual(submit_response.status_code, 200, submit_response.text)
        submitted = submit_response.json()
        self.assertEqual(submitted["score"], 20)
        self.assertEqual(submitted["mode"], "BUILD")
        self.assertEqual(submitted["inputs"], inputs)
        self.assertEqual(submitted["time_to_complete"], 11)

        user_client = get_supabase_user_client(self.client_access_token)
        db_rows = (
            user_client.table("daily_checkins")
            .select("id, client_id, date, total_score, assigned_mode, inputs, time_to_complete")
            .eq("id", submitted["id"])
            .eq("client_id", self.client_id)
            .limit(1)
            .execute()
            .data
        )
        self.assertEqual(len(db_rows), 1)
        self.assertEqual(db_rows[0]["date"], checkin_date)
        self.assertEqual(db_rows[0]["total_score"], 20)
        persisted_mode_variants = {
            "BEAST": {"BEAST", "GREEN"},
            "BUILD": {"BUILD", "YELLOW"},
            "RECOVER": {"RECOVER", "BLUE"},
            "REST": {"REST", "RED"},
        }
        self.assertIn(db_rows[0]["assigned_mode"], persisted_mode_variants[submitted["mode"]])
        self.assertEqual(db_rows[0]["inputs"], inputs)
        self.assertEqual(db_rows[0]["time_to_complete"], 11)

        completed_response = self.client.get(
            "/api/v1/checkin/today",
            params={"request_date": checkin_date},
            headers=headers,
        )
        self.assertEqual(completed_response.status_code, 200, completed_response.text)
        completed_payload = completed_response.json()
        self.assertTrue(completed_payload["completed"])
        self.assertEqual(completed_payload["checkin"]["id"], submitted["id"])
        self.assertEqual(completed_payload["checkin"]["score"], 20)
        self.assertEqual(completed_payload["checkin"]["mode"], "BUILD")

        training_payload = self._generate_training_plan(
            headers=headers,
            checkin_id=submitted["id"],
            environment="home_gym",
            time_available=30,
        )

        nutrition_response = self.client.post(
            "/api/v1/checkin/generate-plan",
            json={
                "checkin_id": submitted["id"],
                "plan_type": "nutrition",
                "include_yesterday_context": True,
            },
            headers=headers,
        )
        self.assertEqual(nutrition_response.status_code, 200, nutrition_response.text)
        nutrition_payload = nutrition_response.json()
        self.assertEqual(nutrition_payload["plan_type"], "nutrition")
        self.assertTrue(nutrition_payload.get("plan_id"))
        self.assertIsInstance(nutrition_payload.get("structured"), dict)

        generated_rows = (
            user_client.table("generated_checkin_plans")
            .select("id, checkin_id, plan_type, assigned_mode, request_fingerprint, revision_number")
            .eq("checkin_id", submitted["id"])
            .execute()
            .data
        )
        self.assertGreaterEqual(len(generated_rows), 2)
        generated_types = {row["plan_type"] for row in generated_rows}
        self.assertIn("training", generated_types)
        self.assertIn("nutrition", generated_types)
        training_rows = [row for row in generated_rows if row["plan_type"] == "training"]
        self.assertEqual(len(training_rows), 1)
        self.assertEqual(training_rows[0]["id"], training_payload["plan_id"])
        self.assertEqual(training_rows[0]["request_fingerprint"], training_payload["request_fingerprint"])
        self.assertEqual(training_rows[0]["revision_number"], training_payload["revision_number"])

    def test_training_generate_plan_variants_persist_refresh_and_reuse(self):
        checkin_date = date.today().isoformat()
        headers = {"Authorization": f"Bearer {self.client_access_token}"}
        inputs = {
            "sleep": 4,
            "stress": 4,
            "soreness": 4,
            "nutrition": 4,
            "motivation": 4,
        }
        submit_response = self.client.post(
            "/api/v1/checkin",
            json={
                "date": checkin_date,
                "inputs": inputs,
                "time_to_complete": 9,
            },
            headers=headers,
        )
        self.assertEqual(submit_response.status_code, 200, submit_response.text)
        submitted = submit_response.json()
        user_client = get_supabase_user_client(self.client_access_token)

        plan_a = self._generate_training_plan(
            headers=headers,
            checkin_id=submitted["id"],
            environment="home_gym",
            time_available=30,
        )
        plan_b = self._generate_training_plan(
            headers=headers,
            checkin_id=submitted["id"],
            environment="outdoors",
            time_available=30,
        )
        plan_c = self._generate_training_plan(
            headers=headers,
            checkin_id=submitted["id"],
            environment="home_gym",
            time_available=10,
        )
        plan_d = self._generate_training_plan(
            headers=headers,
            checkin_id=submitted["id"],
            environment="home_gym",
            time_available=30,
            refresh_requested=True,
        )
        plan_e = self._generate_training_plan(
            headers=headers,
            checkin_id=submitted["id"],
            environment="home_gym",
            time_available=30,
        )

        self.assertNotEqual(plan_a["plan_id"], plan_b["plan_id"])
        self.assertNotEqual(plan_a["request_fingerprint"], plan_b["request_fingerprint"])
        self.assertNotEqual(plan_a["plan_id"], plan_c["plan_id"])
        self.assertNotEqual(plan_a["request_fingerprint"], plan_c["request_fingerprint"])
        self.assertNotEqual(plan_a["plan_id"], plan_d["plan_id"])
        self.assertEqual(plan_a["request_fingerprint"], plan_d["request_fingerprint"])
        self.assertGreater(plan_d["revision_number"], plan_a["revision_number"])
        self.assertEqual(plan_e["plan_id"], plan_d["plan_id"])
        self.assertEqual(plan_e["request_fingerprint"], plan_d["request_fingerprint"])
        self.assertEqual(plan_e["revision_number"], plan_d["revision_number"])

        generated_rows = (
            user_client.table("generated_checkin_plans")
            .select(
                "id, checkin_id, plan_type, environment, time_available, request_fingerprint, revision_number, structured_content"
            )
            .eq("checkin_id", submitted["id"])
            .eq("plan_type", "training")
            .order("created_at")
            .execute()
            .data
        )
        self.assertEqual(len(generated_rows), 4)

        fingerprint_buckets = {}
        for row in generated_rows:
            fingerprint_buckets.setdefault(row["request_fingerprint"], []).append(row)
            self.assertTrue(row["request_fingerprint"])
            self.assertIsInstance(row["revision_number"], int)

        self.assertEqual(len(fingerprint_buckets), 3)

        home_30_rows = [
            row for row in generated_rows
            if row["environment"] == "home_gym" and row["time_available"] == 30
        ]
        outdoors_30_rows = [
            row for row in generated_rows
            if row["environment"] == "outdoors" and row["time_available"] == 30
        ]
        home_10_rows = [
            row for row in generated_rows
            if row["environment"] == "home_gym" and row["time_available"] == 10
        ]
        self.assertEqual(len(outdoors_30_rows), 1)
        self.assertEqual(len(home_10_rows), 1)
        self.assertGreaterEqual(len(home_30_rows), 2)
        self.assertEqual(
            max(row["revision_number"] for row in home_30_rows),
            plan_d["revision_number"],
        )

        latest_home_30 = max(home_30_rows, key=lambda row: row["revision_number"])
        self.assertEqual(latest_home_30["id"], plan_d["plan_id"])
        self.assertEqual(latest_home_30["request_fingerprint"], plan_d["request_fingerprint"])
        self.assertEqual(latest_home_30["revision_number"], plan_d["revision_number"])
        self.assertIsInstance(latest_home_30["structured_content"], dict)


if __name__ == "__main__":
    unittest.main()
