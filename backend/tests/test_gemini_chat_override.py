import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.ai.client import GeminiCompletion, TokenUsage
from app.core.tenancy import TrainerContext
from app.modules.conversation.schemas import ChatRequest
from app.modules.conversation.service import ConversationService


class FakeConversationRepository:
    def __init__(self):
        self.created_conversation = {
            "id": "convo-123",
            "trainer_id": "trainer-123",
            "client_id": "client-123",
        }
        self.saved_messages = []
        self.updated_states = []
        self.usage_events = []
        self.history = [
            {"role": "user", "message_text": "I want to get stronger."},
            {"role": "assistant", "message_text": "How many days can you train?"},
        ]

    def get_conversation(self, conversation_id):
        if conversation_id == self.created_conversation["id"]:
            return self.created_conversation
        return None

    def find_active_conversation(self, client_id, trainer_id):
        del client_id, trainer_id
        return None

    def create_conversation(self, trainer_id, client_id, conversation_type, stage):
        self.created_conversation.update(
            {
                "trainer_id": trainer_id,
                "client_id": client_id,
                "type": conversation_type,
                "current_stage": stage,
            }
        )
        return self.created_conversation

    def save_message(self, conversation_id, role, message_text, structured_payload=None):
        message = {
            "id": f"msg-{len(self.saved_messages) + 1}",
            "conversation_id": conversation_id,
            "role": role,
            "message_text": message_text,
            "structured_payload": structured_payload,
        }
        self.saved_messages.append(message)
        return message

    def list_messages(self, conversation_id, limit=20):
        del conversation_id, limit
        return list(self.history)

    def update_conversation_state(self, conversation_id, stage, onboarding_complete):
        self.updated_states.append(
            {
                "conversation_id": conversation_id,
                "stage": stage,
                "onboarding_complete": onboarding_complete,
            }
        )

    def record_usage_event(self, **kwargs):
        payload = {"id": f"usage-{len(self.usage_events) + 1}", **kwargs}
        self.usage_events.append(payload)
        return payload

    def get_conversation_usage_summary(self, conversation_id):
        relevant = [event for event in self.usage_events if event["conversation_id"] == conversation_id]
        if not relevant:
            return None
        return {
            "conversation_id": conversation_id,
            "total_prompt_tokens": sum(event["prompt_tokens"] for event in relevant),
            "total_completion_tokens": sum(event["completion_tokens"] for event in relevant),
            "total_tokens": sum(event["total_tokens"] for event in relevant),
            "total_thoughts_tokens": sum(event["thoughts_tokens"] for event in relevant),
            "usage_event_count": len(relevant),
            "last_execution_provider": relevant[-1]["provider"],
            "last_execution_model": relevant[-1]["model"],
            "models_used": sorted({event["model"] for event in relevant}),
            "providers_used": sorted({event["provider"] for event in relevant}),
            "last_usage_at": "2026-03-26T00:00:00Z",
        }


class FakeProfileService:
    def get_or_create_profile(self, client_id):
        return {
            "client_id": client_id,
            "primary_goal": "strength",
            "experience_level": "intermediate",
            "equipment_access": "gym",
        }

    def upsert_profile_patch(self, client_id, profile_patch):
        del client_id, profile_patch
        raise AssertionError("Profile patching is not part of this chat path")


class FakeTrainerReviewService:
    def __init__(self):
        self.queued = []

    def queue_unanswered_question(self, **kwargs):
        self.queued.append(kwargs)


class FakeGeminiClient:
    def __init__(self):
        self.prompts = []

    def create_chat_completion(self, prompt):
        self.prompts.append(prompt)
        return GeminiCompletion(
            text="Gemini says hello",
            token_usage=TokenUsage(
                prompt_tokens=123,
                completion_tokens=21,
                total_tokens=144,
                thoughts_tokens=0,
            ),
        )

    def stream_chat_completion(self, prompt):
        self.prompts.append(prompt)
        yield "Gemini "
        yield "stream"


