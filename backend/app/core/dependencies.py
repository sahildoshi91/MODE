import time
from collections.abc import Callable
from dataclasses import asdict
import threading

from fastapi import Depends, Request
from supabase import Client

from app.core.auth import AuthenticatedUser, require_user
from app.core.config import settings
from app.core.tenancy import TrainerContext, resolve_trainer_context_bootstrap, resolve_trainer_context_bootstrap_token
from app.db.client import get_supabase_admin_client, get_supabase_user_client
from app.modules.ai_feedback.repository import AIFeedbackRepository
from app.modules.ai_feedback.service import AIFeedbackService
from app.modules.account_deletion.repository import AccountDeletionRepository
from app.modules.account_deletion.service import AccountDeletionService
from app.modules.atlas.repository import AtlasRepository
from app.modules.atlas.service import (
    AtlasObserverService,
    AtlasReviewQueueService,
    AtlasTrainerDeletionObserver,
    TrainerAiReviewQueueService,
)
from app.modules.chat_sessions.repository import ChatSessionHistoryRepository, ChatSessionRepository
from app.modules.chat_sessions.service import ChatSessionService
from app.modules.conversation.repository import ConversationRepository
from app.modules.conversation.service import ConversationService
from app.modules.daily_checkins.repository import DailyCheckinRepository
from app.modules.daily_checkins.service import DailyCheckinService
from app.modules.progress.repository import ProgressRepository
from app.modules.progress.service import ProgressService
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

_trainer_context_cache: dict[str, tuple[float, TrainerContext]] = {}
_trainer_context_locks: dict[str, threading.Lock] = {}
_trainer_context_locks_guard = threading.Lock()


def clear_trainer_context_cache() -> None:
    _trainer_context_cache.clear()
    with _trainer_context_locks_guard:
        _trainer_context_locks.clear()


def invalidate_trainer_context_cache(user_id: str) -> None:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return
    _trainer_context_cache.pop(normalized_user_id, None)
    with _trainer_context_locks_guard:
        _trainer_context_locks.pop(normalized_user_id, None)
    try:
        from app.modules.conversation.cache import get_chat_cache

        get_chat_cache().delete(trainer_context_shared_cache_key(normalized_user_id))
    except Exception:
        return


def _trainer_context_cache_ttl_seconds() -> int:
    return max(1, min(int(settings.tenant_context_cache_ttl_seconds), 120))


def _get_cached_trainer_context(user_id: str) -> TrainerContext | None:
    cached = _trainer_context_cache.get(user_id)
    if not cached:
        return None
    expires_at, context = cached
    if expires_at <= time.monotonic():
        _trainer_context_cache.pop(user_id, None)
        return None
    return context


def _set_cached_trainer_context(user_id: str, context: TrainerContext) -> None:
    _trainer_context_cache[user_id] = (
        time.monotonic() + _trainer_context_cache_ttl_seconds(),
        context,
    )


def trainer_context_shared_cache_key(user_id: str) -> str:
    return f"mode:tenant_context:{user_id}"


def _trainer_context_shared_cache_key(user_id: str) -> str:
    return trainer_context_shared_cache_key(user_id)


def _get_trainer_context_lock(user_id: str) -> threading.Lock:
    with _trainer_context_locks_guard:
        lock = _trainer_context_locks.get(user_id)
        if lock is None:
            lock = threading.Lock()
            _trainer_context_locks[user_id] = lock
        return lock


def _coerce_cached_trainer_context(payload: object) -> TrainerContext | None:
    if not isinstance(payload, dict):
        return None
    allowed_keys = set(TrainerContext.__dataclass_fields__.keys())
    values = {key: payload.get(key) for key in allowed_keys if key in payload}
    try:
        return TrainerContext(**values)
    except TypeError:
        return None


def _get_shared_cached_trainer_context(user_id: str) -> TrainerContext | None:
    try:
        from app.modules.conversation.cache import get_chat_cache

        cached = get_chat_cache().get_json(_trainer_context_shared_cache_key(user_id))
    except Exception:
        return None
    return _coerce_cached_trainer_context(cached)


def _set_shared_cached_trainer_context(user_id: str, context: TrainerContext) -> None:
    try:
        from app.modules.conversation.cache import get_chat_cache

        get_chat_cache().set_json(
            _trainer_context_shared_cache_key(user_id),
            asdict(context),
            _trainer_context_cache_ttl_seconds(),
        )
    except Exception:
        return


