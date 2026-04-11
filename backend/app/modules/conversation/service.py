from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.ai.client import (
    ANTHROPIC_SONNET_MODEL,
    GEMINI_MODEL,
    AnthropicClient,
    GeminiClient,
    OpenAIClient,
    TextCompletion,
    TokenUsage as AIClientTokenUsage,
)
from app.core.config import settings
from app.core.tenancy import TrainerContext
from app.modules.ai_feedback.service import AIFeedbackService
from app.modules.conversation.repository import ConversationRepository
from app.modules.conversation.routing import (
    CLAUDE_SONNET_4_6_MODEL,
    ConversationRouter,
    GEMINI_FLASH_MODEL,
    GPT_5_4_MINI_MODEL,
    RoutingDecision,
    RoutingContext,
)
from app.modules.conversation.schemas import ChatRequest, ChatResponse, ConversationState, ConversationUsage, RouteDebug, TokenUsage
from app.modules.profile.service import ProfileService
from app.modules.trainer_intelligence.service import TrainerIntelligenceService
from app.modules.trainer_persona.repository import TrainerPersonaRepository
from app.modules.trainer_review.service import TrainerReviewService


logger = logging.getLogger(__name__)


@dataclass
class PromptPackage:
    system_prompt: str
    user_prompt: str
    orchestration_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class StreamResultState:
    conversation_usage: ConversationUsage | None = None
    token_usage: TokenUsage = field(default_factory=TokenUsage)


class ConversationProcessingError(RuntimeError):
    pass


