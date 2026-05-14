import json
import os
import sys
import time
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
from app.core.config import settings
from app.core.tenancy import TrainerContext
from app.modules.conversation.schemas import ChatRequest
from app.modules.conversation.service import (
    SAFETY_ESCALATION_HOLDING_RESPONSE,
    ConversationProcessingError,
    ConversationService,
)
from app.modules.trainer_persona.repository import TrainerPersonaRepository
from app.modules.trainer_onboarding.repository import TrainerOnboardingStorageUnavailableError
from app.modules.trainer_onboarding.service import TrainerOnboardingTurnResult


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
        self.metadata_updates = []
        self.system_events = []
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
        return list(self.history) + [
            {
                "id": message["id"],
                "role": message["role"],
                "message_text": message["message_text"],
            }
            for message in self.saved_messages
        ]

    def update_conversation_state(self, conversation_id, stage, onboarding_complete):
        self.updated_states.append(
            {
                "conversation_id": conversation_id,
                "stage": stage,
                "onboarding_complete": onboarding_complete,
            }
        )

    def update_conversation_metadata(self, conversation_id, metadata):
        self.metadata_updates.append(
            {
                "conversation_id": conversation_id,
                "metadata": metadata,
            }
        )
        if conversation_id == self.created_conversation["id"]:
            self.created_conversation["metadata"] = metadata

    def get_trainer_system_event_by_key(self, trainer_id, event_key):
        for event in self.system_events:
            if event.get("trainer_id") == trainer_id and event.get("event_key") == event_key:
                return event
        return None

    def insert_trainer_system_event(self, payload):
        event = {"id": f"system-event-{len(self.system_events) + 1}", **payload}
        self.system_events.append(event)
        return event

    def get_client_tenant_id(self, trainer_id, client_id):
        if trainer_id == "trainer-123" and client_id == "client-123":
            return "tenant-123"
        return None

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


class BrokenUsageConversationRepository(FakeConversationRepository):
    def record_usage_event(self, **kwargs):
        del kwargs
        raise RuntimeError("relation \"conversation_usage_events\" does not exist")

    def get_conversation_usage_summary(self, conversation_id):
        del conversation_id
        raise RuntimeError("relation \"conversation_usage_summary\" does not exist")


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
        item = {"id": f"queue-{len(self.queued) + 1}", **kwargs}
        self.queued.append(item)
        return item


class BrokenTrainerReviewService:
    def queue_unanswered_question(self, **kwargs):
        del kwargs
        raise RuntimeError("trainer review queue unavailable")


class FakeTrainerPersonaRepository:
    def __init__(self):
        self.default_persona = {
            "id": "persona-123",
            "trainer_id": "trainer-123",
            "persona_name": "Strength Coach",
            "tone_description": "Warm and direct",
            "coaching_philosophy": "Consistency first",
            "communication_rules": {},
            "onboarding_preferences": {},
            "fallback_behavior": {},
            "is_default": True,
        }

    def get_default_by_trainer(self, trainer_id):
        if self.default_persona and self.default_persona["trainer_id"] == trainer_id:
            return dict(self.default_persona)
        return None

    def create(self, payload):
        self.default_persona = {"id": "persona-created", **payload}
        return dict(self.default_persona)

    def update(self, persona_id, payload):
        if not self.default_persona or self.default_persona["id"] != persona_id:
            raise AssertionError("Unexpected persona id")
        self.default_persona.update(payload)
        return dict(self.default_persona)


class FakeTrainerIntelligenceService:
    def __init__(self, *, covered: bool = False, reason: str = "no_strong_match", matched_memory_key: str | None = None):
        self.covered = covered
        self.reason = reason
        self.matched_memory_key = matched_memory_key
        self.calls = []

    def is_question_covered_by_memory_theme(self, *, trainer_id, client_id, question):
        self.calls.append(
            {
                "trainer_id": trainer_id,
                "client_id": client_id,
                "question": question,
            }
        )
        return {
            "covered": self.covered,
            "reason": self.reason,
            "matched_memory_key": self.matched_memory_key,
        }


