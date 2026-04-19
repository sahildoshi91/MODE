from fastapi import Depends
from supabase import Client

from app.core.auth import AuthenticatedUser, require_user
from app.core.tenancy import TrainerContext, resolve_trainer_context
from app.db.client import get_supabase_admin_client, get_supabase_user_client
from app.modules.ai_feedback.repository import AIFeedbackRepository
from app.modules.ai_feedback.service import AIFeedbackService
from app.modules.conversation.repository import ConversationRepository
from app.modules.conversation.service import ConversationService
from app.modules.daily_checkins.repository import DailyCheckinRepository
from app.modules.daily_checkins.service import DailyCheckinService
from app.modules.mobile_analytics.repository import MobileAnalyticsRepository
from app.modules.mobile_analytics.service import MobileAnalyticsService
from app.modules.onboarding.repository import OnboardingRepository
from app.modules.onboarding.service import OnboardingService
from app.modules.plan.repository import PlanRepository
from app.modules.plan.service import PlanService
from app.modules.profile.repository import ProfileRepository
from app.modules.profile.service import ProfileService
from app.modules.trainer_knowledge.repository import TrainerKnowledgeRepository
from app.modules.trainer_knowledge.service import TrainerKnowledgeService
from app.modules.trainer_clients.repository import TrainerClientRepository
from app.modules.trainer_clients.service import TrainerClientService
from app.modules.trainer_home.repository import TrainerHomeRepository
from app.modules.trainer_home.service import TrainerHomeService
from app.modules.trainer_intelligence.repository import TrainerIntelligenceRepository
from app.modules.trainer_intelligence.service import TrainerIntelligenceService
from app.modules.trainer_onboarding.repository import TrainerOnboardingRepository
from app.modules.trainer_onboarding.service import TrainerOnboardingService
from app.modules.trainer_persona.repository import TrainerPersonaRepository
from app.modules.trainer_persona.service import TrainerPersonaService
from app.modules.trainer_programs.repository import TrainerProgramRepository
from app.modules.trainer_programs.service import TrainerProgramService
from app.modules.trainer_review.repository import TrainerReviewRepository
from app.modules.trainer_review.service import TrainerReviewService
from app.modules.trainer_coach.repository import TrainerCoachRepository
from app.modules.trainer_coach.service import TrainerCoachService
from app.modules.trainer_assistant.repository import TrainerAssistantRepository
from app.modules.trainer_assistant.service import TrainerAssistantService
from app.modules.trainer_settings.repository import TrainerSettingsRepository
from app.modules.trainer_settings.service import TrainerSettingsService
from app.modules.workout.repository import WorkoutRepository
from app.modules.workout.service import WorkoutService


def get_request_scoped_supabase_client(
    user: AuthenticatedUser = Depends(require_user),
) -> Client:
    if not user.access_token:
        raise ValueError("Authenticated user is missing access token")
    return get_supabase_user_client(user.access_token)


def get_workout_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> WorkoutRepository:
    return WorkoutRepository(supabase)


def get_workout_service(
    repository: WorkoutRepository = Depends(get_workout_repository),
) -> WorkoutService:
    return WorkoutService(repository)


def get_trainer_context(
    user: AuthenticatedUser = Depends(require_user),
) -> TrainerContext:
    return resolve_trainer_context(get_supabase_admin_client(), user.id)


def get_profile_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> ProfileRepository:
    return ProfileRepository(supabase)


def get_onboarding_repository() -> OnboardingRepository:
    return OnboardingRepository(get_supabase_admin_client())


def get_onboarding_service(
    repository: OnboardingRepository = Depends(get_onboarding_repository),
) -> OnboardingService:
    return OnboardingService(repository)


def get_mobile_analytics_repository() -> MobileAnalyticsRepository:
    return MobileAnalyticsRepository(get_supabase_admin_client())


def get_mobile_analytics_service(
    repository: MobileAnalyticsRepository = Depends(get_mobile_analytics_repository),
) -> MobileAnalyticsService:
    return MobileAnalyticsService(repository)


def get_profile_service(
    repository: ProfileRepository = Depends(get_profile_repository),
) -> ProfileService:
    return ProfileService(repository)


def get_daily_checkin_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> DailyCheckinRepository:
    return DailyCheckinRepository(supabase)


def get_daily_checkin_service(
    repository: DailyCheckinRepository = Depends(get_daily_checkin_repository),
    profile_service: ProfileService = Depends(get_profile_service),
) -> DailyCheckinService:
    return DailyCheckinService(repository, profile_service=profile_service)


def get_plan_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> PlanRepository:
    return PlanRepository(supabase)


def get_plan_service(
    repository: PlanRepository = Depends(get_plan_repository),
    profile_service: ProfileService = Depends(get_profile_service),
) -> PlanService:
    return PlanService(repository, profile_service)


def get_trainer_persona_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerPersonaRepository:
    return TrainerPersonaRepository(supabase)


def get_trainer_persona_service(
    repository: TrainerPersonaRepository = Depends(get_trainer_persona_repository),
) -> TrainerPersonaService:
    return TrainerPersonaService(repository)


def get_trainer_onboarding_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerOnboardingRepository:
    return TrainerOnboardingRepository(supabase)


def get_trainer_onboarding_service(
    repository: TrainerOnboardingRepository = Depends(get_trainer_onboarding_repository),
    trainer_persona_repository: TrainerPersonaRepository = Depends(get_trainer_persona_repository),
) -> TrainerOnboardingService:
    return TrainerOnboardingService(
        repository=repository,
        trainer_persona_repository=trainer_persona_repository,
    )


