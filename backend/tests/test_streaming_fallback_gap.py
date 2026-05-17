import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.tenancy import TrainerContext
from app.modules.conversation.orchestration import provider_fallback_chain
from app.modules.conversation.routing import GPT_5_4_MODEL, GPT_5_4_MINI_MODEL, RoutingDecision
from app.modules.conversation.schemas import ChatRequest
from app.modules.conversation.service import STREAM_FALLBACK_STATUS_MESSAGE, STREAM_INTERRUPTED_MESSAGE, ConversationService


class FakeConversationRepository:
    def __init__(self):
        self.saved_messages = []
        self.usage_events = []

    def get_conversation(self, conversation_id):
        del conversation_id
        return None

    def find_active_conversation(self, client_id, trainer_id, preferred_types=None, fallback_to_any=True):
        del client_id, trainer_id, preferred_types, fallback_to_any
        return None

    def create_conversation(self, trainer_id, client_id, conversation_type, stage):
        del conversation_type, stage
        return {"id": "conversation-1", "trainer_id": trainer_id, "client_id": client_id}

    def save_message(self, conversation_id, role, message_text, structured_payload=None, **kwargs):
        del kwargs
        row = {
            "id": f"message-{len(self.saved_messages) + 1}",
            "conversation_id": conversation_id,
            "role": role,
            "message_text": message_text,
            "structured_payload": structured_payload or {},
        }
        self.saved_messages.append(row)
        return row

    def list_messages(self, conversation_id, limit=20):
        del conversation_id, limit
        return [
            {"id": row["id"], "role": row["role"], "message_text": row["message_text"]}
            for row in self.saved_messages
        ]

    def update_conversation_state(self, conversation_id, stage, onboarding_complete):
        del conversation_id, stage, onboarding_complete

    def record_usage_event(self, **kwargs):
        self.usage_events.append(kwargs)
        return {"id": f"usage-{len(self.usage_events)}", **kwargs}

    def get_conversation_usage_summary(self, conversation_id):
        del conversation_id
        return None


class FakeProfileService:
    def get_or_create_profile(self, client_id):
        return {"client_id": client_id, "primary_goal": "strength"}


class FakeTrainerReviewService:
    def queue_unanswered_question(self, **kwargs):
        return {"id": "queue-1", **kwargs}


class FakeTrainerPersonaRepository:
    pass


class ScriptedOpenAIClient:
    def __init__(self, scripts):
        self.scripts = list(scripts)
        self.stream_calls = []

    def stream_chat_completion(self, *, model, messages, max_output_tokens=None, stream_timing_observer=None):
        del messages, max_output_tokens, stream_timing_observer
        self.stream_calls.append(model)
        script = self.scripts.pop(0)
        if isinstance(script, BaseException):
            raise script
        return _scripted_stream(script)


class ScriptedAnthropicClient:
    def __init__(self, scripts):
        self.scripts = list(scripts)
        self.stream_calls = []

    def stream_chat_completion(
        self,
        model,
        system_prompt,
        user_prompt,
        *,
        max_output_tokens=None,
        stream_timing_observer=None,
    ):
        del system_prompt, user_prompt, max_output_tokens, stream_timing_observer
        self.stream_calls.append(model)
        script = self.scripts.pop(0)
        if isinstance(script, BaseException):
            raise script
        return _scripted_stream(script)


def _scripted_stream(script):
    for item in script:
        if isinstance(item, BaseException):
            raise item
        if isinstance(item, tuple) and item[0] == "sleep":
            time.sleep(float(item[1]))
            continue
        yield str(item)


def trainer_context():
    return TrainerContext(
        tenant_id="tenant-1",
        trainer_id="trainer-1",
        trainer_user_id="trainer-user-1",
        trainer_display_name="Coach Test",
        client_id="client-1",
        client_user_id="client-user-1",
    )