class FakeTrainerOnboardingService:
    def __init__(self):
        self.calls = []
        self.launch_calls = []

    def handle_launch(
        self,
        trainer_context,
        *,
        conversation_id,
        action,
        source_message_id=None,
    ):
        self.launch_calls.append(
            {
                "trainer_context": trainer_context,
                "conversation_id": conversation_id,
                "action": action,
                "source_message_id": source_message_id,
            }
        )
        normalized_action = (action or "continue").strip().lower()
        if normalized_action == "review":
            return TrainerOnboardingTurnResult(
                assistant_message="Current coach settings:\nIdentity: Supportive and direct\nVoice and tone: Warm and direct",
                quick_replies=["Edit voice", "Edit decision", "Edit boundaries", "Retrain coach"],
                current_stage="complete",
                onboarding_complete=True,
                onboarding_status="completed",
                onboarding_progress={
                    "completed_steps": 8,
                    "total_steps": 8,
                    "current_step": "complete",
                    "last_completed_step": "final_calibration",
                },
                calibration_pending=False,
            )
        if normalized_action == "retrain":
            return TrainerOnboardingTurnResult(
                assistant_message="Retraining started.\n\nStep 2 of 8: Coaching Identity\nHow do you want clients to describe your coaching identity?",
                quick_replies=["Supportive and direct", "High accountability"],
                current_stage="coaching_identity",
                onboarding_complete=False,
                onboarding_status="in_progress",
                onboarding_progress={
                    "completed_steps": 1,
                    "total_steps": 8,
                    "current_step": "coaching_identity",
                    "last_completed_step": "welcome",
                },
                calibration_pending=False,
            )
        return TrainerOnboardingTurnResult(
            assistant_message="Resumed onboarding.",
            quick_replies=["Approve all"],
            current_stage="final_calibration",
            onboarding_complete=False,
            onboarding_status="calibration_pending",
            onboarding_progress={
                "completed_steps": 7,
                "total_steps": 8,
                "current_step": "final_calibration",
                "last_completed_step": "personal_touch_optional",
            },
            calibration_pending=True,
            profile_patch={
                "trainer_onboarding": {
                    "calibration_checklist": {
                        "approved_count": 0,
                        "total": 3,
                        "samples": [],
                    }
                }
            },
        )

    def process_turn(
        self,
        trainer_context,
        *,
        conversation_id,
        user_message,
        source_message_id,
        force_restart=False,
    ):
        self.calls.append(
            {
                "trainer_context": trainer_context,
                "conversation_id": conversation_id,
                "user_message": user_message,
                "source_message_id": source_message_id,
                "force_restart": force_restart,
            }
        )
        turn = len(self.calls)
        if turn == 1:
            return TrainerOnboardingTurnResult(
                assistant_message="Step 2 of 8: Coaching Identity\nHow do you want clients to describe your coaching identity?",
                quick_replies=["Supportive and direct", "High accountability"],
                current_stage="coaching_identity",
                onboarding_complete=False,
                onboarding_status="in_progress",
                onboarding_progress={
                    "completed_steps": 1,
                    "total_steps": 8,
                    "current_step": "coaching_identity",
                    "last_completed_step": "welcome",
                },
                calibration_pending=False,
                profile_patch={
                    "trainer_onboarding": {
                        "step_preview": {
                            "step_key": "coaching_identity",
                            "scenario": "Client is anxious before week 1 and afraid of failing again.",
                            "sample_response": "You are not behind. We will focus on one confident next step today.",
                            "generation_source": "llm",
                        }
                    }
                },
            )
        if turn == 2:
            return TrainerOnboardingTurnResult(
                assistant_message="Step 8 of 8: Final Calibration\nReview these coach replies.",
                quick_replies=["Approve all", "Approve 1", "Reject 1", "Regenerate"],
                current_stage="final_calibration",
                onboarding_complete=False,
                onboarding_status="calibration_pending",
                onboarding_progress={
                    "completed_steps": 7,
                    "total_steps": 8,
                    "current_step": "final_calibration",
                    "last_completed_step": "personal_touch_optional",
                },
                calibration_pending=True,
                profile_patch={
                    "trainer_onboarding": {
                        "calibration_checklist": {
                            "approved_count": 1,
                            "total": 3,
                            "samples": [
                                {
                                    "index": 1,
                                    "id": "sample_1",
                                    "scenario": "Client says: I am exhausted and tempted to skip today's session.",
                                    "response": "Let's protect momentum with a short, high-quality session.",
                                    "status": "approved",
                                }
                            ],
                        }
                    }
                },
            )
        return TrainerOnboardingTurnResult(
            assistant_message="Coaching profile complete.",
            quick_replies=["Review coach settings", "Retrain coach"],
            current_stage="complete",
            onboarding_complete=True,
            onboarding_status="completed",
            onboarding_progress={
                "completed_steps": 8,
                "total_steps": 8,
                "current_step": "complete",
                "last_completed_step": "final_calibration",
            },
            calibration_pending=False,
        )


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

    def stream_chat_completion(
        self,
        prompt,
        *,
        model=None,
        max_output_tokens=None,
        stream_timing_observer=None,
    ):
        del model, max_output_tokens
        self.prompts.append(prompt)
        if callable(stream_timing_observer):
            stream_timing_observer("provider_stream_open_ms", 3)
            stream_timing_observer("provider_first_chunk_ms", 4)
            stream_timing_observer("provider_first_chunk_total_ms", 7)
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

    def stream_chat_completion(
        self,
        model,
        system_prompt,
        user_prompt,
        *,
        max_output_tokens=None,
        stream_timing_observer=None,
    ):
        del max_output_tokens
        self.stream_calls.append(
            {
                "model": model,
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
            }
        )
        if callable(stream_timing_observer):
            stream_timing_observer("provider_stream_open_ms", 5)
            stream_timing_observer("provider_first_chunk_ms", 6)
            stream_timing_observer("provider_first_chunk_total_ms", 11)
        yield "Claude "
        yield "stream"


