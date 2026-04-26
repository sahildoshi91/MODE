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
    def __init__(self):
        self.usage_logs = []
        self.increment_events = []

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

    def list_active_knowledge_entries(self, trainer_id, limit):
        del trainer_id, limit
        return [
            {
                "id": "entry-client-1",
                "trainer_id": "trainer-1",
                "client_id": "client-1",
                "title": "Adjust intensity when sleep is poor",
                "raw_content": "When sleep is poor, reduce volume and focus on movement quality.",
                "structured_summary": "Reduce volume when sleep is poor.",
                "knowledge_type": "coaching_rule",
                "scope": "client_specific",
                "tags": ["sleep", "recovery"],
                "ai_enabled": True,
                "status": "active",
                "confidence_score": 0.9,
                "embedding_status": "embedded",
                "last_embedded_at": "2026-04-12T10:00:00+00:00",
                "usage_count": 3,
                "last_used_at": "2026-04-12T10:00:00+00:00",
                "updated_at": "2026-04-12T10:00:00+00:00",
                "created_at": "2026-04-11T10:00:00+00:00",
            },
            {
                "id": "entry-global-style",
                "trainer_id": "trainer-1",
                "client_id": None,
                "title": "Communication style preference",
                "raw_content": "Use concise, motivating language and avoid shaming language.",
                "structured_summary": "Use concise and motivating tone.",
                "knowledge_type": "communication_style",
                "scope": "global",
                "tags": ["tone", "communication"],
                "ai_enabled": True,
                "status": "active",
                "confidence_score": 0.82,
                "embedding_status": "embedded",
                "last_embedded_at": "2026-04-11T10:00:00+00:00",
                "usage_count": 5,
                "last_used_at": "2026-04-11T10:00:00+00:00",
                "updated_at": "2026-04-11T10:00:00+00:00",
                "created_at": "2026-04-10T10:00:00+00:00",
            },
            {
                "id": "entry-archived",
                "trainer_id": "trainer-1",
                "client_id": "client-1",
                "title": "Archived rule",
                "raw_content": "Archived content should never surface.",
                "structured_summary": "Archived content should never surface.",
                "knowledge_type": "coaching_rule",
                "scope": "client_specific",
                "tags": ["archived"],
                "ai_enabled": True,
                "status": "archived",
                "confidence_score": 0.6,
                "embedding_status": "embedded",
                "last_embedded_at": "2026-04-10T10:00:00+00:00",
                "usage_count": 2,
                "last_used_at": "2026-04-10T10:00:00+00:00",
                "updated_at": "2026-04-10T10:00:00+00:00",
                "created_at": "2026-04-09T10:00:00+00:00",
            },
            {
                "id": "entry-ai-disabled",
                "trainer_id": "trainer-1",
                "client_id": None,
                "title": "AI disabled rule",
                "raw_content": "AI disabled content should never surface.",
                "structured_summary": "AI disabled content should never surface.",
                "knowledge_type": "coaching_rule",
                "scope": "global",
                "tags": ["ai_disabled"],
                "ai_enabled": False,
                "status": "active",
                "confidence_score": 0.6,
                "embedding_status": "failed",
                "last_embedded_at": None,
                "usage_count": 0,
                "last_used_at": None,
                "updated_at": "2026-04-10T10:00:00+00:00",
                "created_at": "2026-04-09T10:00:00+00:00",
            },
            {
                "id": "entry-other-client",
                "trainer_id": "trainer-1",
                "client_id": "client-2",
                "title": "Other client note",
                "raw_content": "Other client context should not leak.",
                "structured_summary": "Other client context should not leak.",
                "knowledge_type": "coaching_rule",
                "scope": "client_specific",
                "tags": ["other_client"],
                "ai_enabled": True,
                "status": "active",
                "confidence_score": 0.62,
                "embedding_status": "embedded",
                "last_embedded_at": "2026-04-11T10:00:00+00:00",
                "usage_count": 1,
                "last_used_at": "2026-04-11T10:00:00+00:00",
                "updated_at": "2026-04-11T10:00:00+00:00",
                "created_at": "2026-04-10T10:00:00+00:00",
            },
        ]

    def create_knowledge_usage_logs(self, rows):
        self.usage_logs.extend(rows)
        return rows

    def increment_knowledge_entry_usage(self, trainer_id, entry_id, timestamp_iso):
        self.increment_events.append(
            {
                "trainer_id": trainer_id,
                "entry_id": entry_id,
                "timestamp_iso": timestamp_iso,
            }
        )

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


