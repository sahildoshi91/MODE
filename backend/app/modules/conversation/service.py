from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import suppress
from dataclasses import dataclass, field
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
from app.modules.trainer_persona.repository import TrainerPersonaRepository
from app.modules.trainer_review.service import TrainerReviewService


logger = logging.getLogger(__name__)


@dataclass
class PromptPackage:
    system_prompt: str
    user_prompt: str


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
    ):
        self.repository = repository
        self.profile_service = profile_service
        self.trainer_review_service = trainer_review_service
        self.trainer_persona_repository = trainer_persona_repository
        self.router = ConversationRouter()
        self.gemini_client = GeminiClient()
        self.openai_client = OpenAIClient()
        self.anthropic_client: AnthropicClient | None = None
        if settings.anthropic_api_key:
            try:
                self.anthropic_client = AnthropicClient()
            except RuntimeError:
                self.anthropic_client = None

    def _get_or_create_conversation(self, trainer_context: TrainerContext, request: ChatRequest) -> dict:
        conversation = None
        if request.conversation_id:
            conversation = self.repository.get_conversation(str(request.conversation_id))
            if not conversation:
                raise ValueError("Conversation not found")
            if (
                conversation.get("client_id") != trainer_context.client_id
                or conversation.get("trainer_id") != trainer_context.trainer_id
            ):
                raise ValueError("Conversation does not belong to the active trainer context")
        if not conversation:
            conversation = self.repository.find_active_conversation(
                trainer_context.client_id,
                trainer_context.trainer_id,
            )
        if not conversation:
            conversation = self.repository.create_conversation(
                trainer_context.trainer_id,
                trainer_context.client_id,
                "onboarding" if self._should_run_trainer_onboarding(trainer_context) else self.DEFAULT_CONVERSATION_TYPE,
                self._initial_conversation_stage(trainer_context),
            )
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

        system_prompt = (
            "You are an expert fitness coach in the MODE app.\n"
            f"Trainer display name: {trainer_context.trainer_display_name or 'MODE Coach'}\n"
            f"Trainer persona: {trainer_context.persona_name or 'General coaching'}\n"
            f"Conversation id: {conversation['id']}\n"
            f"Routed task type: {route.task_type}\n"
            f"Response mode: {route.response_mode}\n"
            "Do not mention internal routing, model selection, score thresholds, or hidden system state.\n"
            "Differentiate between what is known from context and what you are inferring.\n"
            f"{route_instructions}"
        )
        actor_label = "Trainer admin context" if self._is_trainer_only_context(trainer_context) else "Client profile"
        user_prompt = (
            f"{actor_label}: {profile}\n"
            f"Client context: {client_context}\n"
            "Conversation history:\n"
            f"{history_text}\n\n"
            f"USER: {request.message}\n"
            "ASSISTANT:"
        )
        return PromptPackage(system_prompt=system_prompt, user_prompt=user_prompt)

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

    def _execute_route(self, route: RoutingDecision, prompt: PromptPackage) -> tuple[TextCompletion, str, str, str | None]:
        if route.provider == "openai" and settings.openai_api_key:
            completion = self.openai_client.create_chat_completion_with_usage(
                model=route.model,
                messages=[
                    {"role": "system", "content": prompt.system_prompt},
                    {"role": "user", "content": prompt.user_prompt},
                ],
            )
            return completion, "openai", route.model, None

        if route.provider == "anthropic" and self.anthropic_client:
            completion = self.anthropic_client.create_chat_completion(
                model=ANTHROPIC_SONNET_MODEL,
                system_prompt=prompt.system_prompt,
                user_prompt=prompt.user_prompt,
            )
            return completion, "anthropic", ANTHROPIC_SONNET_MODEL, None

        fallback_reason = None
        execution_model = route.model
        execution_provider = route.provider

        if route.provider == "anthropic":
            fallback_reason = "anthropic_client_not_configured"
            execution_provider = "gemini"
            execution_model = GEMINI_FLASH_MODEL
        elif route.provider != "gemini":
            fallback_reason = "provider_unavailable"
            execution_provider = "gemini"
            execution_model = GEMINI_FLASH_MODEL

        combined_prompt = f"{prompt.system_prompt}\n\n{prompt.user_prompt}"
        gemini_completion = self.gemini_client.create_chat_completion(combined_prompt)
        return (
            TextCompletion(
                text=gemini_completion.text,
                token_usage=AIClientTokenUsage(
                    prompt_tokens=gemini_completion.token_usage.prompt_tokens,
                    completion_tokens=gemini_completion.token_usage.completion_tokens,
                    total_tokens=gemini_completion.token_usage.total_tokens,
                    thoughts_tokens=gemini_completion.token_usage.thoughts_tokens,
                ),
            ),
            execution_provider,
            execution_model,
            fallback_reason,
        )

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
    ) -> tuple[RouteDebug, ConversationUsage]:
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
        return route_debug, self._get_conversation_usage(conversation_id)

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
            raise ValueError("User is not assigned to an active trainer context")
        if self._should_run_trainer_onboarding(trainer_context):
            response = self._handle_trainer_onboarding(trainer_context, request)

            def onboarding_iterator() -> Iterator[str]:
                yield response.assistant_message

            result_state = StreamResultState(conversation_usage=response.conversation_usage, token_usage=response.token_usage)
            return response.conversation_id or "", onboarding_iterator(), None, result_state

        route, profile = self._route_request(trainer_context, request)
        conversation = self._get_or_create_conversation(trainer_context, request)
        prompt = self._build_prompt(trainer_context, conversation, request, route, profile)
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
                    _, conversation_usage = self._persist_assistant_message(
                        conversation["id"],
                        assistant_message,
                        route,
                        "anthropic",
                        ANTHROPIC_SONNET_MODEL,
                        completion,
                    )
                    result_state.conversation_usage = conversation_usage
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

        if route.provider != "gemini":
            completion, execution_provider, execution_model, fallback_reason = self._execute_route(route, prompt)
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
                    _, conversation_usage = self._persist_assistant_message(
                        conversation["id"],
                        assistant_message,
                        route,
                        execution_provider,
                        execution_model,
                        completion,
                        fallback_reason,
                    )
                    result_state.conversation_usage = conversation_usage
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
                _, conversation_usage = self._persist_assistant_message(
                    conversation["id"],
                    assistant_message,
                    route,
                    "gemini",
                    GEMINI_MODEL,
                    completion,
                )
                result_state.conversation_usage = conversation_usage
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

        return conversation["id"], chunk_iterator(), route_debug, result_state

    def handle_chat(self, user_id: str, trainer_context: TrainerContext, request: ChatRequest) -> ChatResponse:
        del user_id
        if not trainer_context.trainer_id:
            raise ValueError("User is not assigned to an active trainer context")
        if self._should_run_trainer_onboarding(trainer_context):
            return self._handle_trainer_onboarding(trainer_context, request)

        route, profile = self._route_request(trainer_context, request)
        conversation = self._get_or_create_conversation(trainer_context, request)
        prompt = self._build_prompt(trainer_context, conversation, request, route, profile)
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

            route_debug, conversation_usage = self._persist_assistant_message(
                conversation["id"],
                assistant_message,
                route,
                execution_provider,
                execution_model,
                completion,
                fallback_reason,
            )
        except Exception as exc:
            self._mark_conversation_failed(conversation["id"])
            raise ConversationProcessingError("Chat response could not be completed") from exc

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
