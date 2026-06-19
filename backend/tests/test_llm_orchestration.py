import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.ai.client import TextCompletion, TokenUsage as AIClientTokenUsage
from app.modules.conversation.context import ChatContext, build_user_digest, render_context_prompt
from app.modules.conversation.orchestration import provider_fallback_chain
from app.modules.conversation.routing import ConversationRouter, RoutingContext, RoutingDecision
from app.modules.conversation.service import ConversationProcessingError, ConversationService, PromptPackage
from app.modules.intelligence_jobs.handlers import _validated_memory_extract
from app.modules.intelligence_jobs.schemas import IntelligenceJob, MemoryExtract


def _route(
    *,
    provider: str = "openai",
    model: str = "gpt-5.4",
    flow: str = "deep_path",
    intent_route: dict | None = None,
) -> RoutingDecision:
    return RoutingDecision(
        task_type="coaching_reply",
        model=model,
        provider=provider,
        flow=flow,
        reason="test",
        response_mode="direct_answer",
        risk_score=0,
        complexity_score=4,
        persona_score=0,
        structure_score=0,
        multimodal_score=0,
        retrieval_required=False,
        retrieval_confidence=1.0,
        needs_trainer_review=False,
        requires_async=False,
        intent_route=intent_route,
    )


class BadMemoryCandidate:
    should_write = True
    memory_type = "behavioral_note"
    category = "goal"
    text = "short"
    reason = "llm_extract"


class RecordingOpenAIClient:
    def __init__(self):
        self.calls = []

    def create_chat_completion_with_usage(self, **kwargs):
        self.calls.append(kwargs)
        return TextCompletion(
            text="ok",
            token_usage=AIClientTokenUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
        )


