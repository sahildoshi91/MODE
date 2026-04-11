import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.ai.client import GeminiCompletion, TokenUsage
from app.core.tenancy import TrainerContext
from app.modules.conversation.schemas import ChatRequest
from app.modules.conversation.service import ConversationService
from app.modules.trainer_intelligence.schemas import TrainerIntelligencePromptContext


class FakeConversationRepository:
    def __init__(self):
        self.saved_messages = []

    def get_conversation(self, conversation_id):
        del conversation_id
        return None

    def find_active_conversation(self, client_id, trainer_id):
        del client_id, trainer_id
        return None

    def create_conversation(self, trainer_id, client_id, conversation_type, stage):
        return {
            "id": "conversation-1",
            "trainer_id": trainer_id,
            "client_id": client_id,
            "type": conversation_type,
            "current_stage": stage,
        }

    def save_message(self, conversation_id, role, message_text, structured_payload=None):
        payload = {
            "id": f"message-{len(self.saved_messages) + 1}",
            "conversation_id": conversation_id,
            "role": role,
            "message_text": message_text,
            "structured_payload": structured_payload,
        }
        self.saved_messages.append(payload)
        return payload

    def list_messages(self, conversation_id, limit=20):
        del conversation_id, limit
        return []

    def update_conversation_state(self, conversation_id, stage, onboarding_complete):
        del conversation_id, stage, onboarding_complete

    def record_usage_event(self, **kwargs):
        return {"id": "usage-1", **kwargs}

    def get_conversation_usage_summary(self, conversation_id):
        del conversation_id
        return None


class FakeProfileService:
    def get_or_create_profile(self, client_id):
        return {
            "client_id": client_id,
            "primary_goal": "strength",
            "experience_level": "intermediate",
            "equipment_access": "home_gym",
        }


class FakeTrainerReviewService:
    def queue_unanswered_question(self, **kwargs):
        del kwargs


class FakeTrainerPersonaRepository:
    def get_default_by_trainer(self, trainer_id):
        del trainer_id
        return None

    def create(self, payload):
        return payload

    def update(self, persona_id, payload):
        del persona_id
        return payload


class FakeGeminiClient:
    def __init__(self):
        self.prompts = []

    def create_chat_completion(self, prompt):
        self.prompts.append(prompt)
        return GeminiCompletion(
            text="Gemini response",
            token_usage=TokenUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15, thoughts_tokens=0),
        )

    def stream_chat_completion(self, prompt):
        self.prompts.append(prompt)
        yield "Gemini "
        yield "stream"


class FakeTrainerIntelligenceService:
    def assemble_prompt_context(self, **kwargs):
        del kwargs
        return TrainerIntelligencePromptContext(
            system_appendix="TRAINER_INTELLIGENCE_CONTEXT_BEGIN\nrule_1: test",
            user_appendix="Resolved client profile snapshot for this response: {'primary_goal': 'strength'}",
            metadata={"used": True, "memory_count": 1},
        )


class ConversationOrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.repository = FakeConversationRepository()
        self.trainer_context = TrainerContext(
            tenant_id="tenant-1",
            trainer_id="trainer-1",
            trainer_user_id="trainer-user-1",
            trainer_display_name="Coach Maya",
            client_id="client-1",
            client_user_id="client-user-1",
        )
        self.request = ChatRequest(
            message="Adjust my workout for today",
            client_context={"entrypoint": "generated_workout"},
        )

    def _build_service(self, orchestration_service):
        with patch("app.modules.conversation.service.GeminiClient", return_value=FakeGeminiClient()):
            return ConversationService(
                self.repository,
                FakeProfileService(),
                FakeTrainerReviewService(),
                FakeTrainerPersonaRepository(),
                trainer_intelligence_service=orchestration_service,
            )

    def test_orchestration_flag_off_keeps_prompt_without_layered_context(self):
        service = self._build_service(FakeTrainerIntelligenceService())
        with patch("app.modules.conversation.service.settings.trainer_intelligence_orchestration_enabled", False):
            service.handle_chat("user-1", self.trainer_context, self.request)

        prompt = service.gemini_client.prompts[0]
        self.assertNotIn("TRAINER_INTELLIGENCE_CONTEXT_BEGIN", prompt)
        assistant_message_payload = self.repository.saved_messages[-1]["structured_payload"]
        self.assertEqual(assistant_message_payload["orchestration"]["fallback_reason"], "flag_disabled")

    def test_orchestration_flag_on_injects_layered_context_and_metadata(self):
        service = self._build_service(FakeTrainerIntelligenceService())
        with patch("app.modules.conversation.service.settings.trainer_intelligence_orchestration_enabled", True):
            service.handle_chat("user-1", self.trainer_context, self.request)

        prompt = service.gemini_client.prompts[0]
        self.assertIn("TRAINER_INTELLIGENCE_CONTEXT_BEGIN", prompt)
        assistant_message_payload = self.repository.saved_messages[-1]["structured_payload"]
        self.assertTrue(assistant_message_payload["orchestration"]["used"])
        self.assertEqual(assistant_message_payload["orchestration"]["memory_count"], 1)


if __name__ == "__main__":
    unittest.main()