class ConversationService:
    DEFAULT_CONVERSATION_TYPE = "chat"
    FAILED_CONVERSATION_STAGE = "response_failed"
    TRAINER_ONBOARDING_STAGE_PREFIX = "trainer_onboarding_q"
    TRAINER_ONBOARDING_COMPLETE_STAGE = "trainer_onboarding_complete"
    TRAINER_ONBOARDING_QUESTIONS = (
        "Hey - let's quickly set up your AI coaching assistant.\n"
        "This helps it sound like you and coach like you.\n\n"
        "Just a few quick questions.\n\n"
        "In one or two sentences, how would you describe your coaching style?",
        "What do you believe most people get wrong about fitness or training?",
        "When you build a program, what are the 2-3 things you focus on most?",
        "What do you always consider when adjusting a workout for a client? For example: time, injuries, equipment, energy, or schedule.",
        "A client says: \"I don't feel motivated today and might skip my workout.\"\n\nWhat would you say to them?",
    )

    def __init__(
        self,
        repository: ConversationRepository,
        profile_service: ProfileService,
        trainer_review_service: TrainerReviewService,
        trainer_persona_repository: TrainerPersonaRepository,
        ai_feedback_logger_service: AIFeedbackService | None = None,
        trainer_intelligence_service: TrainerIntelligenceService | None = None,
    ):
        self.repository = repository
        self.profile_service = profile_service
        self.trainer_review_service = trainer_review_service
        self.trainer_persona_repository = trainer_persona_repository
        self.ai_feedback_logger_service = ai_feedback_logger_service
        self.trainer_intelligence_service = trainer_intelligence_service
        self.router = ConversationRouter()
        self.gemini_client: GeminiClient | None = self._safe_init_gemini_client()
        self.openai_client: OpenAIClient | None = self._safe_init_openai_client()
        self.anthropic_client: AnthropicClient | None = None
        if settings.anthropic_api_key:
            try:
                self.anthropic_client = AnthropicClient()
            except RuntimeError:
                self.anthropic_client = None
                logger.warning("Anthropic client unavailable, continuing with fallback providers")
            except Exception:
                self.anthropic_client = None
                logger.exception("Anthropic client failed to initialize, continuing with fallback providers")

    def _safe_init_gemini_client(self) -> GeminiClient | None:
        try:
            return GeminiClient()
        except RuntimeError:
            logger.warning("Gemini client unavailable, continuing with fallback providers")
            return None
        except Exception:
            logger.exception("Gemini client failed to initialize, continuing with fallback providers")
            return None

    def _safe_init_openai_client(self) -> OpenAIClient | None:
        try:
            return OpenAIClient()
        except Exception:
            logger.exception("OpenAI client failed to initialize, continuing with fallback providers")
            return None

    def _exception_attribute(self, exc: Exception, attribute: str) -> Any:
        current: BaseException | None = exc
        while current is not None:
            value = getattr(current, attribute, None)
            if value not in (None, ""):
                return value
            current = current.__cause__
        return None

    def _log_preparation_failure(
        self,
        *,
        stage: str,
        exc: Exception,
        trainer_context: TrainerContext,
        request: ChatRequest,
        conversation_id: str | None = None,
    ) -> None:
        logger.exception(
            "Conversation pre-processing failed stage=%s trainer_id=%s client_id=%s conversation_id=%s code=%s message=%s hint=%s details=%s",
            stage,
            trainer_context.trainer_id,
            trainer_context.client_id,
            conversation_id or (str(request.conversation_id) if request.conversation_id else None),
            self._exception_attribute(exc, "code"),
            self._exception_attribute(exc, "message") or str(exc),
            self._exception_attribute(exc, "hint"),
            self._exception_attribute(exc, "details"),
            exc_info=exc,
        )

    def _get_or_create_conversation(self, trainer_context: TrainerContext, request: ChatRequest) -> dict:
        conversation = None
        if request.conversation_id:
            try:
                conversation = self.repository.get_conversation(str(request.conversation_id))
            except Exception as exc:
                self._log_preparation_failure(
                    stage="conversation_lookup",
                    exc=exc,
                    trainer_context=trainer_context,
                    request=request,
                )
                raise
            if not conversation:
                raise ValueError("Conversation not found")
            if (
                conversation.get("client_id") != trainer_context.client_id
                or conversation.get("trainer_id") != trainer_context.trainer_id
            ):
                raise ValueError("Conversation does not belong to the active trainer context")
        if not conversation:
            try:
                conversation = self.repository.find_active_conversation(
                    trainer_context.client_id,
                    trainer_context.trainer_id,
                )
            except Exception as exc:
                self._log_preparation_failure(
                    stage="conversation_lookup",
                    exc=exc,
                    trainer_context=trainer_context,
                    request=request,
                )
                raise
        if not conversation:
            try:
                conversation = self.repository.create_conversation(
                    trainer_context.trainer_id,
                    trainer_context.client_id,
                    "onboarding" if self._should_run_trainer_onboarding(trainer_context) else self.DEFAULT_CONVERSATION_TYPE,
                    self._initial_conversation_stage(trainer_context),
                )
            except Exception as exc:
                self._log_preparation_failure(
                    stage="conversation_create",
                    exc=exc,
                    trainer_context=trainer_context,
                    request=request,
                )
                raise
        return conversation

    def _initial_conversation_stage(self, trainer_context: TrainerContext) -> str:
        if self._should_run_trainer_onboarding(trainer_context):
            return f"{self.TRAINER_ONBOARDING_STAGE_PREFIX}1"
        return "router_initialized"

    def _is_trainer_only_context(self, trainer_context: TrainerContext) -> bool:
        return bool(trainer_context.trainer_id and not trainer_context.client_id)

    def _should_run_trainer_onboarding(self, trainer_context: TrainerContext) -> bool:
        return self._is_trainer_only_context(trainer_context) and not trainer_context.trainer_onboarding_completed

    def _build_prompt(
        self,
        trainer_context: TrainerContext,
        conversation: dict[str, Any],
        request: ChatRequest,
        route: RoutingDecision,
        profile: dict[str, Any],
    ) -> PromptPackage:
        history = self.repository.list_messages(conversation["id"])
        history_lines = [
            f"{message['role'].upper()}: {message['message_text']}"
            for message in history
            if message.get("message_text")
        ]
        history_text = "\n".join(history_lines[-12:])
        client_context = request.client_context or {}
        route_instructions = self._route_system_instructions(route)
        workout_prompt = self._workout_context_prompt(client_context)
        orchestration_metadata: dict[str, Any] = {
            "enabled": bool(settings.trainer_intelligence_orchestration_enabled),
            "used": False,
            "fallback_reason": "flag_disabled",
        }
        orchestration_system_appendix = ""
        orchestration_user_appendix = ""

        if settings.trainer_intelligence_orchestration_enabled and self.trainer_intelligence_service:
            try:
                orchestration_context = self.trainer_intelligence_service.assemble_prompt_context(
                    trainer_context=trainer_context,
                    route=route,
                    client_context=client_context,
                    profile=profile,
                )
                orchestration_system_appendix = orchestration_context.system_appendix or ""
                orchestration_user_appendix = orchestration_context.user_appendix or ""
                orchestration_metadata = {
                    "enabled": True,
                    **(orchestration_context.metadata or {}),
                    "used": bool(orchestration_system_appendix or orchestration_user_appendix),
                }
            except Exception as exc:
                logger.exception(
                    "Trainer intelligence orchestration failed conversation_id=%s trainer_id=%s client_id=%s",
                    conversation.get("id"),
                    trainer_context.trainer_id,
                    trainer_context.client_id,
                )
                orchestration_metadata = {
                    "enabled": True,
                    "used": False,
                    "fallback_reason": exc.__class__.__name__,
                }
        elif settings.trainer_intelligence_orchestration_enabled:
            orchestration_metadata = {
                "enabled": True,
                "used": False,
                "fallback_reason": "orchestration_service_unavailable",
            }
        orchestration_system_block = f"{orchestration_system_appendix}\n" if orchestration_system_appendix else ""

        system_prompt = (
            "You are an expert fitness coach in the MODE app.\n"
            f"Trainer display name: {trainer_context.trainer_display_name or 'MODE Coach'}\n"
            f"Trainer persona: {trainer_context.persona_name or 'General coaching'}\n"
            f"Conversation id: {conversation['id']}\n"
            f"Routed task type: {route.task_type}\n"
            f"Response mode: {route.response_mode}\n"
            "Do not mention internal routing, model selection, score thresholds, or hidden system state.\n"
            "Differentiate between what is known from context and what you are inferring.\n"
            f"{workout_prompt['system']}"
            f"{route_instructions}"
            f"{orchestration_system_block}"
        )
        actor_label = "Trainer admin context" if self._is_trainer_only_context(trainer_context) else "Client profile"
        user_prompt = (
            f"{actor_label}: {profile}\n"
            f"Client context: {client_context}\n"
            f"{workout_prompt['user']}"
            f"{orchestration_user_appendix}"
            "Conversation history:\n"
            f"{history_text}\n\n"
            f"USER: {request.message}\n"
            "ASSISTANT:"
        )
        return PromptPackage(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            orchestration_metadata=orchestration_metadata,
        )

    def _workout_context_prompt(self, client_context: dict[str, Any]) -> dict[str, str]:
        entrypoint = str(client_context.get("entrypoint") or "").strip().lower()
        if entrypoint not in {"generated_workout", "generated-workout", "workout_feedback", "workout-feedback"}:
            return {"system": "", "user": ""}

        workout_context = client_context.get("workout_context")
        if not isinstance(workout_context, dict):
            workout_context = {}

        return {
            "system": (
                "If workout_context is present, treat it as the active workout to edit instead of inventing a new plan. "
                "When the user wants something easier, shorter, lower impact, or wants to skip an exercise, give a concrete adjusted version "
                "of the current workout with substitutions, set/rep/rest changes, and a brief rationale.\n"
            ),
            "user": f"Active workout context: {workout_context}\n",
        }

    def _route_system_instructions(self, route: RoutingDecision) -> str:
        if route.model == GPT_5_4_MINI_MODEL:
            return (
                "Reason carefully, reconcile constraints, and prefer conservative training advice.\n"
                "If there is any risk language, keep advice bounded and encourage appropriate professional support when needed.\n"
                "If structured output is requested, keep it clean and explicit.\n"
            )
        if route.model == CLAUDE_SONNET_4_6_MODEL:
            return (
                "Preserve the trainer voice, use high empathy, and sound like a real coach rather than a generic planner.\n"
                "Keep the answer grounded in known program constraints.\n"
            )
        if route.flow == "multimodal_fast":
            return (
                "Be fast and practical. Avoid medical certainty and avoid overclaiming from limited visual context.\n"
            )
        return (
            "Be concise, clear, and useful. Do not overcomplicate simple coaching questions.\n"
        )

    def _route_request(
        self,
        trainer_context: TrainerContext,
        request: ChatRequest,
    ) -> tuple[RoutingDecision, dict[str, Any]]:
        profile = self._get_routing_profile(trainer_context)
        route = self.router.route(
            RoutingContext(
                message_text=request.message,
                client_context=request.client_context,
                trainer_persona_name=trainer_context.persona_name,
                user_profile=profile,
            )
        )
        return route, profile

    def _get_routing_profile(self, trainer_context: TrainerContext) -> dict[str, Any]:
        if trainer_context.client_id:
            return self.profile_service.get_or_create_profile(trainer_context.client_id)
        return {
            "context_type": "trainer_admin",
            "trainer_display_name": trainer_context.trainer_display_name,
            "persona_name": trainer_context.persona_name,
        }

    def _prepare_route_and_prompt(
        self,
        trainer_context: TrainerContext,
        request: ChatRequest,
    ) -> tuple[RoutingDecision, dict[str, Any], PromptPackage]:
        try:
            route, profile = self._route_request(trainer_context, request)
        except ValueError:
            raise
        except Exception as exc:
            self._log_preparation_failure(
                stage="routing_profile",
                exc=exc,
                trainer_context=trainer_context,
                request=request,
            )
            raise ConversationProcessingError("Chat response could not be completed") from exc

        try:
            conversation = self._get_or_create_conversation(trainer_context, request)
        except ValueError:
            raise
        except Exception as exc:
            raise ConversationProcessingError("Chat response could not be completed") from exc

        try:
            prompt = self._build_prompt(trainer_context, conversation, request, route, profile)
            return route, conversation, prompt
        except ValueError:
            raise
        except Exception as exc:
            self._log_preparation_failure(
                stage="prompt_build",
                exc=exc,
                trainer_context=trainer_context,
                request=request,
                conversation_id=conversation.get("id") if isinstance(conversation, dict) else None,
            )
            raise ConversationProcessingError("Chat response could not be completed") from exc

    def _list_user_messages(self, conversation_id: str) -> list[dict[str, Any]]:
        return [message for message in self.repository.list_messages(conversation_id, limit=50) if message.get("role") == "user"]

    def _trainer_onboarding_state(self, conversation_id: str) -> tuple[int, bool, list[dict[str, Any]]]:
        answers = self._list_user_messages(conversation_id)
        question_count = len(self.TRAINER_ONBOARDING_QUESTIONS)
        completed = len(answers) >= question_count
        next_index = min(len(answers), question_count - 1)
        return next_index, completed, answers

    def _build_trainer_onboarding_summary(
        self,
        trainer_context: TrainerContext,
        answers: list[dict[str, Any]],
    ) -> str:
        answer_text = [answer.get("message_text", "").strip() for answer in answers[: len(self.TRAINER_ONBOARDING_QUESTIONS)]]
        while len(answer_text) < len(self.TRAINER_ONBOARDING_QUESTIONS):
            answer_text.append("")
        return (
            "Got it - here's how I'll coach like you:\n\n"
            f"Style: {answer_text[0] or 'Still taking shape.'}\n"
            f"Belief: {answer_text[1] or 'Still taking shape.'}\n"
            f"Programming focus: {answer_text[2] or 'Still taking shape.'}\n"
            f"Adjustment logic: {answer_text[3] or 'Still taking shape.'}\n"
            f"Motivation style: {answer_text[4] or 'Still taking shape.'}\n\n"
            "You can tweak this anytime. I'll use this as the starting point for your MODE coaching assistant."
        )

    def _upsert_trainer_onboarding_persona(
        self,
        trainer_context: TrainerContext,
        answers: list[dict[str, Any]],
    ) -> None:
        if not trainer_context.trainer_id:
            return
        answer_text = [answer.get("message_text", "").strip() for answer in answers[: len(self.TRAINER_ONBOARDING_QUESTIONS)]]
        while len(answer_text) < len(self.TRAINER_ONBOARDING_QUESTIONS):
            answer_text.append("")

        existing = self.trainer_persona_repository.get_default_by_trainer(trainer_context.trainer_id)
        payload = {
            "persona_name": (existing or {}).get("persona_name") or trainer_context.persona_name or "Default Coach",
            "tone_description": answer_text[0] or (existing or {}).get("tone_description"),
            "coaching_philosophy": answer_text[1] or (existing or {}).get("coaching_philosophy"),
            "communication_rules": {
                **(((existing or {}).get("communication_rules")) or {}),
                "programming_priorities": answer_text[2],
                "motivation_response_example": answer_text[4],
            },
            "onboarding_preferences": {
                **(((existing or {}).get("onboarding_preferences")) or {}),
                "trainer_onboarding_completed": True,
                "trainer_onboarding_version": "v1_lightweight",
                "trainer_onboarding_answers": {
                    "coaching_style": answer_text[0],
                    "fitness_misconception": answer_text[1],
                    "programming_focus": answer_text[2],
                    "adjustment_factors": answer_text[3],
                    "motivation_response": answer_text[4],
                },
            },
            "fallback_behavior": {
                **(((existing or {}).get("fallback_behavior")) or {}),
                "adjustment_factors": answer_text[3],
            },
            "is_default": True,
        }

        if existing:
            self.trainer_persona_repository.update(existing["id"], payload)
            return

        self.trainer_persona_repository.create(
            {
                "trainer_id": trainer_context.trainer_id,
                **payload,
            }
        )

    def _build_onboarding_chat_response(
        self,
        conversation_id: str,
        trainer_context: TrainerContext,
        assistant_message: str,
        stage: str,
        onboarding_complete: bool,
    ) -> ChatResponse:
        return ChatResponse(
            conversation_id=conversation_id,
            assistant_message=assistant_message,
            quick_replies=[],
            conversation_state=ConversationState(
                current_stage=stage,
                onboarding_complete=onboarding_complete,
            ),
            profile_patch={},
            trainer_context={
                "tenant_id": trainer_context.tenant_id,
                "trainer_id": trainer_context.trainer_id,
                "trainer_display_name": trainer_context.trainer_display_name,
                "persona_id": trainer_context.persona_id,
                "persona_name": trainer_context.persona_name,
            },
            fallback_triggered=False,
            token_usage=TokenUsage(),
            route_debug=None,
            conversation_usage=self._get_conversation_usage(conversation_id),
        )

    def _handle_trainer_onboarding(
        self,
        trainer_context: TrainerContext,
        request: ChatRequest,
    ) -> ChatResponse:
        conversation = self._get_or_create_conversation(trainer_context, request)
        user_message = self.repository.save_message(
            conversation["id"],
            "user",
            request.message,
            {
                "client_context": request.client_context,
                "route": {
                    "flow": "trainer_onboarding",
                    "reason": "trainer_setup",
                    "task_type": "trainer_onboarding",
                    "response_mode": "guided_question",
                    "provider": "system",
                    "model": "trainer-onboarding-v1",
                },
            },
        )
        del user_message
        next_index, completed, answers = self._trainer_onboarding_state(conversation["id"])
        if completed:
            assistant_message = self._build_trainer_onboarding_summary(trainer_context, answers)
            self._upsert_trainer_onboarding_persona(trainer_context, answers)
            stage = self.TRAINER_ONBOARDING_COMPLETE_STAGE
        else:
            assistant_message = self.TRAINER_ONBOARDING_QUESTIONS[next_index]
            stage = f"{self.TRAINER_ONBOARDING_STAGE_PREFIX}{next_index + 1}"
        self.repository.save_message(
            conversation["id"],
            "assistant",
            assistant_message,
            {
                "provider": "system",
                "model": "trainer-onboarding-v1",
                "route": {
                    "flow": "trainer_onboarding",
                    "reason": "trainer_setup",
                    "task_type": "trainer_onboarding",
                    "response_mode": "guided_question" if not completed else "summary",
                },
            },
        )
        self.repository.update_conversation_state(
            conversation["id"],
            stage,
            completed,
        )
        return self._build_onboarding_chat_response(
            conversation["id"],
            trainer_context,
            assistant_message,
            stage,
            completed,
        )

    def _serialize_route_metadata(
        self,
        route: RoutingDecision,
        execution_provider: str,
        execution_model: str,
        fallback_reason: str | None = None,
    ) -> dict[str, Any]:
        payload = route.as_dict()
        payload["execution_provider"] = execution_provider
        payload["execution_model"] = execution_model
        if fallback_reason:
            payload["fallback_reason"] = fallback_reason
        return payload

    def _build_route_debug(
        self,
        route: RoutingDecision,
        execution_provider: str,
        execution_model: str,
        fallback_reason: str | None = None,
    ) -> RouteDebug:
        return RouteDebug(
            selected_provider=route.provider,
            selected_model=route.model,
            execution_provider=execution_provider,
            execution_model=execution_model,
            flow=route.flow,
            reason=route.reason,
            task_type=route.task_type,
            response_mode=route.response_mode,
            fallback_reason=fallback_reason,
        )

    def _gemini_text_completion(self, prompt: PromptPackage) -> TextCompletion:
        if not self.gemini_client:
            raise ConversationProcessingError("Chat response could not be completed")
        combined_prompt = f"{prompt.system_prompt}\n\n{prompt.user_prompt}"
        gemini_completion = self.gemini_client.create_chat_completion(combined_prompt)
        return TextCompletion(
            text=gemini_completion.text,
            token_usage=AIClientTokenUsage(
                prompt_tokens=gemini_completion.token_usage.prompt_tokens,
                completion_tokens=gemini_completion.token_usage.completion_tokens,
                total_tokens=gemini_completion.token_usage.total_tokens,
                thoughts_tokens=gemini_completion.token_usage.thoughts_tokens,
            ),
        )

    def _execute_with_provider(
        self,
        provider: str,
        route: RoutingDecision,
        prompt: PromptPackage,
    ) -> tuple[TextCompletion, str]:
        if provider == "openai":
            if not settings.openai_api_key or not self.openai_client:
                raise RuntimeError("openai_client_not_configured")
            completion = self.openai_client.create_chat_completion_with_usage(
                model=route.model if route.provider == "openai" else GPT_5_4_MINI_MODEL,
                messages=[
                    {"role": "system", "content": prompt.system_prompt},
                    {"role": "user", "content": prompt.user_prompt},
                ],
            )
            return completion, route.model if route.provider == "openai" else GPT_5_4_MINI_MODEL

        if provider == "anthropic":
            if not self.anthropic_client:
                raise RuntimeError("anthropic_client_not_configured")
            completion = self.anthropic_client.create_chat_completion(
                model=ANTHROPIC_SONNET_MODEL,
                system_prompt=prompt.system_prompt,
                user_prompt=prompt.user_prompt,
            )
            return completion, ANTHROPIC_SONNET_MODEL

        if provider == "gemini":
            completion = self._gemini_text_completion(prompt)
            return completion, GEMINI_FLASH_MODEL

        raise RuntimeError("provider_unavailable")

    def _provider_fallback_reason(self, provider: str) -> str:
        if provider == "anthropic":
            return "anthropic_client_not_configured"
        if provider == "gemini":
            return "gemini_client_not_configured"
        if provider == "openai":
            return "openai_client_not_configured"
        return "provider_unavailable"

    def _execute_route(self, route: RoutingDecision, prompt: PromptPackage) -> tuple[TextCompletion, str, str, str | None]:
        primary_provider = route.provider
        fallback_reason: str | None = None

        provider_order = [primary_provider]
        for provider in ("gemini", "openai", "anthropic"):
            if provider not in provider_order:
                provider_order.append(provider)

        for index, provider in enumerate(provider_order):
            try:
                completion, execution_model = self._execute_with_provider(provider, route, prompt)
                return completion, provider, execution_model, fallback_reason
            except Exception:
                if index == 0:
                    fallback_reason = self._provider_fallback_reason(provider)
                logger.exception("Route execution failed provider=%s route_provider=%s", provider, route.provider)

        raise ConversationProcessingError("Chat response could not be completed")

    def _queue_trainer_review_if_needed(
        self,
        trainer_context: TrainerContext,
        conversation_id: str,
        user_message_id: str | None,
        route: RoutingDecision,
        request: ChatRequest,
        assistant_message: str,
    ) -> None:
        if not route.needs_trainer_review or not trainer_context.trainer_id:
            return
        self.trainer_review_service.queue_unanswered_question(
            trainer_id=trainer_context.trainer_id,
            client_id=trainer_context.client_id,
            conversation_id=conversation_id,
            message_id=user_message_id,
            user_question=request.message,
            model_draft_answer=assistant_message,
            confidence_score=route.retrieval_confidence,
        )

    def _queue_trainer_review_safely(
        self,
        trainer_context: TrainerContext,
        conversation_id: str,
        user_message_id: str | None,
        route: RoutingDecision,
        request: ChatRequest,
        assistant_message: str,
    ) -> None:
        try:
            self._queue_trainer_review_if_needed(
                trainer_context,
                conversation_id,
                user_message_id,
                route,
                request,
                assistant_message,
            )
        except Exception:
            logger.exception("Failed to queue trainer review for conversation_id=%s", conversation_id)

    def _mark_conversation_failed(self, conversation_id: str) -> None:
        with suppress(Exception):
            self.repository.update_conversation_state(
                conversation_id,
                self.FAILED_CONVERSATION_STAGE,
                False,
            )

    def _persist_assistant_message(
        self,
        conversation_id: str,
        assistant_message: str,
        route: RoutingDecision,
        execution_provider: str,
        execution_model: str,
        completion: TextCompletion,
        fallback_reason: str | None = None,
        orchestration_metadata: dict[str, Any] | None = None,
    ) -> tuple[RouteDebug, ConversationUsage, dict[str, Any]]:
        route_debug = self._build_route_debug(route, execution_provider, execution_model, fallback_reason)
        saved_message = self.repository.save_message(
            conversation_id,
            "assistant",
            assistant_message,
            {
                "provider": execution_provider,
                "model": execution_model,
                "token_usage": {
                    "prompt_tokens": completion.token_usage.prompt_tokens,
                    "completion_tokens": completion.token_usage.completion_tokens,
                    "total_tokens": completion.token_usage.total_tokens,
                    "thoughts_tokens": completion.token_usage.thoughts_tokens,
                },
                "route": self._serialize_route_metadata(route, execution_provider, execution_model, fallback_reason),
                "orchestration": orchestration_metadata or {},
            },
        )
        try:
            self.repository.record_usage_event(
                conversation_id=conversation_id,
                message_id=saved_message["id"],
                provider=execution_provider,
                model=execution_model,
                prompt_tokens=completion.token_usage.prompt_tokens,
                completion_tokens=completion.token_usage.completion_tokens,
                total_tokens=completion.token_usage.total_tokens,
                thoughts_tokens=completion.token_usage.thoughts_tokens,
                route_flow=route.flow,
                route_reason=route.reason,
                task_type=route.task_type,
                response_mode=route.response_mode,
                fallback_triggered=bool(fallback_reason),
            )
        except Exception:
            logger.exception("Failed to record conversation usage analytics for conversation_id=%s", conversation_id)
        self.repository.update_conversation_state(
            conversation_id,
            route.flow,
            False,
        )
        return route_debug, self._get_conversation_usage(conversation_id), saved_message

    def _log_generated_chat_output_safely(
        self,
        *,
        trainer_context: TrainerContext,
        conversation_id: str,
        saved_assistant_message: dict[str, Any],
        assistant_message: str,
        route: RoutingDecision,
        completion: TextCompletion,
        execution_provider: str,
        execution_model: str,
        fallback_reason: str | None,
        orchestration_metadata: dict[str, Any] | None,
        request: ChatRequest,
    ) -> None:
        if not self.ai_feedback_logger_service:
            return
        if not trainer_context.tenant_id or not trainer_context.trainer_id:
            return

        message_id = str(saved_assistant_message.get("id") or "").strip() or None
        if not message_id:
            return
        generated_at = saved_assistant_message.get("created_at") or datetime.now(timezone.utc).isoformat()
        try:
            self.ai_feedback_logger_service.log_generated_output(
                tenant_id=trainer_context.tenant_id,
                trainer_id=trainer_context.trainer_id,
                client_id=trainer_context.client_id,
                source_type="chat",
                source_ref_id=message_id,
                conversation_id=conversation_id,
                message_id=message_id,
                output_text=assistant_message,
                output_json={
                    "route": {
                        "task_type": route.task_type,
                        "response_mode": route.response_mode,
                        "flow": route.flow,
                    },
                    "request_message": request.message,
                },
                generation_metadata={
                    "producer": "conversation_service",
                    "generation_strategy": execution_provider,
                    "generated_at": generated_at,
                    "provider": execution_provider,
                    "model": execution_model,
                    "fallback_reason": fallback_reason,
                    "token_usage": {
                        "prompt_tokens": completion.token_usage.prompt_tokens,
                        "completion_tokens": completion.token_usage.completion_tokens,
                        "total_tokens": completion.token_usage.total_tokens,
                        "thoughts_tokens": completion.token_usage.thoughts_tokens,
                    },
                    "orchestration": orchestration_metadata or {},
                },
            )
        except Exception:
            logger.exception("Failed to write chat output to ai_generated_outputs message_id=%s", message_id)

    def _get_conversation_usage(self, conversation_id: str) -> ConversationUsage:
        try:
            summary = self.repository.get_conversation_usage_summary(conversation_id)
        except Exception:
            logger.exception("Failed to load conversation usage analytics for conversation_id=%s", conversation_id)
            summary = None
        if not summary:
            return ConversationUsage(conversation_id=conversation_id)
        return ConversationUsage(**summary)

    def _build_response(
        self,
        conversation_id: str,
        trainer_context: TrainerContext,
        assistant_message: str,
        route: RoutingDecision,
        completion: TextCompletion,
        fallback_triggered: bool,
        route_debug: RouteDebug,
        conversation_usage: ConversationUsage,
    ) -> ChatResponse:
        return ChatResponse(
            conversation_id=conversation_id,
            assistant_message=assistant_message,
            quick_replies=[],
            conversation_state=ConversationState(
                current_stage=route.flow,
                onboarding_complete=False,
            ),
            profile_patch={},
            trainer_context={
                "tenant_id": trainer_context.tenant_id,
                "trainer_id": trainer_context.trainer_id,
                "trainer_display_name": trainer_context.trainer_display_name,
                "persona_id": trainer_context.persona_id,
                "persona_name": trainer_context.persona_name,
            },
            fallback_triggered=fallback_triggered,
            token_usage=TokenUsage(
                prompt_tokens=completion.token_usage.prompt_tokens,
                completion_tokens=completion.token_usage.completion_tokens,
                total_tokens=completion.token_usage.total_tokens,
                thoughts_tokens=completion.token_usage.thoughts_tokens,
            ),
            route_debug=route_debug,
            conversation_usage=conversation_usage,
        )

    def stream_chat(
        self,
        user_id: str,
        trainer_context: TrainerContext,
        request: ChatRequest,
    ) -> tuple[str, Iterator[str], RouteDebug, StreamResultState]:
        del user_id
        if not trainer_context.trainer_id:
            if request.conversation_id:
                raise ValueError("Conversation not found")
            raise ValueError("User is not assigned to an active trainer context")
        if self._should_run_trainer_onboarding(trainer_context):
            try:
                response = self._handle_trainer_onboarding(trainer_context, request)
            except ValueError:
                raise
            except Exception as exc:
                raise ConversationProcessingError("Chat response could not be completed") from exc

            def onboarding_iterator() -> Iterator[str]:
                yield response.assistant_message

            result_state = StreamResultState(conversation_usage=response.conversation_usage, token_usage=response.token_usage)
            return response.conversation_id or "", onboarding_iterator(), None, result_state

        route, conversation, prompt = self._prepare_route_and_prompt(trainer_context, request)
        route_metadata = route.as_dict()
        try:
            user_message = self.repository.save_message(
                conversation["id"],
                "user",
                request.message,
                {
                    "client_context": request.client_context,
                    "route": route_metadata,
                },
            )
        except Exception as exc:
            self._mark_conversation_failed(conversation["id"])
            raise ConversationProcessingError("Chat response could not be completed") from exc

        if route.provider == "anthropic" and self.anthropic_client:
            route_debug = self._build_route_debug(route, "anthropic", ANTHROPIC_SONNET_MODEL)
            result_state = StreamResultState()

            def anthropic_iterator() -> Iterator[str]:
                try:
                    full_response: list[str] = []
                    for text in self.anthropic_client.stream_chat_completion(
                        model=ANTHROPIC_SONNET_MODEL,
                        system_prompt=prompt.system_prompt,
                        user_prompt=prompt.user_prompt,
                    ):
                        full_response.append(text)
                        yield text

                    assistant_message = "".join(full_response).strip()
                    if not assistant_message:
                        assistant_message = "I'm here with you. Could you rephrase that and I'll try again?"

                    completion = TextCompletion(
                        text=assistant_message,
                        token_usage=AIClientTokenUsage(),
                    )
                    _, conversation_usage, saved_assistant_message = self._persist_assistant_message(
                        conversation["id"],
                        assistant_message,
                        route,
                        "anthropic",
                        ANTHROPIC_SONNET_MODEL,
                        completion,
                        orchestration_metadata=prompt.orchestration_metadata,
                    )
                    result_state.conversation_usage = conversation_usage
                    self._log_generated_chat_output_safely(
                        trainer_context=trainer_context,
                        conversation_id=conversation["id"],
                        saved_assistant_message=saved_assistant_message,
                        assistant_message=assistant_message,
                        route=route,
                        completion=completion,
                        execution_provider="anthropic",
                        execution_model=ANTHROPIC_SONNET_MODEL,
                        fallback_reason=None,
                        orchestration_metadata=prompt.orchestration_metadata,
                        request=request,
                    )
                    self._queue_trainer_review_safely(
                        trainer_context,
                        conversation["id"],
                        user_message.get("id"),
                        route,
                        request,
                        assistant_message,
                    )
                except Exception as exc:
                    self._mark_conversation_failed(conversation["id"])
                    raise ConversationProcessingError("Chat response could not be completed") from exc

            return conversation["id"], anthropic_iterator(), route_debug, result_state

        if route.provider != "gemini" or not self.gemini_client:
            try:
                completion, execution_provider, execution_model, fallback_reason = self._execute_route(route, prompt)
            except ConversationProcessingError:
                self._mark_conversation_failed(conversation["id"])
                raise
            except Exception as exc:
                self._mark_conversation_failed(conversation["id"])
                raise ConversationProcessingError("Chat response could not be completed") from exc

            route_debug = self._build_route_debug(route, execution_provider, execution_model, fallback_reason)
            result_state = StreamResultState(
                token_usage=TokenUsage(
                    prompt_tokens=completion.token_usage.prompt_tokens,
                    completion_tokens=completion.token_usage.completion_tokens,
                    total_tokens=completion.token_usage.total_tokens,
                    thoughts_tokens=completion.token_usage.thoughts_tokens,
                )
            )

            def fallback_iterator() -> Iterator[str]:
                try:
                    assistant_message = (completion.text or "").strip()
                    if not assistant_message:
                        assistant_message = "I'm here with you. Could you rephrase that and I'll try again?"
                    yield assistant_message
                    _, conversation_usage, saved_assistant_message = self._persist_assistant_message(
                        conversation["id"],
                        assistant_message,
                        route,
                        execution_provider,
                        execution_model,
                        completion,
                        fallback_reason,
                        orchestration_metadata=prompt.orchestration_metadata,
                    )
                    result_state.conversation_usage = conversation_usage
                    self._log_generated_chat_output_safely(
                        trainer_context=trainer_context,
                        conversation_id=conversation["id"],
                        saved_assistant_message=saved_assistant_message,
                        assistant_message=assistant_message,
                        route=route,
                        completion=completion,
                        execution_provider=execution_provider,
                        execution_model=execution_model,
                        fallback_reason=fallback_reason,
                        orchestration_metadata=prompt.orchestration_metadata,
                        request=request,
                    )
                    self._queue_trainer_review_safely(
                        trainer_context,
                        conversation["id"],
                        user_message.get("id"),
                        route,
                        request,
                        assistant_message,
                    )
                except ConversationProcessingError:
                    self._mark_conversation_failed(conversation["id"])
                    raise
                except Exception as exc:
                    self._mark_conversation_failed(conversation["id"])
                    raise ConversationProcessingError("Chat response could not be completed") from exc

            return conversation["id"], fallback_iterator(), route_debug, result_state

        combined_prompt = f"{prompt.system_prompt}\n\n{prompt.user_prompt}"
        route_debug = self._build_route_debug(route, "gemini", GEMINI_MODEL)
        result_state = StreamResultState()

        def chunk_iterator() -> Iterator[str]:
            try:
                full_response: list[str] = []
                for text in self.gemini_client.stream_chat_completion(combined_prompt):
                    full_response.append(text)
                    yield text

                assistant_message = "".join(full_response).strip()
                if not assistant_message:
                    assistant_message = "I'm here with you. Could you rephrase that and I'll try again?"

                completion = TextCompletion(
                    text=assistant_message,
                    token_usage=AIClientTokenUsage(),
                )
                _, conversation_usage, saved_assistant_message = self._persist_assistant_message(
                    conversation["id"],
                    assistant_message,
                    route,
                    "gemini",
                    GEMINI_MODEL,
                    completion,
                    orchestration_metadata=prompt.orchestration_metadata,
                )
                result_state.conversation_usage = conversation_usage
                self._log_generated_chat_output_safely(
                    trainer_context=trainer_context,
                    conversation_id=conversation["id"],
                    saved_assistant_message=saved_assistant_message,
                    assistant_message=assistant_message,
                    route=route,
                    completion=completion,
                    execution_provider="gemini",
                    execution_model=GEMINI_MODEL,
                    fallback_reason=None,
                    orchestration_metadata=prompt.orchestration_metadata,
                    request=request,
                )
                self._queue_trainer_review_safely(
                    trainer_context,
                    conversation["id"],
                    user_message.get("id"),
                    route,
                    request,
                    assistant_message,
                )
            except ConversationProcessingError:
                self._mark_conversation_failed(conversation["id"])
                raise
            except Exception as exc:
                self._mark_conversation_failed(conversation["id"])
                raise ConversationProcessingError("Chat response could not be completed") from exc

        return conversation["id"], chunk_iterator(), route_debug, result_state

    def handle_chat(self, user_id: str, trainer_context: TrainerContext, request: ChatRequest) -> ChatResponse:
        del user_id
        if not trainer_context.trainer_id:
            if request.conversation_id:
                raise ValueError("Conversation not found")
            raise ValueError("User is not assigned to an active trainer context")
        if self._should_run_trainer_onboarding(trainer_context):
            try:
                return self._handle_trainer_onboarding(trainer_context, request)
            except ValueError:
                raise
            except Exception as exc:
                raise ConversationProcessingError("Chat response could not be completed") from exc

        route, conversation, prompt = self._prepare_route_and_prompt(trainer_context, request)
        try:
            user_message = self.repository.save_message(
                conversation["id"],
                "user",
                request.message,
                {
                    "client_context": request.client_context,
                    "route": route.as_dict(),
                },
            )

            completion, execution_provider, execution_model, fallback_reason = self._execute_route(route, prompt)
            assistant_message = (completion.text or "").strip()
            if not assistant_message:
                assistant_message = "I'm here with you. Could you rephrase that and I'll try again?"

            route_debug, conversation_usage, saved_assistant_message = self._persist_assistant_message(
                conversation["id"],
                assistant_message,
                route,
                execution_provider,
                execution_model,
                completion,
                fallback_reason,
                orchestration_metadata=prompt.orchestration_metadata,
            )
        except ConversationProcessingError:
            self._mark_conversation_failed(conversation["id"])
            raise
        except Exception as exc:
            self._mark_conversation_failed(conversation["id"])
            raise ConversationProcessingError("Chat response could not be completed") from exc

        self._log_generated_chat_output_safely(
            trainer_context=trainer_context,
            conversation_id=conversation["id"],
            saved_assistant_message=saved_assistant_message,
            assistant_message=assistant_message,
            route=route,
            completion=completion,
            execution_provider=execution_provider,
            execution_model=execution_model,
            fallback_reason=fallback_reason,
            orchestration_metadata=prompt.orchestration_metadata,
            request=request,
        )
        self._queue_trainer_review_safely(
            trainer_context,
            conversation["id"],
            user_message.get("id"),
            route,
            request,
            assistant_message,
        )

        return self._build_response(
            conversation_id=conversation["id"],
            trainer_context=trainer_context,
            assistant_message=assistant_message,
            route=route,
            completion=completion,
            fallback_triggered=bool(fallback_reason),
            route_debug=route_debug,
            conversation_usage=conversation_usage,
        )
