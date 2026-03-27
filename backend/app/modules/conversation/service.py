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

    def __init__(
        self,
        repository: ConversationRepository,
        profile_service: ProfileService,
        trainer_review_service: TrainerReviewService,
    ):
        self.repository = repository
        self.profile_service = profile_service
        self.trainer_review_service = trainer_review_service
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
                self.DEFAULT_CONVERSATION_TYPE,
                "router_initialized",
            )
        return conversation

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
        user_prompt = (
            f"Client profile: {profile}\n"
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
        profile = self.profile_service.get_or_create_profile(trainer_context.client_id)
        route = self.router.route(
            RoutingContext(
                message_text=request.message,
                client_context=request.client_context,
                trainer_persona_name=trainer_context.persona_name,
                user_profile=profile,
            )
        )
        return route, profile

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
        self.repository.update_conversation_state(
            conversation_id,
            route.flow,
            False,
        )
        return route_debug, self._get_conversation_usage(conversation_id)

    def _get_conversation_usage(self, conversation_id: str) -> ConversationUsage:
        summary = self.repository.get_conversation_usage_summary(conversation_id)
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
        if not trainer_context.client_id or not trainer_context.trainer_id:
            raise ValueError("User is not assigned to an active trainer context")

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
        if not trainer_context.client_id or not trainer_context.trainer_id:
            raise ValueError("User is not assigned to an active trainer context")

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
