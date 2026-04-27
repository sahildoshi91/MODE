import os
import sys
import unittest
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from supabase import create_client
from supabase.lib.client_options import SyncClientOptions

from app.core.config import settings
from app.db.client import get_supabase_admin_client
from app.modules.atlas.repository import AtlasRepository
from app.modules.atlas.service import AtlasReviewQueueService, TrainerAiReviewQueueService


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
class AtlasPhase1StagingSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin = get_supabase_admin_client()
        cls.anon = create_client(
            settings.supabase_url,
            settings.supabase_anon_key,
            options=SyncClientOptions(auto_refresh_token=False, persist_session=False),
        )
        cls.repository = AtlasRepository(cls.admin)
        cls.atlas_review_service = AtlasReviewQueueService(cls.repository)
        cls.trainer_ai_service = TrainerAiReviewQueueService(cls.repository)
        cls.run_id = uuid4().hex
        cls.password = f"ModeAtlas!{cls.run_id[:12]}"
        cls.user_ids: list[str] = []
        cls.tenant_ids: list[str] = []
        cls.atlas_review_queue_ids: list[str] = []
        cls.atlas_knowledge_ids: list[str] = []
        cls.trainer_ai_review_queue_ids: list[str] = []
        cls.trainer_ai_knowledge_ids: list[str] = []

        cls.trainer_user = cls._create_auth_user(f"mode-atlas-smoke-trainer+{cls.run_id}@example.com")
        cls.tenant_id, cls.trainer_id = cls._bootstrap_trainer_tenant(
            trainer_user_id=cls.trainer_user["id"],
            tenant_name=f"MODE Atlas Smoke {cls.run_id}",
            tenant_slug=f"mode-atlas-smoke-{cls.run_id}",
            trainer_display_name="Atlas Smoke Coach",
        )
        cls.tenant_ids.append(cls.tenant_id)

    @classmethod
    def tearDownClass(cls):
        for knowledge_id in getattr(cls, "atlas_knowledge_ids", []):
            try:
                cls.admin.table("atlas_knowledge").delete().eq("id", knowledge_id).execute()
            except Exception:
                pass
        for queue_id in getattr(cls, "atlas_review_queue_ids", []):
            try:
                cls.admin.table("atlas_audit_logs").delete().contains("metadata", {"queue_id": queue_id}).execute()
            except Exception:
                pass
            try:
                cls.admin.table("atlas_review_queue").delete().eq("id", queue_id).execute()
            except Exception:
                pass
        for knowledge_id in getattr(cls, "trainer_ai_knowledge_ids", []):
            try:
                cls.admin.table("trainer_ai_knowledge").delete().eq("id", knowledge_id).execute()
            except Exception:
                pass
        for queue_id in getattr(cls, "trainer_ai_review_queue_ids", []):
            try:
                cls.admin.table("atlas_audit_logs").delete().contains("metadata", {"queue_id": queue_id}).execute()
            except Exception:
                pass
            try:
                cls.admin.table("trainer_ai_review_queue").delete().eq("id", queue_id).execute()
            except Exception:
                pass
        for tenant_id in getattr(cls, "tenant_ids", []):
            try:
                cls.admin.table("tenants").delete().eq("id", tenant_id).execute()
            except Exception:
                pass
        for user_id in getattr(cls, "user_ids", []):
            try:
                cls.admin.auth.admin.delete_user(user_id)
            except Exception:
                pass

    @classmethod
    def _create_auth_user(cls, email: str) -> dict[str, str]:
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
    def _bootstrap_trainer_tenant(
        cls,
        *,
        trainer_user_id: str,
        tenant_name: str,
        tenant_slug: str,
        trainer_display_name: str,
    ) -> tuple[str, str]:
        response = cls.admin.rpc(
            "bootstrap_trainer_tenant",
            {
                "trainer_user_id": trainer_user_id,
                "tenant_name": tenant_name,
                "tenant_slug": tenant_slug,
                "trainer_display_name": trainer_display_name,
                "default_persona_name": "Atlas Smoke Coach",
                "tone_description": "Direct and practical.",
                "coaching_philosophy": "Keep Atlas silent and scoped.",
            },
        ).execute()
        row = response.data[0]
        return row["tenant_id"], row["trainer_id"]

    def test_atlas_profile_seed_and_runtime_flags_are_phase1_safe(self):
        profile_rows = (
            self.admin
            .table("atlas_profile")
            .select("name, persona_summary, tone_rules")
            .eq("name", "Atlas")
            .limit(1)
            .execute()
            .data
        )

        self.assertEqual(profile_rows[0]["name"], "Atlas")
        self.assertIn("silent coaching intelligence layer", profile_rows[0]["persona_summary"])
        self.assertIn("no shame", profile_rows[0]["tone_rules"])
        self.assertFalse(settings.atlas_runtime_enabled)
        self.assertFalse(settings.atlas_generic_coach_enabled)

    def test_atlas_admin_review_approval_writes_approved_knowledge_only(self):
        queue = self.repository.insert_atlas_review_queue(
            {
                "proposed_learning": "When adherence drops, choose one small next action before increasing pressure.",
                "knowledge_type": "adherence_strategy",
                "situation_tags": ["missed_workouts"],
                "client_context_tags": ["beginner"],
                "privacy_flags": [],
                "privacy_risk_score": 0.05,
                "confidence_score": 0.82,
                "response_pattern": "Normalize the setback and ask for the smallest next action.",
                "contraindications": ["Do not shame the client"],
                "reviewer_status": "pending",
            }
        )
        self.atlas_review_queue_ids.append(queue["id"])

        knowledge = self.atlas_review_service.approve_queue_item(
            queue["id"],
            reviewer_notes=f"atlas staging smoke {self.run_id}",
        )
        self.atlas_knowledge_ids.append(knowledge.id)

        self.assertEqual(knowledge.status, "approved")
        self.assertLess(knowledge.privacy_risk_score, 0.15)
        self.assertEqual(knowledge.generalized_learning, queue["proposed_learning"])

        approved_rows = (
            self.admin
            .table("atlas_knowledge")
            .select("id, status, generalized_learning")
            .eq("id", knowledge.id)
            .eq("status", "approved")
            .execute()
            .data
        )
        self.assertEqual(len(approved_rows), 1)

    def test_trainer_ai_review_approval_is_trainer_scoped(self):
        queue = self.repository.insert_trainer_ai_review_queue(
            {
                "trainer_id": self.trainer_id,
                "proposed_rule": "This trainer prefers concise, direct check-ins.",
                "reason_detected": "Atlas observed a trainer-approved AI output.",
                "confidence_score": 0.77,
                "knowledge_type": "tone_pattern",
                "example_pattern_sanitized": "Use a short check-in with a clear next step.",
                "reviewer_status": "pending",
            }
        )
        self.trainer_ai_review_queue_ids.append(queue["id"])

        knowledge = self.trainer_ai_service.approve(self.trainer_id, queue["id"])
        self.trainer_ai_knowledge_ids.append(knowledge.id)

        own_rows = self.trainer_ai_service.list_knowledge(self.trainer_id, status="approved")
        other_rows = self.trainer_ai_service.list_knowledge(str(uuid4()), status="approved")

        self.assertTrue(any(row.id == knowledge.id for row in own_rows))
        self.assertFalse(any(row.id == knowledge.id for row in other_rows))
        self.assertEqual(knowledge.trainer_id, self.trainer_id)


if __name__ == "__main__":
    unittest.main()