def get_request_scoped_supabase_client(
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
) -> Client:
    if not user.access_token:
        raise ValueError("Authenticated user is missing access token")
    cached = getattr(request.state, "supabase_user_client", None)
    if cached is not None:
        request.state.supabase_client_construct_ms = 0
        request.state.supabase_client_cache_hit = True
        return cached
    started_at = time.perf_counter()
    client = get_supabase_user_client(user.access_token)
    request.state.supabase_client_construct_ms = max(int((time.perf_counter() - started_at) * 1000), 0)
    request.state.supabase_client_cache_hit = False
    request.state.supabase_user_client = client
    return client


def get_internal_atlas_repository() -> AtlasRepository:
    return AtlasRepository(get_supabase_admin_client())


def get_atlas_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> AtlasRepository:
    return AtlasRepository(supabase)


def get_atlas_observer_service(
    repository: AtlasRepository = Depends(get_atlas_repository),
) -> AtlasObserverService:
    return AtlasObserverService(repository)


def get_atlas_review_queue_service(
    repository: AtlasRepository = Depends(get_atlas_repository),
) -> AtlasReviewQueueService:
    return AtlasReviewQueueService(repository)


def get_trainer_ai_review_queue_service(
    repository: AtlasRepository = Depends(get_atlas_repository),
) -> TrainerAiReviewQueueService:
    return TrainerAiReviewQueueService(repository)


def get_atlas_trainer_deletion_observer(
    repository: AtlasRepository = Depends(get_atlas_repository),
) -> AtlasTrainerDeletionObserver:
    return AtlasTrainerDeletionObserver(repository)


def get_internal_atlas_trainer_deletion_observer(
    repository: AtlasRepository = Depends(get_internal_atlas_repository),
) -> AtlasTrainerDeletionObserver:
    return AtlasTrainerDeletionObserver(repository)


def get_internal_account_deletion_repository() -> AccountDeletionRepository:
    return AccountDeletionRepository(get_supabase_admin_client())


def get_internal_account_deletion_service(
    repository: AccountDeletionRepository = Depends(get_internal_account_deletion_repository),
    atlas_trainer_deletion_observer: AtlasTrainerDeletionObserver = Depends(
        get_internal_atlas_trainer_deletion_observer
    ),
) -> AccountDeletionService:
    return AccountDeletionService(repository, atlas_trainer_deletion_observer=atlas_trainer_deletion_observer)


def get_workout_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> WorkoutRepository:
    return WorkoutRepository(supabase)


def get_workout_service(
    repository: WorkoutRepository = Depends(get_workout_repository),
) -> WorkoutService:
    return WorkoutService(repository)


def get_trainer_context(
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
) -> TrainerContext:
    started_at = time.perf_counter()
    cached = _get_cached_trainer_context(user.id)
    if cached is not None:
        request.state.trainer_context_cache_hit = True
        request.state.tenant_context_cache_hit = True
        request.state.tenant_context_shared_cache_hit = False
        request.state.tenant_context_rpc_used = False
        request.state.trainer_context_resolve_ms = max(int((time.perf_counter() - started_at) * 1000), 0)
        request.state.tenant_membership_ms = request.state.trainer_context_resolve_ms
        return cached
    shared_cached = _get_shared_cached_trainer_context(user.id)
    if shared_cached is not None:
        _set_cached_trainer_context(user.id, shared_cached)
        request.state.trainer_context_cache_hit = True
        request.state.tenant_context_cache_hit = True
        request.state.tenant_context_shared_cache_hit = True
        request.state.tenant_context_rpc_used = False
        request.state.trainer_context_resolve_ms = max(int((time.perf_counter() - started_at) * 1000), 0)
        request.state.tenant_membership_ms = request.state.trainer_context_resolve_ms
        return shared_cached

    lock = _get_trainer_context_lock(user.id)
    wait_started_at = time.perf_counter()
    with lock:
        request.state.tenant_context_singleflight_wait_ms = max(
            int((time.perf_counter() - wait_started_at) * 1000),
            0,
        )
        cached = _get_cached_trainer_context(user.id)
        if cached is not None:
            request.state.trainer_context_cache_hit = True
            request.state.tenant_context_cache_hit = True
            request.state.tenant_context_shared_cache_hit = False
            request.state.tenant_context_rpc_used = False
            request.state.trainer_context_resolve_ms = max(int((time.perf_counter() - started_at) * 1000), 0)
            request.state.tenant_membership_ms = request.state.trainer_context_resolve_ms
            return cached
        shared_cached = _get_shared_cached_trainer_context(user.id)
        if shared_cached is not None:
            _set_cached_trainer_context(user.id, shared_cached)
            request.state.trainer_context_cache_hit = True
            request.state.tenant_context_cache_hit = True
            request.state.tenant_context_shared_cache_hit = True
            request.state.tenant_context_rpc_used = False
            request.state.trainer_context_resolve_ms = max(int((time.perf_counter() - started_at) * 1000), 0)
            request.state.tenant_membership_ms = request.state.trainer_context_resolve_ms
            return shared_cached

        try:
            context, rpc_used = resolve_trainer_context_bootstrap_token(user.access_token or "", user.id)
        except Exception:
            supabase_client = get_request_scoped_supabase_client(request, user)
            context, rpc_used = resolve_trainer_context_bootstrap(supabase_client, user.id)
        _set_cached_trainer_context(user.id, context)
        _set_shared_cached_trainer_context(user.id, context)
        request.state.trainer_context_cache_hit = False
        request.state.tenant_context_cache_hit = False
        request.state.tenant_context_shared_cache_hit = False
        request.state.tenant_context_rpc_used = bool(rpc_used)
        request.state.trainer_context_resolve_ms = max(int((time.perf_counter() - started_at) * 1000), 0)
        request.state.tenant_membership_ms = request.state.trainer_context_resolve_ms
        return context