class LLMOrchestrationTests(unittest.TestCase):
    def test_fast_path_uses_cheap_model(self):
        decision = ConversationRouter().route(
            RoutingContext(
                message_text="What should I do today?",
                client_context={},
                user_profile={"primary_goal": "strength"},
            )
        )

        self.assertEqual(decision.provider, "openai")
        self.assertEqual(decision.model, "gpt-5.4-mini")
        self.assertEqual(decision.flow, "default_fast")

    def test_token_budget_truncates_overflow(self):
        context = ChatContext(
            user_digest=build_user_digest(
                user_id="user-1",
                trainer_id="trainer-1",
                profile={"primary_goal": " ".join(["strength"] * 80)},
                client_context={"active_plan_summary": " ".join(["plan"] * 80)},
                behavioral_notes=[" ".join(["note"] * 80)],
            ),
            trainer_persona={
                "persona_name": " ".join(["coach"] * 30),
                "tone_description": " ".join(["direct"] * 30),
                "coaching_philosophy": " ".join(["practical"] * 30),
            },
            retrieved_memory=[" ".join(["memory"] * 50)],
            recent_messages=[{"role": "user", "message_text": " ".join(["history"] * 50)}],
        )
        budgets = {
            "system": 400,
            "trainer_persona": 5,
            "user_digest": 8,
            "retrieved_memory": 5,
            "recent_chat": 5,
            "user_message": 5,
            "max_output": 1500,
        }

        with self.assertLogs("app.modules.conversation.orchestration", level="WARNING") as logs:
            prompt = render_context_prompt(
                context,
                user_message=" ".join(["current"] * 50),
                token_budgets=budgets,
            )

        self.assertIn("[truncated: trainer_persona exceeded 5 token budget]", prompt)
        self.assertIn("[truncated: user_message exceeded 5 token budget]", prompt)
        self.assertIn("prompt_budget_truncated", "\n".join(logs.output))

    def test_max_output_budget_passed_to_provider(self):
        service = ConversationService.__new__(ConversationService)
        client = RecordingOpenAIClient()
        service.openai_client = client
        prompt = PromptPackage(
            system_prompt="system",
            user_prompt="user",
            orchestration_metadata={"token_budgets": {"max_output": 321}},
        )

        completion = service._execute_provider_model("openai", "gpt-5.4", prompt)

        self.assertEqual(completion.text, "ok")
        self.assertEqual(client.calls[0]["max_output_tokens"], 321)

    def test_chat_completion_uses_text_response_format(self):
        service = ConversationService.__new__(ConversationService)
        client = RecordingOpenAIClient()
        service.openai_client = client
        prompt = PromptPackage(system_prompt="system", user_prompt="user")

        service._execute_provider_model("openai", "gpt-5.4", prompt)

        self.assertEqual(client.calls[0].get("response_format"), "text")

    def test_fallback_fires_on_primary_timeout(self):
        service = ConversationService.__new__(ConversationService)
        prompt = PromptPackage(
            system_prompt="system",
            user_prompt="user",
            prompt_version="system_v1+trainer_persona_v1+safety_rules_v1",
            orchestration_metadata={"prompt_version": "system_v1+trainer_persona_v1+safety_rules_v1"},
        )
        completion = TextCompletion(
            text="ok",
            token_usage=AIClientTokenUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
        )

        with patch.object(
            service,
            "_execute_provider_model",
            side_effect=[TimeoutError("request timed out"), completion],
        ):
            result, provider, model, fallback_reason = service._execute_route(_route(), prompt)

        self.assertEqual(result.text, "ok")
        self.assertEqual(provider, "openai")
        self.assertEqual(model, "gpt-5.4")
        self.assertEqual(fallback_reason, "openai_timeout")
        self.assertEqual(
            prompt.orchestration_metadata["model_fallback_chain"],
            ["openai:gpt-5.5", "openai:gpt-5.4"],
        )
        self.assertTrue(prompt.orchestration_metadata["model_fallback_used"])
        self.assertIsNotNone(prompt.orchestration_metadata["tokens_cost_usd"])

    def test_all_providers_fail_returns_graceful_error(self):
        service = ConversationService.__new__(ConversationService)
        prompt = PromptPackage(
            system_prompt="system",
            user_prompt="user",
            orchestration_metadata={"prompt_version": "system_v1+trainer_persona_v1+safety_rules_v1"},
        )

        with patch.object(service, "_execute_provider_model", side_effect=RuntimeError("provider 500")):
            with self.assertRaises(ConversationProcessingError):
                service._execute_route(_route(), prompt)

        self.assertEqual(
            prompt.orchestration_metadata["model_fallback_chain"],
            ["openai:gpt-5.5", "openai:gpt-5.4", "anthropic:claude-sonnet-4.6"],
        )
        self.assertTrue(prompt.orchestration_metadata["model_fallback_used"])

    def test_structured_output_validation_rejects_malformed(self):
        job = IntelligenceJob(
            job_id="job-1",
            job_type="memory_write",
            trainer_id="trainer-1",
            client_id="client-1",
            conversation_id="conversation-1",
            trace_id="trace-1",
        )

        with self.assertRaises(ValidationError):
            MemoryExtract.model_validate(
                {
                    "memory_type": "behavioral_note",
                    "category": "goal",
                    "text": "short",
                    "reason": "llm_extract",
                }
            )
        with self.assertLogs("app.modules.intelligence_jobs.handlers", level="WARNING") as logs:
            extract = _validated_memory_extract(job, BadMemoryCandidate())

        joined = "\n".join(logs.output)
        self.assertIsNone(extract)
        self.assertIn("memory_extract_validation_failed", joined)
        self.assertNotIn("short", joined)

    def test_safety_escalation_fallback_chain_is_single_attempt(self):
        # Safety routes fail closed — only the primary attempt is made, never another provider.
        route = _route(
            provider="openai",
            model="gpt-5.4",
            flow="safety_escalation",
            intent_route={"route": "SAFETY_ESCALATION", "notify_trainer": True},
        )
        chain = provider_fallback_chain(route)
        self.assertEqual(len(chain), 1)
        self.assertEqual(chain[0].provider, "openai")
        self.assertEqual(chain[0].model, "gpt-5.4")

    def test_deep_path_fallback_chain_includes_three_providers(self):
        # Deep path retains its full GPT-5.5 → GPT-5.4 → Claude fallback chain.
        route = _route(
            provider="openai",
            model="gpt-5.4",
            flow="deep_path",
            intent_route={"route": "DEEP_PATH", "notify_trainer": False},
        )
        chain = provider_fallback_chain(route)
        labels = [a.label for a in chain]
        self.assertIn("openai:gpt-5.5", labels)
        self.assertIn("openai:gpt-5.4", labels)
        self.assertIn("anthropic:claude-sonnet-4.6", labels)
        self.assertEqual(len(chain), 3)

    def test_prompt_version_logged_in_trace(self):
        service = ConversationService.__new__(ConversationService)
        metadata = {
            "prompt_version": "system_v1+trainer_persona_v1+safety_rules_v1",
            "model_fallback_chain": ["openai:gpt-5.4"],
            "tokens_cost_usd": 0.123,
        }

        trace = service._build_trace_metadata(
            route=_route(),
            execution_model="gpt-5.4",
            fallback_used=False,
            orchestration_metadata=metadata,
        )

        self.assertEqual(trace["prompt_version"], "system_v1+trainer_persona_v1+safety_rules_v1")
        self.assertEqual(trace["model_fallback_chain"], ["openai:gpt-5.4"])
        self.assertEqual(trace["tokens_cost_usd"], 0.123)


if __name__ == "__main__":
    unittest.main()
