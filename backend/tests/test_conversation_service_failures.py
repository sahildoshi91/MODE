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
from app.modules.conversation.schemas import ChatRequest
from app.modules.conversation.service import ConversationProcessingError, ConversationService


class BaseConversationRepository:
    def __init__(self):
        self.saved_messages = []

    def get_conversation(self, conversation_id):
        del conversation_id
        return None

    def find_active_conversation(self, client_id, trainer_id):
        del client_id, trainer_id
        return None

    def create_conversation(self, trainer_id, client_id, conversation_type, stage):
        del conversation_type, stage
        return {"id": "convo-123", "trainer_id": trainer_id, "client_id": client_id}

    def save_message(self, conversation_id, role, message_text, structured_payload=None):
        payload = {
            "id": f"msg-{len(self.saved_messages) + 1}",
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


class BrokenConversationRepository(BaseConversationRepository):
    def find_active_conversation(self, client_id, trainer_id):
        del client_id, trainer_id
        raise RuntimeError("database lookup failed")


class CreateConversationBrokenRepository(BaseConversationRepository):
    def create_conversation(self, trainer_id, client_id, conversation_type, stage):
        del trainer_id, client_id, conversation_type, stage
        raise RuntimeError("conversation insert failed")


class WorkingProfileService:
    def get_or_create_profile(self, client_id):
        return {
            "client_id": client_id,
            "primary_goal": "strength",
            "experience_level": "intermediate",
            "equipment_access": "gym",
        }


class BrokenProfileService:
    def get_or_create_profile(self, client_id):
        del client_id
        raise RuntimeError("profile lookup failed")


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


class ConversationServiceFailureTests(unittest.TestCase):
    def setUp(self):
        self.trainer_context = TrainerContext(
            tenant_id="tenant-123",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id="client-123",
            persona_id="persona-123",
            persona_name="Strength Coach",
        )
        self.request = ChatRequest(
            message="What should I do today?",
            client_context={"platform": "ios"},
        )

    def test_handle_chat_wraps_profile_lookup_failures(self):
        repository = BaseConversationRepository()
        service = ConversationService(
            repository,
            BrokenProfileService(),
            FakeTrainerReviewService(),
            FakeTrainerPersonaRepository(),
        )

        with self.assertRaisesRegex(ConversationProcessingError, "Chat response could not be completed"):
            service.handle_chat("user-123", self.trainer_context, self.request)

        self.assertEqual(repository.saved_messages, [])

    def test_stream_chat_wraps_conversation_lookup_failures(self):
        repository = BrokenConversationRepository()
        service = ConversationService(
            repository,
            WorkingProfileService(),
            FakeTrainerReviewService(),
            FakeTrainerPersonaRepository(),
        )

        with self.assertRaisesRegex(ConversationProcessingError, "Chat response could not be completed"):
            service.stream_chat("user-123", self.trainer_context, self.request)

        self.assertEqual(repository.saved_messages, [])

    def test_handle_chat_wraps_conversation_create_failures(self):
        repository = CreateConversationBrokenRepository()
        service = ConversationService(
            repository,
            WorkingProfileService(),
            FakeTrainerReviewService(),
            FakeTrainerPersonaRepository(),
        )

        with self.assertRaisesRegex(ConversationProcessingError, "Chat response could not be completed"):
            service.handle_chat("user-123", self.trainer_context, self.request)

        self.assertEqual(repository.saved_messages, [])


if __name__ == "__main__":
    unittest.main()