def get_profile_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> ProfileRepository:
    return ProfileRepository(supabase)


def get_onboarding_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> OnboardingRepository:
    return OnboardingRepository(supabase)


def get_internal_onboarding_repository() -> OnboardingRepository:
    return OnboardingRepository(get_supabase_admin_client())


def get_onboarding_service(
    repository: OnboardingRepository = Depends(get_onboarding_repository),
) -> OnboardingService:
    return OnboardingService(repository)


def get_internal_onboarding_service(
    repository: OnboardingRepository = Depends(get_internal_onboarding_repository),
) -> OnboardingService:
    return OnboardingService(repository)


def get_mobile_analytics_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> MobileAnalyticsRepository:
    return MobileAnalyticsRepository(supabase)


def get_mobile_analytics_service(
    repository: MobileAnalyticsRepository = Depends(get_mobile_analytics_repository),
) -> MobileAnalyticsService:
    return MobileAnalyticsService(repository)


def get_profile_service(
    repository: ProfileRepository = Depends(get_profile_repository),
) -> ProfileService:
    return ProfileService(repository, delete_repository=repository)


def get_daily_checkin_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> DailyCheckinRepository:
    return DailyCheckinRepository(supabase)


def get_daily_checkin_service(
    repository: DailyCheckinRepository = Depends(get_daily_checkin_repository),
    profile_service: ProfileService = Depends(get_profile_service),
) -> DailyCheckinService:
    return DailyCheckinService(repository, profile_service=profile_service)


def get_progress_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> ProgressRepository:
    return ProgressRepository(supabase)


def get_progress_service(
    repository: ProgressRepository = Depends(get_progress_repository),
) -> ProgressService:
    return ProgressService(repository)


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


def get_trainer_home_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerHomeRepository:
    return TrainerHomeRepository(supabase)


def get_ai_feedback_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> AIFeedbackRepository:
    return AIFeedbackRepository(supabase)


def get_ai_feedback_logger_service(
    repository: AIFeedbackRepository = Depends(get_ai_feedback_repository),
    atlas_observer_service: AtlasObserverService = Depends(get_atlas_observer_service),
) -> AIFeedbackService:
    return AIFeedbackService(repository, atlas_observer_service=atlas_observer_service)


def get_internal_ai_feedback_logger_service() -> AIFeedbackService:
    # Internal-only: uses the service-role client to write AI output logs.
    # Must not be injected into user-facing route handlers — only used inside
    # internal service factories (e.g. _build_conversation_service_for_request).
    return AIFeedbackService(AIFeedbackRepository(get_supabase_admin_client()))


def get_trainer_intelligence_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerIntelligenceRepository:
    return TrainerIntelligenceRepository(supabase)


def get_trainer_intelligence_service(
    repository: TrainerIntelligenceRepository = Depends(get_trainer_intelligence_repository),
) -> TrainerIntelligenceService:
    return TrainerIntelligenceService(repository)


def get_trainer_home_service(
    repository: TrainerHomeRepository = Depends(get_trainer_home_repository),
    ai_feedback_logger_service: AIFeedbackService = Depends(get_ai_feedback_logger_service),
) -> TrainerHomeService:
    return TrainerHomeService(repository, ai_feedback_logger_service=ai_feedback_logger_service)


