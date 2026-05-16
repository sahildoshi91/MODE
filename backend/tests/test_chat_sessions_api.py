import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.auth import AuthenticatedUser, require_user
from app.core.dependencies import get_chat_session_service, get_trainer_context
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.conversation.intent import IntentRouter
from app.modules.conversation.schemas import TokenUsage


def _sse_event_types(text: str) -> list[str]:
    return [
        line.replace("event: ", "", 1)
        for line in text.splitlines()
        if line.startswith("event: ")
    ]


def _session_payload():
    return {
        "id": "session-1",
        "user_id": "user-123",
        "trainer_id": "trainer-123",
        "client_id": "client-123",
        "client_name": "Taylor",
        "role": "client",
        "session_type": "client_chat",
        "session_date": "2026-05-04",
        "summary": "Opening brief",
        "title": "Today",
        "metadata": {},
        "created_at": "2026-05-04T12:00:00+00:00",
        "updated_at": "2026-05-04T12:00:00+00:00",
        "last_message_at": "2026-05-04T12:00:00+00:00",
        "read_only": False,
    }


class FakeChatSessionApiService:
    def __init__(self):
        self.conversation_service = type(
            "FakeConversationService",
            (),
            {"intent_router": IntentRouter(), "trainer_intelligence_service": None},
        )()
        self.persisted_ai_messages = []
        self.post_stream_side_effects = []
        self.event_order = []

    def list_history(self, **kwargs):
        del kwargs
        return {"sessions": [_session_payload()]}

    def get_or_create_today_session(self, **kwargs):
        del kwargs
        return {
            "session": _session_payload(),
            "messages": [
                {
                    "id": "message-1",
                    "session_id": "session-1",
                    "sender_type": "ai",
                    "content": "Hey Taylor, your current MODE is BUILD.",
                    "created_at": "2026-05-04T12:00:00+00:00",
                    "message_index": 0,
                    "metadata": {"auto_generated_opening_summary": True},
                }
            ],
            "suggested_actions": ["Finish a workout"],
            "read_only": False,
        }

    def prepare_stream(self, **kwargs):
        del kwargs
        self.event_order.append("prepare_stream")

        def chunks():
            yield "Good "
            yield "next move."

        return (
            _session_payload(),
            {
                "id": "user-message-1",
                "session_id": "session-1",
                "sender_type": "user",
                "content": "Reach step goal",
                "created_at": "2026-05-04T12:01:00+00:00",
                "message_index": 1,
                "metadata": {},
            },
            "conversation-1",
            chunks(),
            None,
            type("StreamState", (), {"token_usage": TokenUsage(), "conversation_usage": None})(),
        )

    def persist_streamed_ai_message(self, **kwargs):
        self.persisted_ai_messages.append(kwargs)
        return {
            "id": "ai-message-1",
            "session_id": "session-1",
            "sender_type": "ai",
            "content": kwargs.get("content"),
            "created_at": "2026-05-04T12:02:00+00:00",
            "message_index": 2,
            "metadata": kwargs.get("metadata") or {},
        }

    def persist_post_stream_side_effects(self, **kwargs):
        self.event_order.append("post_stream_side_effects")
        self.post_stream_side_effects.append(kwargs)


class MissingChatSessionStorageService(FakeChatSessionApiService):
    def get_or_create_today_session(self, **kwargs):
        del kwargs
        raise RuntimeError({
            "code": "PGRST205",
            "message": "Could not find the table 'public.chat_sessions' in the schema cache",
        })


