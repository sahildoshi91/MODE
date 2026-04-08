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

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_conversation_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.conversation.schemas import ChatResponse, ConversationState, ConversationUsage, RouteDebug, TokenUsage
from app.modules.conversation.service import ConversationProcessingError


class FakeConversationService:
    def handle_chat(self, user_id, trainer_context, request):
        del user_id, trainer_context, request
        return ChatResponse(
            conversation_id="convo-123",
            assistant_message="hello",
            conversation_state=ConversationState(current_stage="default_fast", onboarding_complete=False),
            token_usage=TokenUsage(total_tokens=12, prompt_tokens=8, completion_tokens=4),
            route_debug=RouteDebug(
                selected_provider="gemini",
                selected_model="gemini-2.5-flash",
                execution_provider="gemini",
                execution_model="gemini-2.5-flash",
                flow="default_fast",
                reason="default",
                task_type="qa_quick",
                response_mode="direct_answer",
            ),
            conversation_usage=ConversationUsage(
                conversation_id="convo-123",
                total_tokens=12,
                usage_event_count=1,
                last_execution_provider="gemini",
                last_execution_model="gemini-2.5-flash",
            ),
        )

    def stream_chat(self, user_id, trainer_context, request):
        del user_id, trainer_context, request

        def iterator():
            yield "hello"

        return (
            "convo-123",
            iterator(),
            RouteDebug(
                selected_provider="gemini",
                selected_model="gemini-2.5-flash",
                execution_provider="gemini",
                execution_model="gemini-2.5-flash",
                flow="default_fast",
                reason="default",
                task_type="qa_quick",
                response_mode="direct_answer",
            ),
            type(
                "StreamState",
                (),
                {
                    "token_usage": TokenUsage(total_tokens=12, prompt_tokens=8, completion_tokens=4),
                    "conversation_usage": ConversationUsage(
                        conversation_id="convo-123",
                        total_tokens=12,
                        usage_event_count=1,
                        last_execution_provider="gemini",
                        last_execution_model="gemini-2.5-flash",
                    ),
                },
            )(),
        )


class ExplodingConversationService(FakeConversationService):
    def handle_chat(self, user_id, trainer_context, request):
        del user_id, trainer_context, request
        raise ConversationProcessingError("Chat response could not be completed")

    def stream_chat(self, user_id, trainer_context, request):
        del user_id, trainer_context, request

        def iterator():
            raise ConversationProcessingError("Chat response could not be completed")
            yield ""

        return (
            "convo-123",
            iterator(),
            RouteDebug(
                selected_provider="gemini",
                selected_model="gemini-2.5-flash",
                execution_provider="gemini",
                execution_model="gemini-2.5-flash",
                flow="default_fast",
                reason="default",
                task_type="qa_quick",
                response_mode="direct_answer",
            ),
            type("StreamState", (), {"token_usage": TokenUsage(), "conversation_usage": None})(),
        )


class UnexpectedExplodingConversationService(FakeConversationService):
    def handle_chat(self, user_id, trainer_context, request):
        del user_id, trainer_context, request
        raise RuntimeError("Unexpected backend failure")

    def stream_chat(self, user_id, trainer_context, request):
        del user_id, trainer_context, request
        raise RuntimeError("Unexpected stream backend failure")


class ChatApiTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="user-123",
            email="user@example.com",
            access_token="token-123",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-123",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id="client-123",
            persona_id="persona-123",
            persona_name="Strength Coach",
        )
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_chat_hides_route_debug_by_default(self):
        app.dependency_overrides[get_conversation_service] = lambda: FakeConversationService()

        response = self.client.post(
            "/api/v1/chat",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["route_debug"])

    def test_chat_exposes_route_debug_when_enabled(self):
        app.dependency_overrides[get_conversation_service] = lambda: FakeConversationService()

        with patch("app.api.v1.chat.settings.expose_route_debug", True):
            response = self.client.post(
                "/api/v1/chat",
                json={"message": "Hello"},
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["route_debug"]["selected_provider"], "gemini")

    def test_chat_returns_502_on_processing_error(self):
        app.dependency_overrides[get_conversation_service] = lambda: ExplodingConversationService()

        response = self.client.post(
            "/api/v1/chat",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "Chat response could not be completed")

    def test_stream_hides_route_debug_and_emits_error_event(self):
        app.dependency_overrides[get_conversation_service] = lambda: ExplodingConversationService()

        response = self.client.post(
            "/api/v1/chat/stream",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn('"type": "start"', response.text)
        self.assertNotIn('"route_debug"', response.text)
        self.assertIn('"type": "error"', response.text)

    def test_chat_maps_unexpected_failure_to_controlled_502(self):
        app.dependency_overrides[get_conversation_service] = lambda: UnexpectedExplodingConversationService()

        response = self.client.post(
            "/api/v1/chat",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "Chat response could not be completed")

    def test_stream_maps_unexpected_failure_to_controlled_502(self):
        app.dependency_overrides[get_conversation_service] = lambda: UnexpectedExplodingConversationService()

        response = self.client.post(
            "/api/v1/chat/stream",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "Chat response could not be completed")


if __name__ == "__main__":
    unittest.main()
