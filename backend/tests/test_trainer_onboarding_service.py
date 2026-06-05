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
from app.modules.trainer_onboarding.service import (
    ONBOARDING_STATUS_CALIBRATION_PENDING,
    ONBOARDING_STATUS_COMPLETED,
    ONBOARDING_STATUS_IN_PROGRESS,
    TrainerOnboardingService,
)


class FakeTrainerOnboardingRepository:
    def __init__(self):
        self.profiles = {}
        self.events = []

    def get_profile(self, trainer_id):
        profile = self.profiles.get(trainer_id)
        return dict(profile) if profile else None

    def create_profile(self, payload):
        trainer_id = payload["trainer_id"]
        self.profiles[trainer_id] = dict(payload)
        return dict(self.profiles[trainer_id])

    def upsert_profile(self, payload):
        trainer_id = payload["trainer_id"]
        current = self.profiles.get(trainer_id, {})
        current.update(payload)
        self.profiles[trainer_id] = current
        return dict(current)

    def update_profile(self, trainer_id, payload):
        current = dict(self.profiles.get(trainer_id, {"trainer_id": trainer_id}))
        current.update(payload)
        self.profiles[trainer_id] = current
        return dict(current)

    def create_event(self, payload):
        self.events.append(dict(payload))
        return dict(payload)


class EventFailureTrainerOnboardingRepository(FakeTrainerOnboardingRepository):
    def create_event(self, payload):
        del payload
        raise RuntimeError("relation trainer_onboarding_events does not exist")


class FakeTrainerPersonaRepository:
    def __init__(self):
        self.default_persona = None

    def get_default_by_trainer(self, trainer_id):
        if self.default_persona and self.default_persona.get("trainer_id") == trainer_id:
            return dict(self.default_persona)
        return None

    def create(self, payload):
        self.default_persona = {"id": "persona-created", **payload}
        return dict(self.default_persona)

    def update(self, persona_id, payload):
        if not self.default_persona or self.default_persona.get("id") != persona_id:
            raise AssertionError("Unexpected persona update id")
        self.default_persona.update(payload)
        return dict(self.default_persona)


class FakeOpenAIClient:
    def __init__(self, responses=None, error=None):
        self.responses = list(responses or [])
        self.error = error
        self.calls = []

    def create_chat_completion_with_usage(self, model, messages):
        self.calls.append({"model": model, "messages": messages})
        if self.error:
            raise self.error
        text = self.responses.pop(0) if self.responses else '{"responses":[]}'
        return type("FakeCompletion", (), {"text": text})()