class FakeMemoryMatcherRepository:
    def __init__(self, rows):
        self.rows = rows

    def list_client_memory(self, trainer_id, client_id, limit):
        del trainer_id, client_id, limit
        return list(self.rows)


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
        self.assertIn("TRAINER KNOWLEDGE CONTEXT:", context.system_appendix)
        self.assertIn("Reduce volume when sleep is poor.", context.system_appendix)
        self.assertNotIn("Archived content should never surface.", context.system_appendix)
        self.assertNotIn("AI disabled content should never surface.", context.system_appendix)
        self.assertNotIn("Other client context should not leak.", context.system_appendix)
        self.assertIn("[LAYER_2_CLIENT_MEMORY_AI_USABLE_ONLY]", context.system_appendix)
        self.assertIn("Prefers early sessions before work.", context.system_appendix)
        self.assertNotIn("Internal-only note should not be injected.", context.system_appendix)
        self.assertIn("[LAYER_3_DYNAMIC_ANALYTICS]", context.system_appendix)
        self.assertIn("entrypoint: generated_workout", context.system_appendix)
        self.assertIn("knowledge_retrieval", context.metadata)
        self.assertGreaterEqual(context.metadata["knowledge_retrieval"]["selected_count"], 1)
        selected = context.metadata["knowledge_retrieval"]["selected_entries"]
        self.assertEqual(selected[0]["knowledge_entry_id"], "entry-client-1")

    def test_memory_theme_matcher_returns_true_for_strong_token_overlap(self):
        service = TrainerIntelligenceService(
            FakeMemoryMatcherRepository(
                [
                    {
                        "memory_type": "note",
                        "memory_key": "late_night_snacking_stress",
                        "updated_at": "2026-04-11T17:00:00+00:00",
                        "value_json": {
                            "visibility": "ai_usable",
                            "is_archived": False,
                            "text": "Client struggles with late night snacking after stressful workdays and loses consistency.",
                            "tags": ["nutrition", "stress", "consistency"],
                        },
                    }
                ]
            )
        )

        result = service.is_question_covered_by_memory_theme(
            trainer_id="trainer-1",
            client_id="client-1",
            question="Late night snacking after stressful workdays is hurting my consistency.",
        )

        self.assertTrue(result["covered"])
        self.assertIn(result["reason"], {"phrase_containment", "token_overlap"})

    def test_memory_theme_matcher_returns_false_for_weak_overlap(self):
        service = TrainerIntelligenceService(
            FakeMemoryMatcherRepository(
                [
                    {
                        "memory_type": "note",
                        "memory_key": "hydration",
                        "updated_at": "2026-04-11T17:00:00+00:00",
                        "value_json": {
                            "visibility": "ai_usable",
                            "is_archived": False,
                            "text": "Client forgets hydration during afternoon sessions.",
                            "tags": ["hydration"],
                        },
                    }
                ]
            )
        )

        result = service.is_question_covered_by_memory_theme(
            trainer_id="trainer-1",
            client_id="client-1",
            question="Can I swap barbell back squats for leg press today?",
        )

        self.assertFalse(result["covered"])
        self.assertEqual(result["reason"], "no_strong_match")

    def test_memory_theme_matcher_ignores_internal_only_and_archived_memory(self):
        service = TrainerIntelligenceService(
            FakeMemoryMatcherRepository(
                [
                    {
                        "memory_type": "note",
                        "memory_key": "internal_note",
                        "updated_at": "2026-04-11T17:00:00+00:00",
                        "value_json": {
                            "visibility": "internal_only",
                            "is_archived": False,
                            "text": "Client struggles with late night snacking after stressful workdays.",
                            "tags": ["nutrition"],
                        },
                    },
                    {
                        "memory_type": "note",
                        "memory_key": "archived_note",
                        "updated_at": "2026-04-11T16:00:00+00:00",
                        "value_json": {
                            "visibility": "ai_usable",
                            "is_archived": True,
                            "text": "Client struggles with late night snacking after stressful workdays.",
                            "tags": ["nutrition"],
                        },
                    },
                ]
            )
        )

        result = service.is_question_covered_by_memory_theme(
            trainer_id="trainer-1",
            client_id="client-1",
            question="I keep snacking late at night after stressful workdays and my consistency drops. How should I handle it?",
        )

        self.assertFalse(result["covered"])
        self.assertEqual(result["reason"], "no_ai_usable_memory")

    def test_log_retrieval_usage_marks_only_selected_entries_as_used(self):
        repository = FakeTrainerIntelligenceRepository()
        service = TrainerIntelligenceService(repository)

        service.log_retrieval_usage(
            trainer_id="trainer-1",
            tenant_id="tenant-1",
            client_id="client-1",
            conversation_id="conversation-1",
            message_id="message-1",
            retrieval_metadata={
                "candidate_entries": [
                    {"knowledge_entry_id": "entry-client-1", "score": 0.91},
                    {"knowledge_entry_id": "entry-global-style", "score": 0.73},
                    {"knowledge_entry_id": "entry-other-client", "score": 0.38},
                ],
                "selected_entries": [
                    {"knowledge_entry_id": "entry-client-1", "score": 0.91},
                    {"knowledge_entry_id": "entry-global-style", "score": 0.73},
                ],
            },
        )

        self.assertEqual(len(repository.usage_logs), 3)
        used_ids = {row["knowledge_entry_id"] for row in repository.usage_logs if row["used_in_response"] is True}
        self.assertEqual(used_ids, {"entry-client-1", "entry-global-style"})
        self.assertEqual(len(repository.increment_events), 2)


if __name__ == "__main__":
    unittest.main()
