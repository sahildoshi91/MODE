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
from app.modules.trainer_intelligence.service import TrainerIntelligenceService


class FakeRoute:
    task_type = "workout_adjustment"
    response_mode = "direct_answer"
    flow = "default_fast"


class FakeTrainerIntelligenceRepository:
    def get_default_persona(self, trainer_id):
        del trainer_id
        return {
            "persona_name": "Coach Maya",
            "tone_description": "Warm and direct.",
            "coaching_philosophy": "Consistency over perfection.",
        }

    def list_active_rules(self, trainer_id, limit):
        del trainer_id, limit
        return [
            {"category": "progression_logic", "rule_text": "Progress load only when form quality stays high."},
            {"category": "recovery_logic", "rule_text": "Deload if readiness trends low for three sessions."},
        ]

    def list_recent_knowledge_documents(self, trainer_id, limit):
        del trainer_id, limit
        return [
            {"title": "Programming Notes", "raw_text": "Use movement substitutions for constrained schedules."},
        ]

    def list_client_memory(self, trainer_id, client_id, limit):
        del trainer_id, client_id, limit
        return [
            {
                "memory_type": "preference",
                "memory_key": "pref_morning",
                "updated_at": "2026-04-11T18:00:00+00:00",
                "value_json": {
                    "visibility": "ai_usable",
                    "is_archived": False,
                    "text": "Prefers early sessions before work.",
                    "tags": ["schedule"],
                },
            },
            {
                "memory_type": "note",
                "memory_key": "internal_flag",
                "updated_at": "2026-04-11T17:00:00+00:00",
                "value_json": {
                    "visibility": "internal_only",
                    "is_archived": False,
                    "text": "Internal-only note should not be injected.",
                },
            },
        ]

    def get_profile(self, client_id):
        del client_id
        return {
            "primary_goal": "strength",
            "experience_level": "intermediate",
            "equipment_access": "home_gym",
        }

    def list_recent_checkins(self, client_id, limit):
        del client_id, limit
        return [
            {"date": "2026-04-11", "total_score": 18, "assigned_mode": "BUILD"},
            {"date": "2026-04-10", "total_score": 17, "assigned_mode": "BUILD"},
        ]

    def list_recent_completed_workouts(self, user_id, limit):
        del user_id, limit
        return [{"id": "workout-1", "created_at": "2026-04-10T09:30:00+00:00"}]


class TrainerIntelligenceServiceTests(unittest.TestCase):
    def test_assemble_prompt_context_layers_and_filters_memory(self):
        service = TrainerIntelligenceService(FakeTrainerIntelligenceRepository())
        trainer_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-1",
            client_user_id="client-user-1",
        )

        context = service.assemble_prompt_context(
            trainer_context=trainer_context,
            route=FakeRoute(),
            client_context={"entrypoint": "generated_workout"},
            profile={"preferred_session_length": 35},
        )

        self.assertTrue(context.metadata["used"])
        self.assertIn("[LAYER_1_TRAINER_GLOBAL_KNOWLEDGE]", context.system_appendix)
        self.assertIn("[LAYER_2_CLIENT_MEMORY_AI_USABLE_ONLY]", context.system_appendix)
        self.assertIn("Prefers early sessions before work.", context.system_appendix)
        self.assertNotIn("Internal-only note should not be injected.", context.system_appendix)
        self.assertIn("[LAYER_3_DYNAMIC_ANALYTICS]", context.system_appendix)
        self.assertIn("entrypoint: generated_workout", context.system_appendix)


if __name__ == "__main__":
    unittest.main()