class FakeOpenAIClient:
    def __init__(self):
        self.calls = []

    def create_chat_completion_with_usage(self, model, messages):
        self.calls.append({"model": model, "messages": messages})
        return GeminiCompletion(
            text="GPT says hello",
            token_usage=TokenUsage(
                prompt_tokens=90,
                completion_tokens=15,
                total_tokens=105,
                thoughts_tokens=0,
            ),
        )


class FakeAnthropicClient:
    def __init__(self):
        self.calls = []
        self.stream_calls = []

    def create_chat_completion(self, model, system_prompt, user_prompt):
        self.calls.append(
            {
                "model": model,
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
            }
        )
        return GeminiCompletion(
            text="Claude says hello",
            token_usage=TokenUsage(
                prompt_tokens=70,
                completion_tokens=18,
                total_tokens=88,
                thoughts_tokens=0,
            ),
        )

    def stream_chat_completion(self, model, system_prompt, user_prompt):
        self.stream_calls.append(
            {
                "model": model,
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
            }
        )
        yield "Claude "
        yield "stream"


class ConversationServiceRoutingTests(unittest.TestCase):
    def setUp(self):
        self.repository = FakeConversationRepository()
        self.profile_service = FakeProfileService()
        self.trainer_review_service = FakeTrainerReviewService()
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
            conversation_id=None,
            message="I can train four days a week.",
            client_context={"platform": "ios"},
        )

    def _build_service(self, anthropic_enabled=False):
        with patch("app.modules.conversation.service.GeminiClient", return_value=FakeGeminiClient()):
            with patch("app.modules.conversation.service.OpenAIClient", return_value=FakeOpenAIClient()):
                with patch.object(sys.modules["app.modules.conversation.service"].settings, "anthropic_api_key", "test-anthropic-key" if anthropic_enabled else None):
                    with patch("app.modules.conversation.service.AnthropicClient", return_value=FakeAnthropicClient()):
                        return ConversationService(
                            self.repository,
                            self.profile_service,
                            self.trainer_review_service,
                        )

    def test_handle_chat_uses_default_fast_route_with_gemini(self):
        service = self._build_service()

        response = service.handle_chat("user-123", self.trainer_context, self.request)

        self.assertEqual(response.assistant_message, "Gemini says hello")
        self.assertEqual(response.conversation_id, "convo-123")
        self.assertEqual(response.conversation_state.current_stage, "default_fast")
        self.assertFalse(response.fallback_triggered)
        self.assertEqual(response.token_usage.prompt_tokens, 123)
        self.assertEqual(len(self.repository.saved_messages), 2)
        route_payload = self.repository.saved_messages[1]["structured_payload"]["route"]
        self.assertEqual(route_payload["model"], "gemini-2.5-flash")
        self.assertEqual(route_payload["execution_provider"], "gemini")
        self.assertEqual(route_payload["task_type"], "qa_quick")
        self.assertEqual(response.route_debug.selected_provider, "gemini")
        self.assertEqual(response.route_debug.execution_model, "gemini-2.5-flash")
        self.assertEqual(response.conversation_usage.total_tokens, 144)
        self.assertEqual(response.conversation_usage.last_execution_model, "gemini-2.5-flash")
        self.assertEqual(self.repository.created_conversation["type"], "chat")
        prompt = service.gemini_client.prompts[0]
        self.assertIn("Coach Alex", prompt)
        self.assertIn("Strength Coach", prompt)
        self.assertIn("I can train four days a week.", prompt)

    def test_stream_chat_yields_chunks_and_persists_full_response(self):
        service = self._build_service()

        conversation_id, chunks, route_debug, result_state = service.stream_chat("user-123", self.trainer_context, self.request)
        streamed = "".join(chunks)

        self.assertEqual(conversation_id, "convo-123")
        self.assertEqual(streamed, "Gemini stream")
        self.assertEqual(route_debug.execution_provider, "gemini")
        self.assertEqual(result_state.conversation_usage.total_tokens, 0)
        self.assertEqual(self.repository.saved_messages[-1]["message_text"], "Gemini stream")
        self.assertEqual(self.repository.updated_states[-1]["stage"], "default_fast")

    def test_risk_route_uses_openai_when_available(self):
        service = self._build_service()
        request = ChatRequest(
            message="I felt chest pain and got dizzy during my workout. What should I do?",
            client_context={},
        )

        response = service.handle_chat("user-123", self.trainer_context, request)

        self.assertEqual(response.assistant_message, "GPT says hello")
        self.assertEqual(response.conversation_state.current_stage, "safety_constrained")
        self.assertFalse(response.fallback_triggered)
        self.assertEqual(response.route_debug.selected_model, "gpt-5.4-mini")
        self.assertEqual(response.route_debug.execution_provider, "openai")
        self.assertEqual(response.conversation_usage.total_tokens, 105)
        self.assertEqual(service.openai_client.calls[0]["model"], "gpt-5.4-mini")

    def test_persona_route_falls_back_when_claude_not_configured(self):
        service = self._build_service()
        request = ChatRequest(
            message="Coach, I'm feeling guilty and unmotivated. Give me the tough-love version.",
            client_context={"trainer_persona_requested": True, "retrieval_confidence": 0.3},
        )

        response = service.handle_chat("user-123", self.trainer_context, request)

        self.assertEqual(response.assistant_message, "Gemini says hello")
        self.assertEqual(response.conversation_state.current_stage, "persona_coach")
        self.assertTrue(response.fallback_triggered)
        self.assertEqual(len(self.trainer_review_service.queued), 1)
        route_payload = self.repository.saved_messages[-1]["structured_payload"]["route"]
        self.assertEqual(route_payload["model"], "claude-sonnet-4.6")
        self.assertEqual(route_payload["execution_model"], "gemini-2.5-flash")
        self.assertEqual(route_payload["fallback_reason"], "anthropic_client_not_configured")
        self.assertEqual(response.route_debug.selected_provider, "anthropic")
        self.assertEqual(response.route_debug.execution_provider, "gemini")
        self.assertEqual(response.conversation_usage.last_execution_provider, "gemini")

    def test_persona_route_uses_anthropic_when_configured(self):
        service = self._build_service(anthropic_enabled=True)
        request = ChatRequest(
            message="Coach, I'm frustrated and need the tough-love version.",
            client_context={"trainer_persona_requested": True, "retrieval_confidence": 0.9},
        )

        response = service.handle_chat("user-123", self.trainer_context, request)

        self.assertEqual(response.assistant_message, "Claude says hello")
        self.assertFalse(response.fallback_triggered)
        self.assertEqual(response.route_debug.selected_provider, "anthropic")
        self.assertEqual(response.route_debug.execution_provider, "anthropic")
        self.assertEqual(response.route_debug.execution_model, "claude-sonnet-4-20250514")
        self.assertEqual(response.conversation_usage.total_tokens, 88)
        self.assertEqual(service.anthropic_client.calls[0]["model"], "claude-sonnet-4-20250514")

    def test_handle_chat_rejects_unknown_conversation_id(self):
        service = self._build_service()
        request = ChatRequest(
            conversation_id=uuid4(),
            message="I can train four days a week.",
            client_context={"platform": "ios"},
        )

        with self.assertRaisesRegex(ValueError, "Conversation not found"):
            service.handle_chat("user-123", self.trainer_context, request)

    def test_handle_chat_rejects_conversation_outside_active_trainer_context(self):
        service = self._build_service()
        self.repository.created_conversation.update(
            {
                "id": "00000000-0000-0000-0000-000000000123",
                "trainer_id": "trainer-other",
                "client_id": "client-123",
            }
        )
        request = ChatRequest(
            conversation_id="00000000-0000-0000-0000-000000000123",
            message="I can train four days a week.",
            client_context={"platform": "ios"},
        )

        with self.assertRaisesRegex(ValueError, "Conversation does not belong to the active trainer context"):
            service.handle_chat("user-123", self.trainer_context, request)


if __name__ == "__main__":
    unittest.main()