def get_trainer_client_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerClientRepository:
    return TrainerClientRepository(supabase)


def get_trainer_client_service(
    repository: TrainerClientRepository = Depends(get_trainer_client_repository),
) -> TrainerClientService:
    return TrainerClientService(repository)


def get_trainer_settings_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerSettingsRepository:
    return TrainerSettingsRepository(supabase)


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
    atlas_observer_service: AtlasObserverService = Depends(get_atlas_observer_service),
) -> TrainerReviewService:
    return TrainerReviewService(
        repository,
        ai_feedback_logger_service=ai_feedback_logger_service,
        atlas_observer_service=atlas_observer_service,
    )


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


def get_ai_feedback_service(
    repository: AIFeedbackRepository = Depends(get_ai_feedback_repository),
    atlas_observer_service: AtlasObserverService = Depends(get_atlas_observer_service),
) -> AIFeedbackService:
    return AIFeedbackService(repository, atlas_observer_service=atlas_observer_service)


def get_trainer_coach_service(
    repository: TrainerCoachRepository = Depends(get_trainer_coach_repository),
    ai_feedback_service: AIFeedbackService = Depends(get_ai_feedback_service),
    trainer_home_service: TrainerHomeService = Depends(get_trainer_home_service),
    atlas_observer_service: AtlasObserverService = Depends(get_atlas_observer_service),
) -> TrainerCoachService:
    return TrainerCoachService(
        repository=repository,
        ai_feedback_service=ai_feedback_service,
        trainer_home_service=trainer_home_service,
        atlas_observer_service=atlas_observer_service,
    )


def get_trainer_assistant_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> TrainerAssistantRepository:
    return TrainerAssistantRepository(supabase)


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
    ai_feedback_logger_service: AIFeedbackService = Depends(get_internal_ai_feedback_logger_service),
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


def _build_conversation_service_for_request(request: Request, user: AuthenticatedUser) -> ConversationService:
    supabase = get_request_scoped_supabase_client(request, user)
    profile_repository = ProfileRepository(supabase)
    profile_service = ProfileService(profile_repository, delete_repository=profile_repository)
    atlas_repository = AtlasRepository(supabase)
    atlas_observer_service = AtlasObserverService(atlas_repository)
    ai_feedback_repository = AIFeedbackRepository(supabase)
    ai_feedback_service = AIFeedbackService(
        ai_feedback_repository,
        atlas_observer_service=atlas_observer_service,
    )
    trainer_persona_repository = TrainerPersonaRepository(supabase)
    trainer_onboarding_service = TrainerOnboardingService(
        repository=TrainerOnboardingRepository(supabase),
        trainer_persona_repository=trainer_persona_repository,
    )
    return ConversationService(
        ConversationRepository(supabase),
        profile_service,
        TrainerReviewService(
            TrainerReviewRepository(supabase),
            ai_feedback_logger_service=ai_feedback_service,
            atlas_observer_service=atlas_observer_service,
        ),
        trainer_persona_repository,
        trainer_onboarding_service=trainer_onboarding_service,
        ai_feedback_logger_service=get_internal_ai_feedback_logger_service(),
        trainer_intelligence_service=TrainerIntelligenceService(TrainerIntelligenceRepository(supabase)),
    )


def get_conversation_service_factory(
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
) -> Callable[[], ConversationService]:
    service: ConversationService | None = None

    def factory() -> ConversationService:
        nonlocal service
        if service is None:
            service = _build_conversation_service_for_request(request, user)
        return service

    return factory


def get_chat_session_repository(
    supabase: Client = Depends(get_request_scoped_supabase_client),
) -> ChatSessionRepository:
    return ChatSessionRepository(supabase, admin_supabase=get_supabase_admin_client())


def get_chat_session_service(
    repository: ChatSessionRepository = Depends(get_chat_session_repository),
    conversation_service: ConversationService = Depends(get_conversation_service),
    trainer_home_service: TrainerHomeService = Depends(get_trainer_home_service),
    daily_checkin_service: DailyCheckinService = Depends(get_daily_checkin_service),
) -> ChatSessionService:
    return ChatSessionService(
        repository,
        conversation_service=conversation_service,
        trainer_home_service=trainer_home_service,
        daily_checkin_service=daily_checkin_service,
    )


def get_chat_session_history_service(
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
) -> ChatSessionService:
    request.state.supabase_client_construct_ms = 0
    request.state.supabase_client_cache_hit = True
    return ChatSessionService(ChatSessionHistoryRepository(user.access_token or ""))
