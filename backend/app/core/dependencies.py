from fastapi import Depends
from supabase import Client

from app.core.auth import AuthenticatedUser, require_user
from app.core.tenancy import TrainerContext, resolve_trainer_context
from app.db.client import get_supabase_admin_client, get_supabase_user_client
from app.modules.conversation.repository import ConversationRepository
from app.modules.conversation.service import ConversationService
from app.modules.daily_checkins.repository import DailyCheckinRepository
from app.modules.daily_checkins.service import DailyCheckinService
from app.modules.plan.repository import PlanRepository
from app.modules.plan.service import PlanService
from app.modules.profile.repository import ProfileRepository
from app.modules.profile.service import ProfileService
from app.modules.trainer_knowledge.repository import TrainerKnowledgeRepository
from app.modules.trainer_knowledge.service import TrainerKnowledgeService
from app.modules.trainer_home.repository import TrainerHomeRepository
from app.modules.trainer_home.service import TrainerHomeService
from app.modules.trainer_persona.repository import TrainerPersonaRepository
from app.modules.trainer_persona.service import TrainerPersonaService
from app.modules.trainer_review.repository import TrainerReviewRepository
from app.modules.trainer_review.service import TrainerReviewService
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


def get_trainer_home_service(
    repository: TrainerHomeRepository = Depends(get_trainer_home_repository),
) -> TrainerHomeService:
    return TrainerHomeService(repository)


def get_trainer_review_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerReviewRepository:
    return TrainerReviewRepository(supabase)


def get_trainer_review_service(
    repository: TrainerReviewRepository = Depends(get_trainer_review_repository),
) -> TrainerReviewService:
    return TrainerReviewService(repository)


def get_conversation_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> ConversationRepository:
    return ConversationRepository(supabase)


def get_conversation_service(
    repository: ConversationRepository = Depends(get_conversation_repository),
    profile_service: ProfileService = Depends(get_profile_service),
    trainer_review_service: TrainerReviewService = Depends(get_trainer_review_service),
    trainer_persona_repository: TrainerPersonaRepository = Depends(get_trainer_persona_repository),
) -> ConversationService:
    return ConversationService(repository, profile_service, trainer_review_service, trainer_persona_repository)