class StreamingFallbackGapTests(unittest.TestCase):
    def _service(self, *, openai_scripts, anthropic_scripts=(("Fallback response.",),)):
        service = ConversationService(
            FakeConversationRepository(),
            FakeProfileService(),
            FakeTrainerReviewService(),
            FakeTrainerPersonaRepository(),
        )
        service.openai_client = ScriptedOpenAIClient(openai_scripts)
        service.anthropic_client = ScriptedAnthropicClient(anthropic_scripts)
        service.gemini_client = None
        return service

    def _events(self, service, message="What should I do today?"):
        with patch("app.modules.conversation.service.enqueue_post_chat_jobs", return_value=[]):
            return list(service.stream_chat_events("user-1", trainer_context(), ChatRequest(message=message)))

    def test_pre_open_failure_triggers_fallback(self):
        service = self._service(openai_scripts=[RuntimeError("provider 503")])

        events = self._events(service)

        self.assertIn(STREAM_FALLBACK_STATUS_MESSAGE, [event.get("message") for event in events])
        self.assertIn("Fallback response.", "".join(event.get("content", "") for event in events if event.get("type") == "token"))
        trace = [event for event in events if event.get("type") == "done"][-1]["_trace"]
        self.assertTrue(trace["stream_fallback_attempted"])
        self.assertEqual(trace["providers_attempted"][:2], ["openai:gpt-5.4-mini", "anthropic:claude-sonnet-4.6"])

    def test_first_byte_timeout_triggers_fallback_fast_path(self):
        service = self._service(openai_scripts=[[("sleep", 0.04), "late token"]])
        service._first_byte_timeout_seconds = lambda route: 0.01

        events = self._events(service)

        self.assertIn(STREAM_FALLBACK_STATUS_MESSAGE, [event.get("message") for event in events])
        trace = [event for event in events if event.get("type") == "done"][-1]["_trace"]
        self.assertTrue(trace["stream_fallback_attempted"])

    def test_first_byte_timeout_triggers_fallback_deep_path(self):
        service = self._service(
            openai_scripts=[
                [("sleep", 0.04), "late token"],
                [("sleep", 0.04), "late token"],
            ]
        )
        timeouts = []

        def timeout_for(route):
            timeouts.append(route.flow)
            return 0.01

        service._first_byte_timeout_seconds = timeout_for

        events = self._events(service, message="Build me an 8-week strength program with progression and constraints.")

        self.assertIn("reasoning_structured", timeouts)
        trace = [event for event in events if event.get("type") == "done"][-1]["_trace"]
        self.assertTrue(trace["stream_fallback_attempted"])

    def test_mid_stream_no_semantic_content_retries_cleanly(self):
        service = self._service(openai_scripts=[["Hel", RuntimeError("drop")]])

        events = self._events(service)

        token_text = "".join(event.get("content", "") for event in events if event.get("type") == "token")
        self.assertNotIn("Hel", token_text)
        self.assertIn("Fallback response.", token_text)
        self.assertFalse(any(event.get("type") == "error" for event in events))

    def test_mid_stream_semantic_content_committed_emits_error(self):
        service = self._service(openai_scripts=[["Hello ", RuntimeError("drop")]])

        events = self._events(service)

        error = [event for event in events if event.get("type") == "error"][-1]
        self.assertEqual(error["message"], STREAM_INTERRUPTED_MESSAGE)
        self.assertTrue(error["_trace"]["mid_stream_failure"])
        self.assertEqual(len(service.anthropic_client.stream_calls), 0)

    def test_all_providers_exhausted_emits_graceful_error(self):
        service = self._service(
            openai_scripts=[RuntimeError("openai down")],
            anthropic_scripts=[RuntimeError("anthropic down")],
        )

        events = self._events(service)

        error = [event for event in events if event.get("type") == "error"][-1]
        self.assertEqual(error["message"], STREAM_INTERRUPTED_MESSAGE)
        self.assertTrue(error["_trace"]["stream_fallback_attempted"])

    def test_safety_escalation_notifies_trainer_on_any_stream_failure(self):
        service = self._service(openai_scripts=[])
        route = RoutingDecision(
            task_type="safety_risk",
            model=GPT_5_4_MODEL,
            provider="openai",
            flow="safety_escalation",
            reason="sentry_safety",
            response_mode="safe_interim_escalation",
            risk_score=8,
            complexity_score=0,
            persona_score=0,
            structure_score=0,
            multimodal_score=0,
            retrieval_required=True,
            retrieval_confidence=1.0,
            needs_trainer_review=True,
            intent_route={"route": "SAFETY_ESCALATION", "notify_trainer": True},
        )
        with patch("app.modules.conversation.service.enqueue_post_chat_jobs", return_value=[]) as enqueue:
            service._enqueue_safety_stream_failure_notification_safely(
                trainer_context=trainer_context(),
                request=ChatRequest(message="My chest hurts during training"),
                conversation_id="conversation-1",
                route=route,
                assistant_message=None,
                user_message_id="message-1",
            )

        enqueue.assert_called_once()
        self.assertTrue(enqueue.call_args.kwargs["route_payload"]["needs_trainer_review"])

    def test_safety_escalation_never_routes_to_cheap_model(self):
        route = RoutingDecision(
            task_type="safety_risk",
            model=GPT_5_4_MODEL,
            provider="openai",
            flow="safety_escalation",
            reason="sentry_safety",
            response_mode="safe_interim_escalation",
            risk_score=8,
            complexity_score=0,
            persona_score=0,
            structure_score=0,
            multimodal_score=0,
            retrieval_required=True,
            retrieval_confidence=1.0,
            needs_trainer_review=True,
            intent_route={"route": "SAFETY_ESCALATION", "notify_trainer": True},
        )

        models = [attempt.model for attempt in provider_fallback_chain(route)]

        self.assertNotIn(GPT_5_4_MINI_MODEL, models)


if __name__ == "__main__":
    unittest.main()
