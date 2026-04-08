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

        training_response = self.client.post(
            "/api/v1/checkin/generate-plan",
            json={
                "checkin_id": submitted["id"],
                "plan_type": "training",
                "environment": "home_gym",
                "time_available": 30,
                "include_yesterday_context": True,
            },
            headers=headers,
        )
        self.assertEqual(training_response.status_code, 200, training_response.text)
        training_payload = training_response.json()
        self.assertEqual(training_payload["plan_type"], "training")
        self.assertTrue(training_payload.get("plan_id"))
        self.assertIsInstance(training_payload.get("structured"), dict)

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
            .select("id, checkin_id, plan_type, assigned_mode")
            .eq("checkin_id", submitted["id"])
            .execute()
            .data
        )
        self.assertGreaterEqual(len(generated_rows), 2)
        generated_types = {row["plan_type"] for row in generated_rows}
        self.assertIn("training", generated_types)
        self.assertIn("nutrition", generated_types)


if __name__ == "__main__":
    unittest.main()