def get_trainer_knowledge_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerKnowledgeRepository:
    return TrainerKnowledgeRepository(supabase)


def get_trainer_knowledge_service(
    repository: TrainerKnowledgeRepository = Depends(get_trainer_knowledge_repository),
) -> TrainerKnowledgeService:
    return TrainerKnowledgeService(repository)


def get_trainer_home_repository() -> TrainerHomeRepository:
    return TrainerHomeRepository(get_supabase_admin_client())


def get_ai_feedback_admin_repository() -> AIFeedbackRepository:
    return AIFeedbackRepository(get_supabase_admin_client())


def get_ai_feedback_logger_service(
    repository: AIFeedbackRepository = Depends(get_ai_feedback_admin_repository),
) -> AIFeedbackService:
    return AIFeedbackService(repository)


def get_trainer_intelligence_repository() -> TrainerIntelligenceRepository:
    return TrainerIntelligenceRepository(get_supabase_admin_client())


def get_trainer_intelligence_service(
    repository: TrainerIntelligenceRepository = Depends(get_trainer_intelligence_repository),
) -> TrainerIntelligenceService:
    return TrainerIntelligenceService(repository)


def get_trainer_home_service(
    repository: TrainerHomeRepository = Depends(get_trainer_home_repository),
    ai_feedback_logger_service: AIFeedbackService = Depends(get_ai_feedback_logger_service),
) -> TrainerHomeService:
    return TrainerHomeService(repository, ai_feedback_logger_service=ai_feedback_logger_service)


def get_trainer_client_repository() -> TrainerClientRepository:
    return TrainerClientRepository(get_supabase_admin_client())


def get_trainer_client_service(
    repository: TrainerClientRepository = Depends(get_trainer_client_repository),
) -> TrainerClientService:
    return TrainerClientService(repository)


def get_trainer_settings_repository() -> TrainerSettingsRepository:
    return TrainerSettingsRepository(get_supabase_admin_client())


def get_trainer_settings_service(
    repository: TrainerSettingsRepository = Depends(get_trainer_settings_repository),
) -> TrainerSettingsService:
    return TrainerSettingsService(repository)


def get_trainer_review_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerReviewRepository:
    return TrainerReviewRepository(supabase)


def get_trainer_review_service(
    repository: TrainerReviewRepository = Depends(get_trainer_review_repository),
    ai_feedback_logger_service: AIFeedbackService = Depends(get_ai_feedback_logger_service),
) -> TrainerReviewService:
    return TrainerReviewService(repository, ai_feedback_logger_service=ai_feedback_logger_service)


def get_trainer_program_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerProgramRepository:
    return TrainerProgramRepository(supabase)


def get_trainer_program_service(
    repository: TrainerProgramRepository = Depends(get_trainer_program_repository),
) -> TrainerProgramService:
    return TrainerProgramService(repository)


def get_trainer_coach_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerCoachRepository:
    return TrainerCoachRepository(supabase)


def get_ai_feedback_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> AIFeedbackRepository:
    return AIFeedbackRepository(supabase)


def get_ai_feedback_service(
    repository: AIFeedbackRepository = Depends(get_ai_feedback_repository),
) -> AIFeedbackService:
    return AIFeedbackService(repository)


def get_trainer_coach_service(
    repository: TrainerCoachRepository = Depends(get_trainer_coach_repository),
    ai_feedback_service: AIFeedbackService = Depends(get_ai_feedback_service),
    trainer_home_service: TrainerHomeService = Depends(get_trainer_home_service),
) -> TrainerCoachService:
    return TrainerCoachService(
        repository=repository,
        ai_feedback_service=ai_feedback_service,
        trainer_home_service=trainer_home_service,
    )


def get_trainer_assistant_repository(
) -> TrainerAssistantRepository:
    return TrainerAssistantRepository(get_supabase_admin_client())


def get_trainer_assistant_service(
    repository: TrainerAssistantRepository = Depends(get_trainer_assistant_repository),
    trainer_home_service: TrainerHomeService = Depends(get_trainer_home_service),
    trainer_client_service: TrainerClientService = Depends(get_trainer_client_service),
    ai_feedback_service: AIFeedbackService = Depends(get_ai_feedback_service),
    trainer_intelligence_service: TrainerIntelligenceService = Depends(get_trainer_intelligence_service),
) -> TrainerAssistantService:
    return TrainerAssistantService(
        repository=repository,
        trainer_home_service=trainer_home_service,
        trainer_client_service=trainer_client_service,
        ai_feedback_service=ai_feedback_service,
        trainer_intelligence_service=trainer_intelligence_service,
    )


def get_conversation_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> ConversationRepository:
    return ConversationRepository(supabase)


def get_conversation_service(
    repository: ConversationRepository = Depends(get_conversation_repository),
    profile_service: ProfileService = Depends(get_profile_service),
    trainer_review_service: TrainerReviewService = Depends(get_trainer_review_service),
    trainer_persona_repository: TrainerPersonaRepository = Depends(get_trainer_persona_repository),
    trainer_onboarding_service: TrainerOnboardingService = Depends(get_trainer_onboarding_service),
    ai_feedback_logger_service: AIFeedbackService = Depends(get_ai_feedback_logger_service),
    trainer_intelligence_service: TrainerIntelligenceService = Depends(get_trainer_intelligence_service),
) -> ConversationService:
    return ConversationService(
        repository,
        profile_service,
        trainer_review_service,
        trainer_persona_repository,
        trainer_onboarding_service=trainer_onboarding_service,
        ai_feedback_logger_service=ai_feedback_logger_service,
        trainer_intelligence_service=trainer_intelligence_service,
    )
