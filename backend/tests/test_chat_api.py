import json
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
from app.core.config import settings
from app.core.dependencies import get_conversation_service, get_trainer_context
from app.core.rate_limit import _rate_limiter
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.conversation.schemas import ChatResponse, ConversationState, ConversationUsage, RouteDebug, TokenUsage
from app.modules.conversation.service import ConversationProcessingError


def _sse_event_types(text: str) -> list[str]:
    return [
        line.replace("event: ", "", 1)
        for line in text.splitlines()
        if line.startswith("event: ")
    ]


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
                selected_model="gemini-2.5-flash-lite",
                execution_provider="gemini",
                execution_model="gemini-2.5-flash-lite",
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
                last_execution_model="gemini-2.5-flash-lite",
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
                selected_model="gemini-2.5-flash-lite",
                execution_provider="gemini",
                execution_model="gemini-2.5-flash-lite",
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
                        last_execution_model="gemini-2.5-flash-lite",
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
                selected_model="gemini-2.5-flash-lite",
                execution_provider="gemini",
                execution_model="gemini-2.5-flash-lite",
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


class RecordingStreamPersistenceService:
    def __init__(self):
        self.calls = []
        self.appended_events = []
        self.status_updates = []
        self.stream_request_id = None
        self.created_request_id = None

    def stream_chat_events(self, user_id, trainer_context, request):
        del user_id, trainer_context
        self.stream_request_id = str(request.request_id)
        self.calls.append("yield_status_without_conversation")
        yield {
            "type": "status",
            "stage": "reading_user_message",
            "message": "Reading...",
        }
        self.calls.append("yield_status_loading_with_conversation")
        yield {
            "type": "status",
            "stage": "loading_client_profile",
            "message": "Loading...",
            "conversation_id": "convo-123",
        }
        self.calls.append("yield_status_writing_with_conversation")
        yield {
            "type": "status",
            "stage": "writing_final_coach_response",
            "message": "Writing...",
            "conversation_id": "convo-123",
        }
        self.calls.append("yield_token_payload")
        yield {
            "type": "token",
            "content": "first token",
            "conversation_id": "convo-123",
        }
        self.calls.append("yield_done_payload")
        yield {
            "type": "done",
            "conversation_id": "convo-123",
            "assistant_message": "first token",
            "token_usage": {},
            "conversation_usage": None,
            "_trace": {
                "route": "FAST_PATH",
                "model_used": "gemini-2.5-flash-lite",
                "fallback_used": False,
            },
        }

    def create_ai_request_record(self, *, conversation_id, trainer_context, request, metadata=None):
        del trainer_context, metadata
        self.calls.append("create_ai_request_record")
        self.created_request_id = str(request.request_id)
        return {
            "id": self.created_request_id,
            "conversation_id": conversation_id,
        }

    def append_ai_request_event(self, *, request_id, seq, event_type, stage=None, payload=None):
        self.calls.append(f"append:{event_type}")
        self.appended_events.append(
            {
                "request_id": request_id,
                "seq": seq,
                "event_type": event_type,
                "stage": stage,
                "payload": payload or {},
            }
        )

    def update_ai_request_status(
        self,
        *,
        request_id,
        status,
        latest_event_seq=None,
        completed_message_id=None,
        error_detail=None,
    ):
        self.calls.append(f"status:{status}")
        self.status_updates.append(
            {
                "request_id": request_id,
                "status": status,
                "latest_event_seq": latest_event_seq,
                "completed_message_id": completed_message_id,
                "error_detail": error_detail,
            }
        )