class ConversationServiceRoutingTests(unittest.TestCase):
    def setUp(self):
        self.repository = FakeConversationRepository()
        self.profile_service = FakeProfileService()
        self.trainer_review_service = FakeTrainerReviewService()
        self.trainer_persona_repository = FakeTrainerPersonaRepository()
        self.trainer_onboarding_service = FakeTrainerOnboardingService()
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

    def _build_service(self, anthropic_enabled=False, trainer_intelligence_service=None):
        service = ConversationService(
            self.repository,
            self.profile_service,
            self.trainer_review_service,
            self.trainer_persona_repository,
            trainer_onboarding_service=self.trainer_onboarding_service,
            trainer_intelligence_service=trainer_intelligence_service,
        )
        service.gemini_client = FakeGeminiClient()
        service.openai_client = FakeOpenAIClient()
        service.anthropic_client = FakeAnthropicClient() if anthropic_enabled else None
        return service

    def _build_service_with_repository(self, repository, anthropic_enabled=False, trainer_intelligence_service=None):
        service = ConversationService(
            repository,
            self.profile_service,
            self.trainer_review_service,
            self.trainer_persona_repository,
            trainer_onboarding_service=self.trainer_onboarding_service,
            trainer_intelligence_service=trainer_intelligence_service,
        )
        service.gemini_client = FakeGeminiClient()
        service.openai_client = FakeOpenAIClient()
        service.anthropic_client = FakeAnthropicClient() if anthropic_enabled else None
        return service

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
        self.assertEqual(route_payload["model"], "gemini-2.5-flash-lite")
        self.assertEqual(route_payload["execution_provider"], "gemini")
        self.assertEqual(route_payload["task_type"], "qa_quick")
        self.assertEqual(response.route_debug.selected_provider, "gemini")
        self.assertEqual(response.route_debug.execution_model, "gemini-2.5-flash-lite")
        self.assertEqual(response.conversation_usage.total_tokens, 144)
        self.assertEqual(response.conversation_usage.last_execution_model, "gemini-2.5-flash-lite")
        self.assertEqual(self.repository.created_conversation["type"], "chat")
        prompt = service.gemini_client.prompts[0]
        self.assertIn("Coach Alex", prompt)
        self.assertIn("Strength Coach", prompt)
        self.assertIn("I can train four days a week.", prompt)

    def test_staging_runtime_can_force_fast_path_to_openai_only(self):
        original_app_env = settings.app_env
        original_openai_only = settings.chat_staging_openai_only
        settings.app_env = "staging"
        settings.chat_staging_openai_only = True
        try:
            service = self._build_service()

            response = service.handle_chat("user-123", self.trainer_context, self.request)
        finally:
            settings.app_env = original_app_env
            settings.chat_staging_openai_only = original_openai_only

        self.assertEqual(response.assistant_message, "GPT says hello")
        self.assertEqual(response.route_debug.selected_provider, "openai")
        self.assertEqual(response.route_debug.execution_provider, "openai")
        self.assertEqual(service.gemini_client.prompts, [])
        self.assertEqual(len(service.openai_client.calls), 1)

    def test_stream_chat_yields_chunks_and_persists_full_response(self):
        service = self._build_service()

        conversation_id, chunks, route_debug, result_state = service.stream_chat("user-123", self.trainer_context, self.request)
        started_at = time.perf_counter()
        first_chunk = next(chunks)
        first_token_ms = (time.perf_counter() - started_at) * 1000
        streamed = first_chunk + "".join(chunks)

        self.assertEqual(conversation_id, "convo-123")
        self.assertEqual(first_chunk, "Gemini ")
        self.assertLess(first_token_ms, 500)
        self.assertEqual(streamed, "Gemini stream")
        self.assertEqual(route_debug.execution_provider, "gemini")
        self.assertEqual(result_state.conversation_usage.total_tokens, 0)
        self.assertEqual(self.repository.saved_messages[-1]["message_text"], "Gemini stream")
        self.assertEqual(self.repository.updated_states[-1]["stage"], "default_fast")

    def test_stream_chat_events_logs_sanitized_phase_timing(self):
        service = self._build_service()

        with patch("app.modules.conversation.service.enqueue_post_chat_jobs", return_value=[]):
            with self.assertLogs("app.modules.conversation.service", level="INFO") as logs:
                events = list(service.stream_chat_events("user-123", self.trainer_context, self.request))

        timing_lines = [line for line in logs.output if '"event": "chat_stream_timing"' in line]
        self.assertEqual(len(timing_lines), 1)
        payload = json.loads(timing_lines[0].split(":", 2)[2])
        self.assertEqual(payload["event"], "chat_stream_timing")
        self.assertEqual(payload["tenant_id"], "tenant-123")
        self.assertEqual(payload["trainer_id"], "trainer-123")
        self.assertEqual(payload["client_id"], "client-123")
        self.assertEqual(payload["conversation_id"], "convo-123")
        self.assertEqual(payload["provider"], "gemini")
        self.assertEqual(payload["model"], "gemini-2.5-flash-lite")
        self.assertEqual(payload["route"], "FAST_PATH")
        self.assertEqual(payload["route_flow"], "default_fast")
        self.assertFalse(payload["fallback_used"])
        self.assertIsInstance(payload["intent_preview_ms"], int)
        self.assertIsInstance(payload["stream_chat_call_start_ms"], int)
        self.assertIsInstance(payload["stream_chat_return_ms"], int)
        self.assertIsInstance(payload["stream_chat_call_duration_ms"], int)
        self.assertIsInstance(payload["writing_status_ready_ms"], int)
        self.assertIsInstance(payload["pre_provider_iteration_gap_ms"], int)
        self.assertIsInstance(payload["route_prepare_ms"], int)
        self.assertIsInstance(payload["routing_profile_ms"], int)
        self.assertFalse(payload["routing_profile_cache_hit"])
        self.assertIsInstance(payload["intent_classify_ms"], int)
        self.assertIsInstance(payload["route_decision_ms"], int)
        self.assertIsInstance(payload["conversation_lookup_ms"], int)
        self.assertIsInstance(payload["conversation_create_ms"], int)
        self.assertIsInstance(payload["prompt_build_ms"], int)
        self.assertIsInstance(payload["user_message_persist_ms"], int)
        self.assertTrue(payload["user_message_persist_deferred"])
        self.assertEqual(payload["user_message_persist_ms"], 0)
        self.assertIsInstance(payload["deferred_user_message_persist_ms"], int)
        self.assertIsInstance(payload["post_memory_setup_start_ms"], int)
        self.assertIsInstance(payload["route_provider_branch_setup_ms"], int)
        self.assertIsInstance(payload["provider_iterator_ready_ms"], int)
        self.assertIsInstance(payload["stream_chat_return_ready_ms"], int)
        self.assertEqual(payload["provider_stream_open_ms"], 3)
        self.assertEqual(payload["provider_first_chunk_ms"], 4)
        self.assertEqual(payload["provider_first_chunk_total_ms"], 7)
        self.assertIsInstance(payload["provider_iteration_start_ms"], int)
        self.assertIsInstance(payload["service_provider_text_received_ms"], int)
        self.assertIsInstance(payload["provider_iteration_to_text_ms"], int)
        self.assertIsInstance(payload["first_chunk_validation_ms"], int)
        self.assertIsInstance(payload["first_safe_chunk_ready_ms"], int)
        self.assertIsInstance(payload["first_provider_chunk_yield_attempt_ms"], int)
        self.assertIsInstance(payload["stream_events_first_chunk_ms"], int)
        self.assertIsInstance(payload["first_client_token_ms"], int)
        self.assertIsInstance(payload["total_stream_ms"], int)
        joined_logs = "\n".join(logs.output)
        self.assertNotIn(self.request.message, joined_logs)
        self.assertNotIn("Gemini stream", joined_logs)
        self.assertTrue(any(event.get("type") == "done" for event in events))

    def test_handle_chat_succeeds_when_usage_analytics_are_unavailable(self):
        repository = BrokenUsageConversationRepository()
        service = self._build_service_with_repository(repository)

        response = service.handle_chat("user-123", self.trainer_context, self.request)

        self.assertEqual(response.assistant_message, "Gemini says hello")
        self.assertEqual(response.conversation_id, "convo-123")
        self.assertEqual(response.conversation_usage.total_tokens, 0)
        self.assertEqual(response.conversation_usage.usage_event_count, 0)
        self.assertEqual(repository.saved_messages[-1]["message_text"], "Gemini says hello")
        self.assertEqual(repository.updated_states[-1]["stage"], "default_fast")

    def test_safety_escalation_uses_holding_response_and_notifies_trainer(self):
        service = self._build_service()
        request = ChatRequest(
            message="I felt chest pain and got dizzy during my workout. What should I do?",
            client_context={},
        )

        with patch("app.modules.conversation.service.enqueue_post_chat_jobs", return_value=[]) as enqueue:
            response = service.handle_chat("user-123", self.trainer_context, request)

        self.assertEqual(response.assistant_message, SAFETY_ESCALATION_HOLDING_RESPONSE)
        self.assertEqual(response.conversation_state.current_stage, "safety_escalation")
        self.assertFalse(response.fallback_triggered)
        self.assertEqual(response.route_debug.selected_model, "gpt-5.4")
        self.assertEqual(response.route_debug.execution_provider, "system")
        self.assertEqual(response.route_debug.execution_model, "safety-escalation-hold")
        self.assertEqual(response.conversation_usage.total_tokens, 0)
        self.assertEqual(service.openai_client.calls, [])

        self.assertEqual(self.trainer_review_service.queued, [])
        self.assertEqual(self.repository.system_events, [])
        self.assertEqual(self.repository.metadata_updates, [])
        kwargs = enqueue.call_args.kwargs
        self.assertEqual(kwargs["conversation_id"], "convo-123")
        self.assertEqual(kwargs["user_message_id"], "msg-1")
        self.assertTrue(kwargs["route_payload"]["needs_trainer_review"])

    def test_safety_escalation_tags_and_events_when_review_queue_fails(self):
        self.trainer_review_service = BrokenTrainerReviewService()
        service = self._build_service()
        request = ChatRequest(
            message="My knee is really hurting after squats. What should I do?",
            client_context={},
        )

        with patch("app.modules.conversation.service.enqueue_post_chat_jobs", return_value=[]) as enqueue:
            response = service.handle_chat("user-123", self.trainer_context, request)

        self.assertEqual(response.assistant_message, SAFETY_ESCALATION_HOLDING_RESPONSE)
        self.assertEqual(self.repository.system_events, [])
        self.assertEqual(self.repository.metadata_updates, [])
        self.assertTrue(enqueue.call_args.kwargs["route_payload"]["needs_trainer_review"])

    def test_safety_escalation_derives_tenant_for_event_when_context_is_missing_it(self):
        service = self._build_service()
        trainer_context = TrainerContext(
            tenant_id=None,
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id="client-123",
            persona_id="persona-123",
            persona_name="Strength Coach",
        )
        request = ChatRequest(
            message="My knee is really hurting after squats. What should I do?",
            client_context={},
        )

        with patch("app.modules.conversation.service.enqueue_post_chat_jobs", return_value=[]) as enqueue:
            response = service.handle_chat("user-123", trainer_context, request)

        self.assertEqual(response.assistant_message, SAFETY_ESCALATION_HOLDING_RESPONSE)
        self.assertIsNone(enqueue.call_args.kwargs["tenant_id"])
        self.assertEqual(self.repository.system_events, [])
        self.assertEqual(self.repository.metadata_updates, [])

    def test_stream_safety_escalation_yields_before_trainer_notification(self):
        service = self._build_service()
        request = ChatRequest(
            message="My knee is really hurting after squats. What should I do?",
            client_context={},
        )

        with patch("app.modules.conversation.service.enqueue_post_chat_jobs", return_value=[]) as enqueue:
            conversation_id, chunks, route_debug, result_state = service.stream_chat(
                "user-123",
                self.trainer_context,
                request,
            )
            first_chunk = next(chunks)

            self.assertEqual(conversation_id, "convo-123")
            self.assertEqual(first_chunk, SAFETY_ESCALATION_HOLDING_RESPONSE)
            self.assertEqual(route_debug.execution_provider, "system")
            self.assertEqual(self.trainer_review_service.queued, [])

            self.assertEqual("".join(chunks), "")
        self.assertEqual(enqueue.call_count, 1)
        self.assertEqual(len(self.trainer_review_service.queued), 0)
        self.assertEqual(self.repository.system_events, [])
        self.assertEqual(self.repository.metadata_updates, [])
        self.assertEqual(result_state.conversation_usage.total_tokens, 0)

    def test_generated_workout_context_is_included_in_prompt_for_adjustments(self):
        service = self._build_service()
        request = ChatRequest(
            message="Make this easier",
            client_context={
                "entrypoint": "generated_workout",
                "workout_context": {
                    "generated_plan_id": "generated-plan-1",
                    "environment": "home_gym",
                    "time_available": 30,
                    "plan_title": "BUILD Mode Alex Home Gym Session",
                    "plan_summary": {
                        "warmup": [{"name": "Dynamic reset"}],
                        "exercises": [{"name": "Goblet squat"}],
                    },
                },
            },
        )

        response = service.handle_chat("user-123", self.trainer_context, request)

        self.assertEqual(response.assistant_message, "GPT says hello")
        self.assertEqual(response.route_debug.task_type, "workout_adjustment")
        self.assertEqual(response.route_debug.execution_provider, "openai")
        prompt = service.openai_client.calls[0]
        self.assertIn("treat it as the active workout to edit", prompt["messages"][0]["content"])
        self.assertIn("generated-plan-1", prompt["messages"][1]["content"])
        self.assertIn("Goblet squat", prompt["messages"][1]["content"])

    def test_persona_route_falls_back_when_claude_not_configured(self):
        service = self._build_service()
        request = ChatRequest(
            message="Coach, I'm feeling guilty and unmotivated. Give me the tough-love version.",
            client_context={"trainer_persona_requested": True, "retrieval_confidence": 0.3},
        )

        with patch("app.modules.conversation.service.enqueue_post_chat_jobs", return_value=[]):
            response = service.handle_chat("user-123", self.trainer_context, request)

        self.assertEqual(response.assistant_message, "GPT says hello")
        self.assertEqual(response.conversation_state.current_stage, "persona_coach")
        self.assertTrue(response.fallback_triggered)
        self.assertEqual(len(self.trainer_review_service.queued), 0)
        route_payload = self.repository.saved_messages[-1]["structured_payload"]["route"]
        self.assertEqual(route_payload["model"], "claude-sonnet-4.6")
        self.assertEqual(route_payload["execution_model"], "gpt-5.4-mini")
        self.assertEqual(route_payload["fallback_reason"], "anthropic_client_not_configured")
        self.assertEqual(response.route_debug.selected_provider, "anthropic")
        self.assertEqual(response.route_debug.execution_provider, "openai")
        self.assertEqual(response.conversation_usage.last_execution_provider, "openai")

    def test_low_confidence_client_question_defers_memory_theme_check_to_worker(self):
        intelligence_service = FakeTrainerIntelligenceService(
            covered=True,
            reason="token_overlap",
            matched_memory_key="preference_late_night_snacking",
        )
        service = self._build_service(trainer_intelligence_service=intelligence_service)
        request = ChatRequest(
            message="Coach, I keep snacking late at night after stressful workdays. Give me the tough-love version.",
            client_context={"trainer_persona_requested": True, "retrieval_confidence": 0.3},
        )

        with patch("app.modules.conversation.service.enqueue_post_chat_jobs", return_value=[]) as enqueue:
            response = service.handle_chat("user-123", self.trainer_context, request)

        self.assertEqual(response.route_debug.flow, "persona_coach")
        self.assertEqual(len(self.trainer_review_service.queued), 0)
        self.assertEqual(len(intelligence_service.calls), 0)
        self.assertTrue(enqueue.call_args.kwargs["route_payload"]["needs_trainer_review"])

    def test_low_confidence_client_question_enqueues_trainer_review_job(self):
        intelligence_service = FakeTrainerIntelligenceService(covered=False, reason="no_strong_match")
        service = self._build_service(trainer_intelligence_service=intelligence_service)
        request = ChatRequest(
            message="Coach, I'm feeling guilty and unmotivated. Give me the tough-love version.",
            client_context={"trainer_persona_requested": True, "retrieval_confidence": 0.3},
        )

        with patch("app.modules.conversation.service.enqueue_post_chat_jobs", return_value=[]) as enqueue:
            response = service.handle_chat("user-123", self.trainer_context, request)

        self.assertEqual(response.route_debug.flow, "persona_coach")
        self.assertEqual(len(self.trainer_review_service.queued), 0)
        self.assertEqual(len(intelligence_service.calls), 0)
        self.assertTrue(enqueue.call_args.kwargs["route_payload"]["needs_trainer_review"])

    def test_trainer_only_context_does_not_queue_review_even_when_route_needs_review(self):
        intelligence_service = FakeTrainerIntelligenceService(covered=False, reason="no_strong_match")
        service = self._build_service(trainer_intelligence_service=intelligence_service)
        trainer_only_context = TrainerContext(
            tenant_id="tenant-123",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
            persona_id="persona-123",
            persona_name="Strength Coach",
            trainer_onboarding_completed=True,
            trainer_onboarding_status="completed",
        )
        request = ChatRequest(
            message="Coach, I'm feeling guilty and unmotivated. Give me the tough-love version.",
            client_context={"trainer_persona_requested": True, "retrieval_confidence": 0.3},
        )

        response = service.handle_chat("user-123", trainer_only_context, request)

        self.assertEqual(response.route_debug.flow, "persona_coach")
        self.assertEqual(len(self.trainer_review_service.queued), 0)
        self.assertEqual(len(intelligence_service.calls), 0)

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

    def test_trainer_chat_runs_onboarding_without_client_id(self):
        service = self._build_service()
        trainer_context = TrainerContext(
            tenant_id="tenant-123",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
            persona_id="persona-123",
            persona_name="Strength Coach",
            trainer_onboarding_completed=False,
        )
        self.repository.history = []

        prompts = [
            "Let's start onboarding.",
            "Approve 1",
            "Approve all",
        ]

        responses = [service.handle_chat("trainer-user-123", trainer_context, ChatRequest(message=prompt)) for prompt in prompts]

        self.assertEqual(responses[0].conversation_state.current_stage, "trainer_onboarding_coaching_identity")
        self.assertEqual(responses[1].conversation_state.current_stage, "trainer_onboarding_final_calibration")
        self.assertTrue(responses[1].conversation_state.calibration_pending)
        self.assertEqual(responses[-1].conversation_state.current_stage, "trainer_onboarding_complete")
        self.assertTrue(responses[-1].conversation_state.onboarding_complete)
        self.assertEqual(responses[-1].conversation_state.onboarding_status, "completed")
        self.assertEqual(responses[-1].conversation_state.onboarding_progress["completed_steps"], 8)
        self.assertIn("Coaching profile complete", responses[-1].assistant_message)
        self.assertIn("trainer_onboarding", responses[0].profile_patch)
        self.assertIn("step_preview", responses[0].profile_patch["trainer_onboarding"])
        self.assertIn("calibration_checklist", responses[1].profile_patch["trainer_onboarding"])
        self.assertEqual(responses[0].quick_replies, ["Supportive and direct", "High accountability"])
        self.assertEqual(self.repository.created_conversation["type"], "onboarding")
        self.assertEqual(self.repository.saved_messages[0]["structured_payload"]["route"]["flow"], "trainer_onboarding_v2")

    def test_trainer_chat_can_restart_completed_onboarding_with_retrain_action(self):
        service = self._build_service()
        trainer_context = TrainerContext(
            tenant_id="tenant-123",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
            persona_id="persona-123",
            persona_name="Strength Coach",
            trainer_onboarding_completed=True,
            trainer_onboarding_status="completed",
            trainer_onboarding_completed_steps=8,
            trainer_onboarding_total_steps=8,
            trainer_onboarding_last_step="final_calibration",
        )

        response = service.handle_chat(
            "trainer-user-123",
            trainer_context,
            ChatRequest(
                message="Retrain now.",
                client_context={
                    "entrypoint": "trainer_agent_training",
                    "onboarding_action": "retrain",
                },
            ),
        )

        self.assertEqual(response.conversation_state.current_stage, "trainer_onboarding_coaching_identity")
        self.assertEqual(response.conversation_state.onboarding_status, "in_progress")
        self.assertEqual(response.quick_replies, ["Supportive and direct", "High accountability"])
        self.assertTrue(self.trainer_onboarding_service.calls[0]["force_restart"])

    def test_trainer_chat_does_not_restart_retrain_on_subsequent_turns(self):
        service = self._build_service()
        conversation_id = str(uuid4())
        self.repository.created_conversation["id"] = conversation_id
        self.repository.created_conversation["client_id"] = None
        trainer_context = TrainerContext(
            tenant_id="tenant-123",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
            persona_id="persona-123",
            persona_name="Strength Coach",
            trainer_onboarding_completed=True,
            trainer_onboarding_status="completed",
            trainer_onboarding_completed_steps=8,
            trainer_onboarding_total_steps=8,
            trainer_onboarding_last_step="final_calibration",
        )

        response = service.handle_chat(
            "trainer-user-123",
            trainer_context,
            ChatRequest(
                conversation_id=conversation_id,
                message="My identity is high-accountability and practical.",
                client_context={
                    "entrypoint": "trainer_agent_training",
                    "onboarding_action": "retrain",
                },
            ),
        )

        self.assertEqual(response.conversation_state.current_stage, "trainer_onboarding_coaching_identity")
        self.assertEqual(response.conversation_state.onboarding_status, "in_progress")
        self.assertFalse(self.trainer_onboarding_service.calls[0]["force_restart"])

    def test_trainer_onboarding_bootstrap_review_skips_user_message_and_uses_launch_handler(self):
        service = self._build_service()
        trainer_context = TrainerContext(
            tenant_id="tenant-123",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
            persona_id="persona-123",
            persona_name="Strength Coach",
            trainer_onboarding_completed=True,
            trainer_onboarding_status="completed",
            trainer_onboarding_completed_steps=8,
            trainer_onboarding_total_steps=8,
            trainer_onboarding_last_step="final_calibration",
        )
        self.repository.history = []

        response = service.handle_chat(
            "trainer-user-123",
            trainer_context,
            ChatRequest(
                message="__onboarding_bootstrap__",
                client_context={
                    "entrypoint": "trainer_agent_training",
                    "onboarding_action": "review",
                    "onboarding_bootstrap": True,
                },
            ),
        )

        self.assertIn("Current coach settings", response.assistant_message)
        self.assertEqual(response.conversation_state.current_stage, "trainer_onboarding_complete")
        self.assertEqual(response.conversation_state.onboarding_status, "completed")
        self.assertEqual(len(self.trainer_onboarding_service.launch_calls), 1)
        self.assertEqual(self.trainer_onboarding_service.launch_calls[0]["action"], "review")
        self.assertEqual(len(self.trainer_onboarding_service.calls), 0)
        self.assertEqual(len(self.repository.saved_messages), 1)
        self.assertEqual(self.repository.saved_messages[0]["role"], "assistant")
        self.assertEqual(
            self.repository.saved_messages[0]["structured_payload"]["route"]["response_mode"],
            "bootstrap",
        )

    def test_trainer_onboarding_bootstrap_retrain_starts_questionnaire_without_user_capture(self):
        service = self._build_service()
        trainer_context = TrainerContext(
            tenant_id="tenant-123",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
            persona_id="persona-123",
            persona_name="Strength Coach",
            trainer_onboarding_completed=True,
            trainer_onboarding_status="completed",
            trainer_onboarding_completed_steps=8,
            trainer_onboarding_total_steps=8,
            trainer_onboarding_last_step="final_calibration",
        )
        self.repository.history = []

        response = service.handle_chat(
            "trainer-user-123",
            trainer_context,
            ChatRequest(
                message="__onboarding_bootstrap__",
                client_context={
                    "entrypoint": "trainer_agent_training",
                    "onboarding_action": "retrain",
                    "onboarding_bootstrap": True,
                },
            ),
        )

        self.assertEqual(response.conversation_state.current_stage, "trainer_onboarding_coaching_identity")
        self.assertEqual(response.conversation_state.onboarding_status, "in_progress")
        self.assertEqual(response.quick_replies, ["Supportive and direct", "High accountability"])
        self.assertEqual(len(self.trainer_onboarding_service.launch_calls), 1)
        self.assertEqual(self.trainer_onboarding_service.launch_calls[0]["action"], "retrain")
        self.assertEqual(len(self.trainer_onboarding_service.calls), 0)
        self.assertEqual(len(self.repository.saved_messages), 1)
        self.assertEqual(self.repository.saved_messages[0]["role"], "assistant")

    def test_trainer_onboarding_bootstrap_surfaces_explicit_storage_unavailable_error(self):
        service = self._build_service()
        trainer_context = TrainerContext(
            tenant_id="tenant-123",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
            persona_id="persona-123",
            persona_name="Strength Coach",
            trainer_onboarding_completed=True,
            trainer_onboarding_status="completed",
            trainer_onboarding_completed_steps=8,
            trainer_onboarding_total_steps=8,
            trainer_onboarding_last_step="final_calibration",
        )

        def raise_storage_error(*_args, **_kwargs):
            raise TrainerOnboardingStorageUnavailableError("missing onboarding tables")

        self.trainer_onboarding_service.handle_launch = raise_storage_error

        with self.assertRaisesRegex(
            ConversationProcessingError,
            "Trainer onboarding storage is not available",
        ):
            service.handle_chat(
                "trainer-user-123",
                trainer_context,
                ChatRequest(
                    message="__onboarding_bootstrap__",
                    client_context={
                        "entrypoint": "trainer_agent_training",
                        "onboarding_action": "review",
                        "onboarding_bootstrap": True,
                    },
                ),
            )


if __name__ == "__main__":
    unittest.main()