class TrainerOnboardingServiceTests(unittest.TestCase):
    def setUp(self):
        self.repository = FakeTrainerOnboardingRepository()
        self.persona_repository = FakeTrainerPersonaRepository()
        self.service = TrainerOnboardingService(
            repository=self.repository,
            trainer_persona_repository=self.persona_repository,
            openai_client=False,
        )
        self.trainer_context = TrainerContext(
            tenant_id="tenant-123",
            trainer_id="trainer-123",
            trainer_user_id="trainer-user-123",
            trainer_display_name="Coach Alex",
            client_id=None,
            persona_name="Strength Coach",
        )

    def _turn(self, message, source_message_id="msg-1"):
        return self.service.process_turn(
            self.trainer_context,
            conversation_id="convo-123",
            user_message=message,
            source_message_id=source_message_id,
        )

    def _step_and_advance(self, message, source_message_id="msg-1"):
        """Send a step answer and skip the sample review if one is triggered."""
        result = self._turn(message, source_message_id=source_message_id)
        if result.onboarding_progress.get("sample_review_state") == "pending":
            return self._turn("yeah, that's me")
        return result

    def test_welcome_turn_captures_agent_name_and_advances_to_coaching_identity(self):
        result = self._turn("Coach Nova")
        profile = self.repository.get_profile("trainer-123")

        self.assertEqual(result.current_stage, "coaching_identity")
        self.assertEqual(result.onboarding_status, ONBOARDING_STATUS_IN_PROGRESS)
        self.assertEqual(result.onboarding_progress["completed_steps"], 1)
        self.assertEqual(profile["last_completed_step"], "welcome")
        self.assertEqual(profile["identity"]["agent_name"], "Coach Nova")
        self.assertEqual(profile["communication_preferences"]["agent_name"], "Coach Nova")
        self.assertEqual(self.repository.events[-1]["step_key"], "welcome")
        self.assertEqual(self.repository.events[-1]["action_type"], "captured")

    def test_low_confidence_agent_name_triggers_welcome_clarifier(self):
        result = self._turn("start")

        self.assertEqual(result.current_stage, "welcome")
        self.assertIn("I need one clearer signal", result.assistant_message)
        self.assertEqual(result.onboarding_status, ONBOARDING_STATUS_IN_PROGRESS)
        self.assertEqual(result.onboarding_progress["current_step"], "welcome")
        self.assertEqual(self.repository.events[-1]["action_type"], "clarified")

    def test_retrain_launch_always_starts_at_welcome_with_agent_naming_prompt(self):
        result = self.service.handle_launch(
            self.trainer_context,
            conversation_id="convo-123",
            action="retrain",
        )
        profile = self.repository.get_profile("trainer-123")

        self.assertEqual(result.current_stage, "welcome")
        self.assertEqual(result.onboarding_status, ONBOARDING_STATUS_IN_PROGRESS)
        self.assertIn("Retraining started", result.assistant_message)
        self.assertIn("Case study", result.assistant_message)
        self.assertEqual(result.onboarding_progress["completed_steps"], 0)
        self.assertEqual(result.onboarding_progress["current_step"], "welcome")
        self.assertEqual(profile["retrain_draft"]["onboarding_progress"]["current_step"], "welcome")
        self.assertEqual(profile["retrain_draft"]["onboarding_progress"]["completed_steps"], 0)

    def test_repeated_retrain_launches_reset_draft_to_same_start(self):
        first = self.service.handle_launch(
            self.trainer_context,
            conversation_id="convo-123",
            action="retrain",
        )
        self.assertEqual(first.current_stage, "welcome")
        self._turn("Coach Nova", source_message_id="msg-2")

        second = self.service.handle_launch(
            self.trainer_context,
            conversation_id="convo-123",
            action="retrain",
        )
        profile = self.repository.get_profile("trainer-123")
        self.assertEqual(second.current_stage, "welcome")
        self.assertEqual(second.onboarding_progress["completed_steps"], 0)
        self.assertEqual(profile["retrain_draft"]["onboarding_progress"]["current_step"], "welcome")
        self.assertEqual(profile["retrain_draft"]["onboarding_progress"]["completed_steps"], 0)

    def test_resume_on_welcome_does_not_skip_to_coaching_identity(self):
        self.service.handle_launch(
            self.trainer_context,
            conversation_id="convo-123",
            action="retrain",
        )
        result = self.service.handle_launch(
            self.trainer_context,
            conversation_id="convo-123",
            action="resume",
        )
        self.assertEqual(result.current_stage, "welcome")
        self.assertEqual(result.onboarding_progress["current_step"], "welcome")
        self.assertIn("Case study", result.assistant_message)

    def test_onboarding_prompts_are_scenario_driven_one_question_per_turn(self):
        launch = self.service.handle_launch(
            self.trainer_context,
            conversation_id="convo-123",
            action="retrain",
        )
        self.assertEqual(launch.assistant_message.count("?"), 1)
        self.assertIn("Case study", launch.assistant_message)

        step2 = self._turn("Coach Nova", source_message_id="msg-2")
        self.assertEqual(step2.current_stage, "coaching_identity")
        self.assertEqual(step2.assistant_message.count("?"), 1)
        self.assertIn("Case study", step2.assistant_message)

        # Answer coaching_identity — triggers sample review, advance past it
        step3 = self._step_and_advance("Supportive and direct when anxiety spikes", source_message_id="msg-3")
        self.assertEqual(step3.current_stage, "voice_calibration")
        self.assertEqual(step3.assistant_message.count("?"), 1)
        self.assertIn("Case study", step3.assistant_message)

    def test_scenario_answers_append_step_specific_scenario_rules(self):
        self._turn("Coach Nova")
        self._step_and_advance("Supportive and direct when anxiety spikes", source_message_id="msg-2")
        self._step_and_advance("Warm, clear, and no shame language", source_message_id="msg-3")
        self._step_and_advance(
            "Pain first, then sleep, then stress, then schedule.",
            source_message_id="msg-4",
        )
        profile = self.repository.get_profile("trainer-123")
        scenario_rules = profile["scenario_rules"]

        self.assertGreaterEqual(len(scenario_rules), 3)
        steps = {entry.get("step") for entry in scenario_rules if isinstance(entry, dict)}
        self.assertIn("coaching_identity", steps)
        self.assertIn("voice_calibration", steps)
        self.assertIn("decision_engine", steps)

    def test_decision_engine_preserves_declared_factor_order(self):
        self._turn("Coach Nova")
        self._step_and_advance("Supportive and direct when anxiety spikes", source_message_id="msg-2")
        self._step_and_advance("Warm, clear, and no shame language", source_message_id="msg-3")
        self._step_and_advance(
            "I prioritize pain first, then sleep, then stress, then time constraints.",
            source_message_id="msg-4",
        )
        profile = self.repository.get_profile("trainer-123")
        decision_weights = profile["decision_weights"]

        self.assertEqual(
            decision_weights["ranked_factors"][:4],
            ["pain", "sleep", "stress", "time"],
        )
        self.assertEqual(decision_weights["rank_extraction_method"], "ordered_text")

    def test_skip_optional_personal_touch_enters_pre_calibration_summary(self):
        self._turn("Coach Nova")
        self._step_and_advance("Supportive but direct with high accountability", source_message_id="msg-2")
        self._step_and_advance("Warm and concise. Avoid passive language.", source_message_id="msg-3")
        self._step_and_advance("Prioritize sleep, stress, then schedule with pain always first.", source_message_id="msg-4")
        self._step_and_advance("Consistency first. Technique before load. Never skip form.", source_message_id="msg-5")
        self._step_and_advance("Hard: no pain chasing; Soft: reduce volume on high stress.", source_message_id="msg-6")
        result = self._turn("skip this", source_message_id="msg-7")
        profile = self.repository.get_profile("trainer-123")

        self.assertEqual(result.current_stage, "final_calibration")
        self.assertTrue(result.calibration_pending)
        self.assertEqual(result.onboarding_status, ONBOARDING_STATUS_CALIBRATION_PENDING)
        self.assertEqual(profile["onboarding_status"], ONBOARDING_STATUS_CALIBRATION_PENDING)
        self.assertTrue(profile["calibration_examples"])
        self.assertEqual(result.quick_replies, ["Let's do it"])
        self.assertEqual(
            result.onboarding_progress.get("sample_review_state"), "pre_calibration_summary"
        )
        self.assertEqual(result.onboarding_progress.get("current_step"), "final_calibration")
        self.assertEqual(self.repository.events[-1]["action_type"], "skipped")

    def test_final_calibration_approve_all_completes_and_mirrors_persona(self):
        self._turn("Coach Nova")
        self._step_and_advance("Supportive but direct with high accountability", source_message_id="msg-2")
        self._step_and_advance("Warm and concise. Avoid passive language.", source_message_id="msg-3")
        self._step_and_advance("Prioritize pain, then sleep, stress, and schedule.", source_message_id="msg-4")
        self._step_and_advance("Consistency first. Technique before load. Never skip form.", source_message_id="msg-5")
        self._step_and_advance("Hard: no pain chasing; Soft: reduce volume on high stress.", source_message_id="msg-6")
        self._turn("skip", source_message_id="msg-7")  # personal touch skip → summary
        self._turn("let's do it", source_message_id="msg-8")  # summary acknowledgement → calibration

        result = self._turn("approve all", source_message_id="msg-9")
        profile = self.repository.get_profile("trainer-123")
        persona = self.persona_repository.default_persona

        self.assertEqual(result.current_stage, "complete")
        self.assertTrue(result.onboarding_complete)
        self.assertEqual(result.onboarding_status, ONBOARDING_STATUS_COMPLETED)
        self.assertEqual(profile["onboarding_status"], ONBOARDING_STATUS_COMPLETED)
        self.assertEqual(profile["onboarding_progress"]["current_step"], "complete")
        self.assertIsNotNone(persona)
        self.assertEqual(persona["persona_name"], "Coach Nova")
        self.assertTrue(persona["onboarding_preferences"]["trainer_onboarding_completed"])
        self.assertEqual(self.repository.events[-1]["action_type"], "approved")

    def test_voice_step_prompt_uses_plain_language_examples(self):
        self._turn("Coach Nova")
        result = self._step_and_advance("Supportive and direct when anxiety spikes", source_message_id="msg-2")

        self.assertEqual(result.current_stage, "voice_calibration")
        self.assertIn("how should the coach sound", result.assistant_message.lower())
        self.assertIn("examples: calm, direct, encouraging", result.assistant_message.lower())
        self.assertIn("examples: harsh, shaming", result.assistant_message.lower())
        self.assertNotIn("tone words", result.assistant_message.lower())

    def test_voice_clarifier_uses_plain_language_examples(self):
        self._turn("Coach Nova")
        self._step_and_advance("Supportive and direct when anxiety spikes", source_message_id="msg-2")
        result = self._turn("idk", source_message_id="msg-3")

        self.assertEqual(result.current_stage, "voice_calibration")
        self.assertIn("how should the coach sound", result.assistant_message.lower())
        self.assertIn("example:", result.assistant_message.lower())
        self.assertIn("to avoid", result.assistant_message.lower())
        self.assertNotIn("tone words", result.assistant_message.lower())

    def test_boundaries_capture_hard_guardrail_and_soft(self):
        self._turn("Coach Nova")
        self._step_and_advance("Supportive but direct with high accountability", source_message_id="msg-2")
        self._step_and_advance("Warm and concise. Avoid passive language.", source_message_id="msg-3")
        self._step_and_advance("Prioritize pain, then sleep, stress, and schedule.", source_message_id="msg-4")
        self._step_and_advance("Consistency first. Technique before load. Never skip form.", source_message_id="msg-5")
        result = self._step_and_advance(
            "Hard: stop on sharp pain; Guardrail: swap to pain-free options if discomfort rises; Soft: shorten session if stress is high.",
            source_message_id="msg-6",
        )
        profile = self.repository.get_profile("trainer-123")
        boundaries = profile["boundaries"]

        self.assertEqual(result.current_stage, "personal_touch_optional")
        self.assertTrue(boundaries["hard"])
        self.assertTrue(boundaries["guardrail"])
        self.assertTrue(boundaries["soft"])

    def test_step_preview_payload_added_after_captured_step(self):
        self._turn("Coach Nova")
        result = self._turn("Supportive but direct with high accountability", source_message_id="msg-2")

        step_preview = result.profile_patch.get("trainer_onboarding", {}).get("step_preview", {})
        # Step stays on coaching_identity during sample review — advance has not happened yet
        self.assertEqual(result.current_stage, "coaching_identity")
        self.assertEqual(step_preview.get("step_key"), "coaching_identity")
        self.assertTrue(step_preview.get("sample_response"))

    def test_calibration_checklist_payload_tracks_approval_progress(self):
        self._turn("Coach Nova")
        self._step_and_advance("Supportive but direct with high accountability", source_message_id="msg-2")
        self._step_and_advance("Warm and concise. Avoid passive language.", source_message_id="msg-3")
        self._step_and_advance("Prioritize pain, then sleep, stress, and schedule.", source_message_id="msg-4")
        self._step_and_advance("Consistency first. Technique before load. Never skip form.", source_message_id="msg-5")
        self._step_and_advance("Hard: no pain chasing; Guardrail: regress if pain rises; Soft: reduce volume on high stress.", source_message_id="msg-6")
        self._turn("skip", source_message_id="msg-7")  # personal touch skip → summary (no checklist)
        step8 = self._turn("let's do it", source_message_id="msg-8")  # summary acknowledgement → calibration
        post_approve = self._turn("approve 1", source_message_id="msg-9")

        initial_checklist = step8.profile_patch.get("trainer_onboarding", {}).get("calibration_checklist", {})
        followup_checklist = post_approve.profile_patch.get("trainer_onboarding", {}).get("calibration_checklist", {})
        self.assertEqual(initial_checklist.get("total"), 3)
        self.assertEqual(initial_checklist.get("visible_count"), 1)
        self.assertEqual(len(initial_checklist.get("samples", [])), 1)
        self.assertTrue(initial_checklist["samples"][0]["is_active"])
        self.assertEqual(initial_checklist["samples"][0]["index"], 1)
        self.assertEqual(followup_checklist.get("approved_count"), 1)
        self.assertEqual(len(followup_checklist.get("samples", [])), 2)
        self.assertFalse(followup_checklist["samples"][0]["is_active"])
        self.assertTrue(followup_checklist["samples"][1]["is_active"])

    def test_calibration_examples_use_llm_responses_when_available(self):
        fake_llm = FakeOpenAIClient(
            responses=[
                '{"responses":["Sample one from llm","Sample two from llm","Sample three from llm"]}',
            ]
        )
        service = TrainerOnboardingService(
            repository=self.repository,
            trainer_persona_repository=self.persona_repository,
            openai_client=fake_llm,
        )

        examples = service._generate_calibration_examples({})

        self.assertEqual(len(examples), 3)
        self.assertEqual(examples[0]["response"], "Sample one from llm")
        self.assertEqual(examples[0]["generation_source"], "llm")

    def test_calibration_examples_fallback_to_templates_when_llm_fails(self):
        fake_llm = FakeOpenAIClient(error=RuntimeError("llm offline"))
        service = TrainerOnboardingService(
            repository=self.repository,
            trainer_persona_repository=self.persona_repository,
            openai_client=fake_llm,
        )

        examples = service._generate_calibration_examples({})

        self.assertEqual(len(examples), 3)
        self.assertIn("Tone:", examples[0]["response"])
        self.assertEqual(examples[0]["generation_source"], "template_fallback")

    def test_edit_intent_reopens_selected_step(self):
        self._turn("Coach Nova")
        self._turn("Supportive but direct", source_message_id="msg-2")
        self._turn("Warm and concise", source_message_id="msg-3")
        result = self._turn("edit voice", source_message_id="msg-4")

        self.assertEqual(result.current_stage, "voice_calibration")
        self.assertIn("Reopened Voice Calibration", result.assistant_message)
        self.assertEqual(self.repository.events[-1]["action_type"], "edited")

    def _reach_personal_touch(self):
        """Advance through steps 1-6 and return at personal_touch_optional."""
        self._turn("Coach Nova")
        self._step_and_advance("Supportive but direct with high accountability", source_message_id="msg-2")
        self._step_and_advance("Warm and concise. Avoid passive language.", source_message_id="msg-3")
        self._step_and_advance("Prioritize pain, then sleep, stress, and schedule.", source_message_id="msg-4")
        self._step_and_advance("Consistency first. Technique before load. Never skip form.", source_message_id="msg-5")
        self._step_and_advance("Hard: no pain chasing; Guardrail: reduce if pain rises; Soft: shorten on stress.", source_message_id="msg-6")

    def test_step7_sample_approval_returns_summary_before_calibration(self):
        self._reach_personal_touch()
        # Answer personal_touch_optional → sample review → approve → pre_calibration_summary
        result = self._turn("I use the phrase: small wins compound daily.", source_message_id="msg-7")
        self.assertEqual(result.onboarding_progress.get("sample_review_state"), "pending")
        summary = self._turn("yeah, that's me")

        self.assertEqual(summary.current_stage, "final_calibration")
        self.assertEqual(summary.onboarding_progress.get("sample_review_state"), "pre_calibration_summary")
        self.assertEqual(summary.onboarding_progress.get("current_step"), "final_calibration")
        self.assertTrue(summary.calibration_pending)
        self.assertEqual(summary.quick_replies, ["Let's do it"])

    def test_pre_calibration_summary_acknowledgement_returns_calibration(self):
        self._reach_personal_touch()
        self._turn("skip this", source_message_id="msg-7")  # → summary

        calibration = self._turn("Let's do it", source_message_id="msg-8")

        self.assertEqual(calibration.current_stage, "final_calibration")
        self.assertIsNone(calibration.onboarding_progress.get("sample_review_state"))
        self.assertTrue(calibration.calibration_pending)
        self.assertEqual(calibration.quick_replies, [])
        self.assertIn("Step 8", calibration.assistant_message)

    def test_calibration_assistant_text_is_short_framing_only(self):
        self._reach_personal_touch()
        self._turn("skip", source_message_id="msg-7")
        result = self._turn("Let's do it", source_message_id="msg-8")

        self.assertIn("Step 8 of 8: Final Calibration", result.assistant_message)
        self.assertNotRegex(result.assistant_message, r"1\.\s+Client says")
        self.assertNotIn("Status:", result.assistant_message)

    def test_calibration_quick_replies_empty(self):
        self._reach_personal_touch()
        self._turn("skip", source_message_id="msg-7")
        result = self._turn("Let's do it", source_message_id="msg-8")

        self.assertEqual(result.quick_replies, [])

    def test_completion_message_includes_agent_name(self):
        self._reach_personal_touch()
        self._turn("skip", source_message_id="msg-7")
        self._turn("let's do it", source_message_id="msg-8")

        result = self._turn("approve all", source_message_id="msg-9")

        self.assertEqual(result.current_stage, "complete")
        self.assertIn("Coach Nova is live", result.assistant_message)

    def test_calibration_initial_checklist_shows_first_pending_only(self):
        self._reach_personal_touch()
        self._turn("skip", source_message_id="msg-7")
        step8 = self._turn("let's do it", source_message_id="msg-8")

        checklist = step8.profile_patch.get("trainer_onboarding", {}).get("calibration_checklist", {})
        self.assertEqual(checklist.get("total"), 3)
        self.assertEqual(checklist.get("visible_count"), 1)
        samples = checklist.get("samples", [])
        self.assertEqual(len(samples), 1)
        self.assertEqual(samples[0]["index"], 1)
        self.assertTrue(samples[0]["is_active"])

    def test_calibration_approve_first_sample_reveals_second(self):
        self._reach_personal_touch()
        self._turn("skip", source_message_id="msg-7")
        self._turn("let's do it", source_message_id="msg-8")
        result = self._turn("approve 1", source_message_id="msg-9")

        checklist = result.profile_patch.get("trainer_onboarding", {}).get("calibration_checklist", {})
        samples = checklist.get("samples", [])
        self.assertEqual(len(samples), 2)
        self.assertEqual(samples[0]["index"], 1)
        self.assertFalse(samples[0]["is_active"])
        self.assertEqual(samples[1]["index"], 2)
        self.assertTrue(samples[1]["is_active"])

    def test_sample_review_pending_and_awaiting_edit_still_work(self):
        # Verify existing pending/awaiting_edit routing is unaffected by pre_calibration_summary
        self._turn("Coach Nova")
        result = self._turn("Supportive but direct with high accountability", source_message_id="msg-2")
        self.assertEqual(result.onboarding_progress.get("sample_review_state"), "pending")

        edit_result = self._turn("I'd say it differently")
        self.assertEqual(edit_result.onboarding_progress.get("sample_review_state"), "awaiting_edit")

        advanced = self._turn("I'd say: build trust with warmth and hold the line with facts.")
        self.assertEqual(advanced.current_stage, "voice_calibration")

    def test_review_launch_does_not_fail_when_event_persistence_breaks(self):
        noisy_repository = EventFailureTrainerOnboardingRepository()
        service = TrainerOnboardingService(
            repository=noisy_repository,
            trainer_persona_repository=self.persona_repository,
            openai_client=False,
        )

        result = service.handle_launch(
            self.trainer_context,
            conversation_id="convo-123",
            action="review",
        )

        self.assertIn("Current coach settings", result.assistant_message)
        self.assertEqual(result.current_stage, "welcome")
        self.assertEqual(result.onboarding_status, "not_started")


if __name__ == "__main__":
    unittest.main()