class ChatSessionsApiTests(unittest.TestCase):
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
            client_user_id="user-123",
        )
        app.dependency_overrides[get_chat_session_service] = lambda: FakeChatSessionApiService()
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_history_endpoint_accepts_no_trailing_slash(self):
        response = self.client.get(
            "/api/v1/chat/sessions?role=client&session_type=client_chat&limit=1",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sessions"][0]["id"], "session-1")

    def test_history_emits_authenticated_preflight_timing(self):
        with self.assertLogs("app.api.v1.chat_sessions", level="WARNING") as logs:
            response = self.client.get(
                "/api/v1/chat/sessions?role=client&session_type=client_chat&limit=1",
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200)
        timing_lines = [line for line in logs.output if '"event": "authenticated_preflight_timing"' in line]
        self.assertEqual(len(timing_lines), 1)
        import json

        payload = json.loads(timing_lines[0].split(":", 2)[2])
        self.assertEqual(payload["endpoint"], "/api/v1/chat/sessions")
        self.assertEqual(payload["tenant_id"], "tenant-123")
        self.assertEqual(payload["trainer_id"], "trainer-123")
        self.assertEqual(payload["client_id"], "client-123")
        self.assertIsInstance(payload["redis_rate_limit_ms"], int)
        self.assertIsInstance(payload["session_fetch_or_create_ms"], int)
        self.assertIsInstance(payload["total_preflight_ms"], int)
        self.assertIsNone(payload["error_category"])

    def test_history_endpoint_accepts_trailing_slash(self):
        response = self.client.get(
            "/api/v1/chat/sessions/?role=client&session_type=client_chat&limit=1",
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sessions"][0]["id"], "session-1")

    def test_today_maps_missing_chat_session_storage_to_structured_503(self):
        app.dependency_overrides[get_chat_session_service] = lambda: MissingChatSessionStorageService()

        response = self.client.post(
            "/api/v1/chat/sessions/today",
            json={"role": "client", "session_type": "client_chat"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "CHAT_SESSION_SCHEMA_MISSING")
        self.assertEqual(
            response.json()["detail"]["message"],
            "Chat session storage is not migrated on this backend yet.",
        )

    def test_message_stream_uses_new_event_contract_and_persists_ai_once(self):
        fake_service = FakeChatSessionApiService()
        app.dependency_overrides[get_chat_session_service] = lambda: fake_service

        from app.modules.conversation.streaming import ChatStreamSseEncoder

        original_encode = ChatStreamSseEncoder.encode

        def recording_encode(encoder, payload, *args, **kwargs):
            if str(payload.get("type") or "") == "done":
                fake_service.event_order.append("done_encoded")
            return original_encode(encoder, payload, *args, **kwargs)

        with patch("app.api.v1.chat_sessions.ChatStreamSseEncoder.encode", recording_encode):
            response = self.client.post(
                "/api/v1/chat/sessions/session-1/messages/stream",
                json={"message": "Reach step goal"},
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200)
        event_types = _sse_event_types(response.text)
        self.assertEqual(event_types[0], "status")
        self.assertTrue(set(event_types).issubset({"status", "token", "message_delta", "done", "error"}))
        self.assertIn("token", event_types)
        self.assertIn("message_delta", event_types)
        self.assertIn("done", event_types)
        self.assertIn('"content": "Good "', response.text)
        self.assertIn('"assistant_message": "Good next move."', response.text)
        self.assertIn('"ai_message"', response.text)
        self.assertEqual(len(fake_service.persisted_ai_messages), 1)
        self.assertEqual(fake_service.persisted_ai_messages[0]["content"], "Good next move.")
        self.assertEqual(len(fake_service.post_stream_side_effects), 1)
        self.assertEqual(fake_service.post_stream_side_effects[0]["conversation_id"], "conversation-1")
        self.assertEqual(fake_service.post_stream_side_effects[0]["request"].message, "Reach step goal")
        self.assertEqual(fake_service.event_order[-2:], ["done_encoded", "post_stream_side_effects"])

    def test_message_stream_yields_first_status_before_context_loading(self):
        fake_service = FakeChatSessionApiService()
        app.dependency_overrides[get_chat_session_service] = lambda: fake_service

        from app.modules.conversation.streaming import ChatStreamSseEncoder

        original_encode = ChatStreamSseEncoder.encode

        def recording_encode(encoder, payload, *args, **kwargs):
            if str(payload.get("type") or "") == "status" and "first_status_encoded" not in fake_service.event_order:
                fake_service.event_order.append("first_status_encoded")
            return original_encode(encoder, payload, *args, **kwargs)

        with patch("app.api.v1.chat_sessions.ChatStreamSseEncoder.encode", recording_encode):
            response = self.client.post(
                "/api/v1/chat/sessions/session-1/messages/stream",
                json={"message": "Reach step goal"},
                headers={"Authorization": "Bearer ignored-by-override"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertLess(
            fake_service.event_order.index("first_status_encoded"),
            fake_service.event_order.index("prepare_stream"),
        )

    def test_message_stream_uses_intent_status_copy(self):
        fake_service = FakeChatSessionApiService()
        app.dependency_overrides[get_chat_session_service] = lambda: fake_service

        response = self.client.post(
            "/api/v1/chat/sessions/session-1/messages/stream",
            json={"message": "Reach step goal"},
            headers={"Authorization": "Bearer ignored-by-override"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn('"message": "Reading your message..."', response.text)
        self.assertIn('"message": "Checking your latest coaching context..."', response.text)


if __name__ == "__main__":
    unittest.main()