class ChatApiTests(unittest.TestCase):
    def setUp(self):
        self._original_rate_limit_enabled = settings.rate_limit_enabled
        self._original_rate_limit_window_seconds = settings.rate_limit_window_seconds
        self._original_rate_limit_chat_per_window = settings.rate_limit_chat_per_window
        settings.rate_limit_enabled = True
        settings.rate_limit_window_seconds = 60
        settings.rate_limit_chat_per_window = 30
        _rate_limiter._windows.clear()
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
            client_user_id="user-123",
            persona_id="persona-123",
            persona_name="Strength Coach",
        )
        self.client = TestClient(app)

    def tearDown(self):
        settings.rate_limit_enabled = self._original_rate_limit_enabled
        settings.rate_limit_window_seconds = self._original_rate_limit_window_seconds
        settings.rate_limit_chat_per_window = self._original_rate_limit_chat_per_window
        _rate_limiter._windows.clear()
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

    def test_chat_emits_structured_trace(self):
        app.dependency_overrides[get_conversation_service] = lambda: FakeConversationService()

        with self.assertLogs("app.modules.conversation.trace", level="INFO") as logs:
            response = self.client.post(
                "/api/v1/chat",
                json={"message": "Hello"},
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200)
        joined = "\n".join(logs.output)
        self.assertIn('"event": "chat_trace"', joined)
        self.assertIn('"time_to_first_token_ms"', joined)
        self.assertIn('"model_used": "gemini-2.5-flash-lite"', joined)

    def test_stream_hides_route_debug_and_emits_error_event(self):
        app.dependency_overrides[get_conversation_service] = lambda: ExplodingConversationService()

        response = self.client.post(
            "/api/v1/chat/stream",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(_sse_event_types(response.text)[0], "status")
        self.assertNotIn('"route_debug"', response.text)
        self.assertIn('"type": "error"', response.text)
        self.assertIn("Something went wrong. Your trainer has been notified.", response.text)
        self.assertIn('"retry": true', response.text)

    def test_stream_emits_status_delta_done_contract(self):
        app.dependency_overrides[get_conversation_service] = lambda: FakeConversationService()

        response = self.client.post(
            "/api/v1/chat/stream",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        event_types = _sse_event_types(response.text)
        self.assertEqual(event_types[0], "status")
        self.assertEqual(event_types.count("status"), 1)
        self.assertIn("token", event_types)
        self.assertIn("message_delta", event_types)
        self.assertIn("done", event_types)
        self.assertTrue(set(event_types).issubset({"status", "token", "message_delta", "done", "error"}))
        self.assertLess(event_types.index("status"), event_types.index("token"))
        self.assertLess(event_types.index("token"), event_types.index("message_delta"))
        self.assertIn('"content": "hello"', response.text)
        self.assertIn('"delta": "hello"', response.text)
        self.assertIn('"assistant_message": "hello"', response.text)

    def test_stream_defers_request_persistence_until_after_first_token(self):
        service = RecordingStreamPersistenceService()
        app.dependency_overrides[get_conversation_service] = lambda: service

        response = self.client.post(
            "/api/v1/chat/stream",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn('"content": "first token"', response.text)
        event_types = _sse_event_types(response.text)
        self.assertEqual(event_types.count("status"), 1)
        self.assertLess(event_types.index("status"), event_types.index("token"))
        self.assertLess(event_types.index("token"), event_types.index("done"))
        self.assertEqual(service.stream_request_id, service.created_request_id)
        self.assertGreater(
            service.calls.index("create_ai_request_record"),
            service.calls.index("yield_token_payload"),
        )
        self.assertNotIn("append:status", service.calls)
        self.assertNotIn("append:token", service.calls)
        self.assertNotIn("append:message_delta", service.calls)
        self.assertIn("status:streaming", service.calls)
        self.assertIn("append:done", service.calls)
        self.assertIn("status:completed", service.calls)

    def test_stream_emits_sanitized_api_timing_diagnostics(self):
        service = RecordingStreamPersistenceService()
        app.dependency_overrides[get_conversation_service] = lambda: service

        with self.assertLogs("app.api.v1.chat", level="WARNING") as logs:
            response = self.client.post(
                "/api/v1/chat/stream",
                json={"message": "Hello sensitive text"},
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn('"content": "first token"', response.text)
        timing_lines = [line for line in logs.output if '"event": "chat_stream_api_timing"' in line]
        self.assertEqual(len(timing_lines), 1)
        payload = json.loads(timing_lines[0].split(":", 2)[2])
        self.assertEqual(payload["event"], "chat_stream_api_timing")
        self.assertEqual(payload["tenant_id"], "tenant-123")
        self.assertEqual(payload["trainer_id"], "trainer-123")
        self.assertEqual(payload["client_id"], "client-123")
        self.assertEqual(payload["conversation_id"], "convo-123")
        self.assertEqual(payload["route"], "FAST_PATH")
        self.assertEqual(payload["provider"], "gemini")
        self.assertEqual(payload["model"], "gemini-2.5-flash-lite")
        self.assertFalse(payload["fallback_used"])
        self.assertIsInstance(payload["request_to_endpoint_ms"], int)
        self.assertIsInstance(payload["endpoint_to_response_ms"], int)
        self.assertIsInstance(payload["request_to_generator_start_ms"], int)
        self.assertIsInstance(payload["first_event_encoded_ms"], int)
        self.assertIsInstance(payload["first_token_encoded_ms"], int)
        self.assertIsInstance(payload["first_token_yielded_ms"], int)
        self.assertIsInstance(payload["first_token_resume_ms"], int)
        self.assertIsInstance(payload["endpoint_to_first_token_yielded_ms"], int)
        self.assertIsInstance(payload["total_stream_ms"], int)
        self.assertGreaterEqual(payload["event_count"], 3)
        self.assertGreaterEqual(payload["token_event_count"], 1)
        self.assertEqual(payload["pre_token_status_sent_count"], 1)
        self.assertEqual(payload["pre_token_status_suppressed_count"], 2)
        self.assertIsInstance(payload["first_status_resume_ms"], int)
        self.assertIsInstance(payload["max_pre_token_resume_gap_ms"], int)
        self.assertTrue(payload["done_seen"])
        self.assertFalse(payload["error_seen"])
        joined_logs = "\n".join(logs.output)
        self.assertNotIn("Hello sensitive text", joined_logs)
        self.assertNotIn("first token", joined_logs)

    def test_chat_maps_unexpected_failure_to_controlled_502(self):
        app.dependency_overrides[get_conversation_service] = lambda: UnexpectedExplodingConversationService()

        response = self.client.post(
            "/api/v1/chat",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "Chat response could not be completed")

    def test_chat_enforces_rate_limit(self):
        settings.rate_limit_chat_per_window = 1
        app.dependency_overrides[get_conversation_service] = lambda: FakeConversationService()

        first = self.client.post(
            "/api/v1/chat",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )
        second = self.client.post(
            "/api/v1/chat",
            json={"message": "Hello again"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.json()["detail"]["detail"], "Rate limit exceeded")
        self.assertEqual(second.json()["detail"]["group"], "chat")
        self.assertGreaterEqual(second.json()["detail"]["retry_after_seconds"], 1)

    def test_stream_maps_unexpected_failure_to_error_event(self):
        app.dependency_overrides[get_conversation_service] = lambda: UnexpectedExplodingConversationService()

        response = self.client.post(
            "/api/v1/chat/stream",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(_sse_event_types(response.text)[0], "status")
        self.assertEqual(_sse_event_types(response.text).count("status"), 1)
        self.assertIn('"type": "error"', response.text)
        self.assertIn('"detail": "Chat response could not be completed"', response.text)


if __name__ == "__main__":
    unittest.main()
