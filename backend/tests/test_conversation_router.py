import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from app.modules.conversation.routing import ConversationRouter, RoutingContext


class ConversationRouterTests(unittest.TestCase):
    def setUp(self):
        self.router = ConversationRouter()
        self.profile = {
            "client_id": "client-123",
            "primary_goal": "strength",
            "experience_level": "intermediate",
            "equipment_access": "gym",
        }

    def test_routes_high_risk_to_gpt_mini_safety_flow(self):
        decision = self.router.route(
            RoutingContext(
                message_text="I had chest pain and dizziness during my workout today.",
                client_context={},
                user_profile=self.profile,
            )
        )

        self.assertEqual(decision.provider, "openai")
        self.assertEqual(decision.model, "gpt-5.4-mini")
        self.assertEqual(decision.flow, "safety_constrained")
        self.assertGreaterEqual(decision.risk_score, 5)

    def test_routes_persona_requests_to_claude(self):
        decision = self.router.route(
            RoutingContext(
                message_text="Coach, give me the tough-love version because I'm discouraged.",
                client_context={"trainer_persona_requested": True},
                trainer_persona_name="Coach Mike",
                user_profile=self.profile,
            )
        )

        self.assertEqual(decision.provider, "anthropic")
        self.assertEqual(decision.model, "claude-sonnet-4.6")
        self.assertEqual(decision.flow, "persona_coach")

    def test_routes_complex_structured_request_to_gpt_mini(self):
        decision = self.router.route(
            RoutingContext(
                message_text="Analyze my last 8 weeks and create next week's plan in JSON.",
                client_context={"output_format": "json", "history_needed": True},
                user_profile=self.profile,
            )
        )

        self.assertEqual(decision.provider, "openai")
        self.assertEqual(decision.model, "gpt-5.4-mini")
        self.assertEqual(decision.flow, "reasoning_structured")
        self.assertEqual(decision.response_mode, "async_report_generation")

    def test_routes_simple_message_to_gemini_flash(self):
        decision = self.router.route(
            RoutingContext(
                message_text="What should I do today?",
                client_context={},
                user_profile=self.profile,
            )
        )

        self.assertEqual(decision.provider, "gemini")
        self.assertEqual(decision.model, "gemini-2.5-flash")
        self.assertEqual(decision.flow, "default_fast")


if __name__ == "__main__":
    unittest.main()
