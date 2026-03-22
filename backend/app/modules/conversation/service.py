from app.core.tenancy import TrainerContext
from app.modules.conversation.repository import ConversationRepository
from app.modules.conversation.schemas import ChatRequest, ChatResponse, ConversationState
from app.modules.conversation.state_machine import (
    build_assistant_prompt,
    detect_profile_patch,
    determine_stage,
    is_plan_ready,
)
from app.modules.profile.service import ProfileService
from app.modules.trainer_review.service import TrainerReviewService


class ConversationService:
    def __init__(
        self,
        repository: ConversationRepository,
        profile_service: ProfileService,
        trainer_review_service: TrainerReviewService,
    ):
        self.repository = repository
        self.profile_service = profile_service
        self.trainer_review_service = trainer_review_service

    def handle_chat(self, user_id: str, trainer_context: TrainerContext, request: ChatRequest) -> ChatResponse:
        del user_id
        if not trainer_context.client_id or not trainer_context.trainer_id:
            raise ValueError("User is not assigned to an active trainer context")

        conversation = None
        if request.conversation_id:
            conversation = self.repository.get_conversation(request.conversation_id)
        if not conversation:
            conversation = self.repository.find_active_conversation(
                trainer_context.client_id,
                trainer_context.trainer_id,
            )
        if not conversation:
            conversation = self.repository.create_conversation(
                trainer_context.trainer_id,
                trainer_context.client_id,
                "onboarding",
                "welcome",
            )

        user_message = self.repository.save_message(
            conversation["id"],
            "user",
            request.message,
            {"client_context": request.client_context},
        )

        profile_patch = detect_profile_patch(request.message)
        if profile_patch:
            self.profile_service.upsert_profile_patch(trainer_context.client_id, profile_patch)

        profile = self.profile_service.get_or_create_profile(trainer_context.client_id)
        merged_profile = {**profile, **profile_patch}
        stage = determine_stage(merged_profile)
        ready = is_plan_ready(merged_profile)
        assistant_message, quick_replies = build_assistant_prompt(
            "plan_ready" if ready else stage,
            trainer_context.trainer_display_name,
        )

        fallback_triggered = False
        confidence_score = 0.85 if profile_patch else 0.45
        if stage == "goal" and not profile_patch:
            fallback_triggered = True
            confidence_score = 0.35
            self.trainer_review_service.queue_unanswered_question(
                trainer_id=trainer_context.trainer_id,
                client_id=trainer_context.client_id,
                conversation_id=conversation["id"],
                message_id=user_message["id"],
                user_question=request.message,
                model_draft_answer=assistant_message,
                confidence_score=confidence_score,
            )

        self.repository.save_message(
            conversation["id"],
            "assistant",
            assistant_message,
            {
                "trainer_id": trainer_context.trainer_id,
                "persona_id": trainer_context.persona_id,
                "confidence_score": confidence_score,
                "quick_replies": quick_replies,
                "fallback_triggered": fallback_triggered,
            },
        )
        self.repository.update_conversation_state(
            conversation["id"],
            "plan_ready" if ready else stage,
            ready,
        )

        return ChatResponse(
            conversation_id=conversation["id"],
            assistant_message=assistant_message,
            quick_replies=quick_replies,
            conversation_state=ConversationState(
                current_stage="plan_ready" if ready else stage,
                onboarding_complete=ready,
            ),
            profile_patch=profile_patch,
            trainer_context={
                "tenant_id": trainer_context.tenant_id,
                "trainer_id": trainer_context.trainer_id,
                "trainer_display_name": trainer_context.trainer_display_name,
                "persona_id": trainer_context.persona_id,
                "persona_name": trainer_context.persona_name,
            },
            fallback_triggered=fallback_triggered,
        )
