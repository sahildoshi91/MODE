from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import logging
import re
from typing import TYPE_CHECKING, Any

from app.core.tenancy import TrainerContext
from app.modules.chat_sessions.repository import ChatSessionRepository
from app.modules.chat_sessions.schemas import (
    ChatSessionContinueRequest,
    ChatSessionDetailResponse,
    ChatSessionListResponse,
    ChatSessionMessage,
    ChatSessionRecord,
    ChatSessionSendRequest,
    ChatSessionSendResponse,
    ChatSessionTodayRequest,
    ChatSessionTodayResponse,
)
from app.modules.conversation.schemas import ChatRequest
from app.modules.conversation.service import ConversationService
from app.modules.daily_checkins.schemas import CheckinResponseOutput
from app.modules.motivation import build_mindset_why_cue
from app.modules.trainer_home.service import TrainerHomeService

if TYPE_CHECKING:
    from app.modules.daily_checkins.service import DailyCheckinService


CLIENT_SUGGESTED_ACTIONS = [
    "Finish a workout",
    "Reach step goal",
    "Increase my strain",
    "Log a meal",
    "Help me recover",
]
CLIENT_MODE_BRIEF_ACTIONS = [
    "Build me a training routine",
    "Build me a nutrition plan",
    "Talk through today's focus",
]
TRAINER_SUGGESTED_ACTIONS = [
    "Review flagged clients",
    "Draft check-in",
    "Show priorities",
    "Review missed clients",
]
TRAINER_FLAG_REVIEW_SOURCE = "trainer_command_center_flag_review_v3"
TRAINER_FLAG_REVIEW_ACTION = "review_flagged_clients"
TRAINER_FLAG_REVIEW_CLIENT_LIMIT = 5
TRAINER_FLAG_REVIEW_CLIENT_WORD_LIMIT = 75
TRAINER_FLAG_REVIEW_LLM_MODEL = "gpt-5.4"
LEGACY_LOCAL_DAY_SEND_GRACE = timedelta(hours=12)
CLIENT_MODE_BRIEF_SOURCE = "client_daily_mode_brief_v1"
CLIENT_CHECKIN_RESPONSE_BRIEF_SOURCE = "client_daily_checkin_response_v1"
CLIENT_NO_CHECKIN_SOURCE = "client_daily_no_checkin_v1"
CLIENT_MODE_BRIEF_WORD_LIMIT = 75
CLIENT_CHECKIN_RESPONSE_SECTION_IDS = ("opening", "workout", "nutrition", "why", "question")
LEGACY_TO_CANONICAL_MODE = {
    "GREEN": "BEAST",
    "YELLOW": "BUILD",
    "BLUE": "RECOVER",
    "RED": "REST",
}

logger = logging.getLogger(__name__)

CLIENT_MODE_BRIEF_BUNDLES = {
    "BEAST": {
        "tagline": "Full-send readiness.",
        "training": ("45-60 min", "High", "Strength or HIIT"),
        "nutrition": "Protein early, carbs around training, steady fluids.",
        "mindset": "Attack the day. You are cleared to push.",
    },
    "BUILD": {
        "tagline": "Stable readiness.",
        "training": ("30-45 min", "Moderate", "Moderate cardio or controlled strength"),
        "nutrition": "Protein each meal, balanced carbs, intentional snacks.",
        "mindset": "Build momentum with disciplined reps.",
    },
    "RECOVER": {
        "tagline": "Recovery-leaning day.",
        "training": ("20-30 min", "Low", "Light movement or recovery"),
        "nutrition": "Protein at each meal, simple whole-food meals (minimally processed, easy to prep), hydrate first.",
        "mindset": "Recovery done well is progress.",
    },
    "REST": {
        "tagline": "Restore and protect tomorrow.",
        "training": ("10-20 min", "Very low", "Mobility, walking, or restorative movement"),
        "nutrition": "Protein, colorful plants, and fluids for recovery.",
        "mindset": "Rest with intent so you can return stronger.",
    },
}


class ChatSessionAccessError(ValueError):
    """Raised when the authenticated actor cannot use the requested chat scope."""


class ChatSessionNotFoundError(ValueError):
    """Raised when a specific persisted chat session cannot be found."""


@dataclass(frozen=True)
class ChatSessionScope:
    user_id: str
    trainer_id: str | None
    client_id: str | None
    role: str
    session_type: str
    session_date: date
    trainer_context: TrainerContext


class ChatSessionService:
    def __init__(
        self,
        repository: ChatSessionRepository,
        *,
        conversation_service: ConversationService | None = None,
        trainer_home_service: TrainerHomeService | None = None,
        daily_checkin_service: "DailyCheckinService | None" = None,
    ):
        self.repository = repository
        self.conversation_service = conversation_service
        self.trainer_home_service = trainer_home_service
        self.daily_checkin_service = daily_checkin_service

    def get_or_create_today_session(
        self,
        *,
        user_id: str,
        trainer_context: TrainerContext,
        request: ChatSessionTodayRequest,
    ) -> ChatSessionTodayResponse:
        scope = self._resolve_scope(
            user_id=user_id,
            trainer_context=trainer_context,
            role=request.role,
            session_type=request.session_type,
            client_id=str(request.client_id) if request.client_id else None,
            session_date=request.session_date or self._today(),
        )
        self.repository.archive_older_sessions(
            user_id=scope.user_id,
            trainer_id=scope.trainer_id,
            client_id=scope.client_id,
            role=scope.role,
            session_type=scope.session_type,
            before_date=scope.session_date,
        )
        session = self.repository.find_session(
            user_id=scope.user_id,
            trainer_id=scope.trainer_id,
            client_id=scope.client_id,
            role=scope.role,
            session_type=scope.session_type,
            session_date=scope.session_date,
        )
        if not session:
            session = self.repository.create_session(
                user_id=scope.user_id,
                trainer_id=scope.trainer_id,
                client_id=scope.client_id,
                role=scope.role,
                session_type=scope.session_type,
                session_date=scope.session_date,
                title=self._default_title(scope),
                metadata=request.metadata,
            )
        opening = self._ensure_opening_summary(scope=scope, session=session)
        messages = self.repository.list_messages(str(session["id"]), limit=250)
        if not messages and opening:
            messages = [opening]
        session = self.repository.get_session(str(session["id"])) or session
        suggested_actions = self._suggested_actions_from_messages(messages, scope.role)
        session = self._with_client_name(scope, session)
        return ChatSessionTodayResponse(
            session=self._to_session_record(session, current_date=scope.session_date),
            messages=[self._to_message(row) for row in messages],
            suggested_actions=suggested_actions,
            read_only=False,
        )

    def list_history(
        self,
        *,
        user_id: str,
        trainer_context: TrainerContext,
        role: str,
        session_type: str | None = None,
        limit: int = 80,
        offset: int = 0,
    ) -> ChatSessionListResponse:
        role = self._normalize_role(role)
        if session_type is not None:
            self._validate_session_type_for_role(role, session_type)
        scope = self._resolve_scope(
            user_id=user_id,
            trainer_context=trainer_context,
            role=role,
            session_type=session_type or ("client_chat" if role == "client" else "coach_ai"),
            client_id=None,
            session_date=self._today(),
            allow_default_client=True,
        )
        rows = self.repository.list_sessions(
            user_id=scope.user_id,
            trainer_id=scope.trainer_id,
            role=role,
            session_type=session_type,
            limit=limit,
            offset=offset,
        )
        if role == "client":
            rows = [row for row in rows if row.get("client_id") == scope.client_id]
        return ChatSessionListResponse(
            sessions=[self._to_session_record(row, current_date=scope.session_date) for row in rows],
        )

    def get_session_detail(
        self,
        *,
        user_id: str,
        trainer_context: TrainerContext,
        session_id: str,
        current_date: date | None = None,
        message_limit: int = 500,
        message_offset: int = 0,
    ) -> ChatSessionDetailResponse:
        session = self.repository.get_session(session_id)
        if not session:
            raise ChatSessionNotFoundError("Chat session not found")
        self._authorize_session(user_id=user_id, trainer_context=trainer_context, session=session)
        resolved_current_date = current_date or self._today()
        messages = self.repository.list_messages(
            str(session["id"]),
            limit=message_limit,
            offset=message_offset,
        )
        read_only = self._is_read_only(session, resolved_current_date)
        return ChatSessionDetailResponse(
            session=self._to_session_record(session, current_date=resolved_current_date),
            messages=[self._to_message(row) for row in messages],
            suggested_actions=self._suggested_actions_from_messages(messages, str(session.get("role") or "")),
            read_only=read_only,
        )

    def continue_from_session(
        self,
        *,
        user_id: str,
        trainer_context: TrainerContext,
        session_id: str,
        request: ChatSessionContinueRequest,
    ) -> ChatSessionTodayResponse:
        source = self.repository.get_session(session_id)
        if not source:
            raise ChatSessionNotFoundError("Chat session not found")
        self._authorize_session(user_id=user_id, trainer_context=trainer_context, session=source)
        role = str(source.get("role") or "")
        session_type = str(source.get("session_type") or "")
        scope = self._resolve_scope(
            user_id=user_id,
            trainer_context=trainer_context,
            role=role,
            session_type=session_type,
            client_id=source.get("client_id"),
            session_date=request.session_date or self._today(),
        )
        today_request = ChatSessionTodayRequest(
            role=role,  # type: ignore[arg-type]
            session_type=session_type,  # type: ignore[arg-type]
            client_id=scope.client_id,
            session_date=scope.session_date,
            metadata={
                **request.metadata,
                "continued_from_session_id": session_id,
            },
        )
        return self.get_or_create_today_session(
            user_id=user_id,
            trainer_context=trainer_context,
            request=today_request,
        )

    def send_message(
        self,
        *,
        user_id: str,
        trainer_context: TrainerContext,
        session_id: str,
        request: ChatSessionSendRequest,
    ) -> ChatSessionSendResponse:
        session = self.repository.get_session(session_id)
        if not session:
            raise ChatSessionNotFoundError("Chat session not found")
        self._authorize_session(user_id=user_id, trainer_context=trainer_context, session=session)
        current_date = self._effective_current_date(request, session)
        if self._is_read_only(session, current_date):
            raise ValueError("Chat session is archived")
        user_message = self.repository.append_message(
            session_id=session_id,
            sender_type="user",
            content=request.message,
            metadata={
                "client_message_id": request.client_message_id,
                "idempotency_key": request.idempotency_key,
            },
        )
        if self._is_atlas_client_session(session):
            response_text, response_metadata = self._build_atlas_response(
                user_id=user_id,
                session=session,
                request=request,
            )
            ai_message = self.repository.append_message(
                session_id=session_id,
                sender_type="ai",
                content=response_text,
                metadata=response_metadata,
            )
            updated_session = self.repository.get_session(session_id) or session
            return ChatSessionSendResponse(
                session=self._to_session_record(updated_session, current_date=current_date),
                user_message=self._to_message(user_message),
                ai_message=self._to_message(ai_message),
                suggested_actions=[],
            )
        trainer_action_response = self._build_trainer_action_response(
            trainer_context=trainer_context,
            session=session,
            request=request,
            current_date=current_date,
        )
        if trainer_action_response:
            response_text, response_metadata = trainer_action_response
            ai_message = self.repository.append_message(
                session_id=session_id,
                sender_type="ai",
                content=response_text,
                metadata=response_metadata,
            )
            updated_session = self.repository.get_session(session_id) or session
            return ChatSessionSendResponse(
                session=self._to_session_record(updated_session, current_date=current_date),
                user_message=self._to_message(user_message),
                ai_message=self._to_message(ai_message),
                suggested_actions=[],
            )
        if not self.conversation_service:
            raise ValueError("Chat response service unavailable")
        response = self.conversation_service.handle_chat(
            user_id,
            trainer_context,
            self._to_legacy_chat_request(request, session),
        )
        ai_message = self.repository.append_message(
            session_id=session_id,
            sender_type="ai",
            content=response.assistant_message,
            metadata={
                "request_id": response.request_id,
                "conversation_id": response.conversation_id,
                "fallback_triggered": response.fallback_triggered,
                "memory_suggestions": [item.model_dump() for item in response.memory_suggestions],
            },
        )
        updated_session = self.repository.get_session(session_id) or session
        return ChatSessionSendResponse(
            session=self._to_session_record(updated_session, current_date=current_date),
            user_message=self._to_message(user_message),
            ai_message=self._to_message(ai_message),
            suggested_actions=[],
        )

    def prepare_stream(
        self,
        *,
        user_id: str,
        trainer_context: TrainerContext,
        session_id: str,
        request: ChatSessionSendRequest,
    ):
        session = self.repository.get_session(session_id)
        if not session:
            raise ChatSessionNotFoundError("Chat session not found")
        self._authorize_session(user_id=user_id, trainer_context=trainer_context, session=session)
        current_date = self._effective_current_date(request, session)
        if self._is_read_only(session, current_date):
            raise ValueError("Chat session is archived")
        user_message = self.repository.append_message(
            session_id=session_id,
            sender_type="user",
            content=request.message,
            metadata={
                "client_message_id": request.client_message_id,
                "idempotency_key": request.idempotency_key,
            },
        )
        if self._is_atlas_client_session(session):
            response_text, response_metadata = self._build_atlas_response(
                user_id=user_id,
                session=session,
                request=request,
            )
            return (
                session,
                user_message,
                f"atlas:{session_id}",
                [response_text],
                {"assistant_message_metadata": response_metadata},
                None,
            )
        trainer_action_response = self._build_trainer_action_response(
            trainer_context=trainer_context,
            session=session,
            request=request,
            current_date=current_date,
        )
        if trainer_action_response:
            response_text, response_metadata = trainer_action_response
            return (
                session,
                user_message,
                f"{TRAINER_FLAG_REVIEW_ACTION}:{session_id}",
                [response_text],
                {"assistant_message_metadata": response_metadata},
                None,
            )
        if not self.conversation_service:
            raise ValueError("Chat response service unavailable")
        conversation_id, chunks, route_debug, result_state = self.conversation_service.stream_chat(
            user_id,
            trainer_context,
            self._to_legacy_chat_request(request, session),
        )
        return session, user_message, conversation_id, chunks, route_debug, result_state

    def persist_streamed_ai_message(
        self,
        *,
        session_id: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.repository.append_message(
            session_id=session_id,
            sender_type="ai",
            content=content,
            metadata=metadata or {},
        )

    def persist_post_stream_side_effects(
        self,
        *,
        trainer_context: TrainerContext,
        session: dict[str, Any],
        request: ChatSessionSendRequest,
        conversation_id: str,
    ) -> None:
        if not self.conversation_service or not conversation_id:
            return
        persist_memory = getattr(self.conversation_service, "persist_memory_after_response", None)
        if not callable(persist_memory):
            return
        try:
            persist_memory(
                trainer_context=trainer_context,
                request=self._to_legacy_chat_request(request, session),
                conversation_id=conversation_id,
            )
        except Exception:
            logger.exception(
                "Chat session post-stream side effects failed session_id=%s conversation_id=%s",
                session.get("id") if isinstance(session, dict) else None,
                conversation_id,
            )

    def _resolve_scope(
        self,
        *,
        user_id: str,
        trainer_context: TrainerContext,
        role: str,
        session_type: str,
        client_id: str | None,
        session_date: date,
        allow_default_client: bool = False,
    ) -> ChatSessionScope:
        role = self._normalize_role(role)
        self._validate_session_type_for_role(role, session_type)

        if role == "client":
            resolved_client_id = client_id or trainer_context.client_id
            if not resolved_client_id and allow_default_client:
                resolved_client_id = trainer_context.client_id
            if not resolved_client_id or resolved_client_id != trainer_context.client_id:
                raise ChatSessionAccessError("Client chat scope does not match this account")
            if trainer_context.client_user_id and trainer_context.client_user_id != user_id:
                raise ChatSessionAccessError("Client chat scope does not match this account")
            if session_type == "client_chat" and not trainer_context.trainer_id:
                raise ChatSessionAccessError("User is not assigned to an active trainer context")
            return ChatSessionScope(
                user_id=user_id,
                trainer_id=trainer_context.trainer_id if session_type != "atlas_client_chat" else None,
                client_id=resolved_client_id,
                role=role,
                session_type=session_type,
                session_date=session_date,
                trainer_context=trainer_context,
            )

        if not trainer_context.trainer_id:
            raise ChatSessionAccessError("User is not assigned to an active trainer context")
        if trainer_context.trainer_user_id and trainer_context.trainer_user_id != user_id:
            raise ChatSessionAccessError("Trainer chat scope does not match this account")
        resolved_client_id = str(client_id).strip() if client_id else None
        if resolved_client_id:
            client = self.repository.get_client_for_trainer(
                trainer_id=trainer_context.trainer_id,
                client_id=resolved_client_id,
            )
            if not client:
                raise ChatSessionAccessError("Trainer chat client is not assigned to this trainer")
        return ChatSessionScope(
            user_id=user_id,
            trainer_id=trainer_context.trainer_id,
            client_id=resolved_client_id,
            role=role,
            session_type=session_type,
            session_date=session_date,
            trainer_context=trainer_context,
        )

    def _authorize_session(self, *, user_id: str, trainer_context: TrainerContext, session: dict[str, Any]) -> None:
        role = str(session.get("role") or "")
        session_type = str(session.get("session_type") or "")
        client_id = str(session.get("client_id") or "").strip() or None
        session_date = self._coerce_date(session.get("session_date"), self._today())
        scope = self._resolve_scope(
            user_id=user_id,
            trainer_context=trainer_context,
            role=role,
            session_type=session_type,
            client_id=client_id,
            session_date=session_date,
            allow_default_client=True,
        )
        session_trainer_id = str(session.get("trainer_id")) if session.get("trainer_id") else None
        if str(session.get("user_id")) != scope.user_id or session_trainer_id != scope.trainer_id:
            raise ChatSessionAccessError("Chat session is not available for this account")
        if (session.get("client_id") or None) != scope.client_id:
            raise ChatSessionAccessError("Chat session is not available for this account")

    def _ensure_opening_summary(self, *, scope: ChatSessionScope, session: dict[str, Any]) -> dict[str, Any] | None:
        existing = self.repository.get_opening_summary_message(str(session["id"]))
        opening = self._build_opening_summary(scope)
        opening_metadata = {
            "auto_generated_opening_summary": True,
            "suggested_action_chips": opening["suggested_actions"],
            "summary_source": opening["source"],
            **(opening.get("metadata") or {}),
        }
        if existing:
            if self._should_refresh_opening_summary(existing, opening, opening_metadata):
                refreshed = self.repository.update_opening_summary_message(
                    session_id=str(session["id"]),
                    content=opening["text"],
                    metadata=opening_metadata,
                )
                metadata = session.get("metadata") if isinstance(session.get("metadata"), dict) else {}
                self.repository.update_session(
                    str(session["id"]),
                    {
                        "title": opening["title"],
                        "summary": opening["summary"],
                        "metadata": {
                            **metadata,
                            "opening_summary_generated_at": datetime.now(timezone.utc).isoformat(),
                            "suggested_action_chips": opening["suggested_actions"],
                        },
                    },
                )
                return refreshed or existing
            return existing
        message = self.repository.append_message(
            session_id=str(session["id"]),
            sender_type="ai",
            content=opening["text"],
            metadata=opening_metadata,
        )
        metadata = session.get("metadata") if isinstance(session.get("metadata"), dict) else {}
        self.repository.update_session(
            str(session["id"]),
            {
                "title": opening["title"],
                "summary": opening["summary"],
                "metadata": {
                    **metadata,
                    "opening_summary_generated_at": datetime.now(timezone.utc).isoformat(),
                    "suggested_action_chips": opening["suggested_actions"],
                },
            },
        )
        return message

    def _should_refresh_opening_summary(
        self,
        existing: dict[str, Any],
        opening: dict[str, Any],
        opening_metadata: dict[str, Any],
    ) -> bool:
        metadata = existing.get("metadata") if isinstance(existing.get("metadata"), dict) else {}
        if str(existing.get("content") or "") != str(opening.get("text") or ""):
            return True
        if metadata.get("summary_source") != opening_metadata.get("summary_source"):
            return True
        if metadata.get("analytics_fingerprint") != opening_metadata.get("analytics_fingerprint"):
            return True
        if metadata.get("checkin_id") != opening_metadata.get("checkin_id"):
            return True
        if metadata.get("checkin_response_attempted") != opening_metadata.get("checkin_response_attempted"):
            return True
        if metadata.get("checkin_response_generated_at") != opening_metadata.get("checkin_response_generated_at"):
            return True
        if metadata.get("model_used") != opening_metadata.get("model_used"):
            return True
        if metadata.get("checkin_response") != opening_metadata.get("checkin_response"):
            return True
        if metadata.get("suggested_action_chips") != opening_metadata.get("suggested_action_chips"):
            return True
        return False

    def _build_opening_summary(self, scope: ChatSessionScope) -> dict[str, Any]:
        if scope.role == "trainer":
            return self._build_trainer_opening_summary(scope)
        return self._build_client_opening_summary(scope)

    def _build_client_opening_summary(self, scope: ChatSessionScope) -> dict[str, Any]:
        assert scope.client_id is not None
        if scope.session_type == "atlas_client_chat":
            client = self._safe(lambda: self.repository.get_client_by_id(scope.client_id)) or {}
        else:
            client = self._safe(lambda: self.repository.get_client_for_trainer(
                trainer_id=scope.trainer_id or "",
                client_id=scope.client_id,
            )) or {}
        today_checkin = self._safe(lambda: self.repository.get_checkin_by_date(scope.client_id, scope.session_date))
        if not today_checkin:
            first_name = self._first_name(client.get("client_name")) or "there"
            text = (
                f"Hey {first_name}, I do not have today's MODE yet. "
                "Complete the daily check-in first so I can coach from your readiness instead of guessing."
            )
            return {
                "text": text,
                "title": "Today's Coach Brief",
                "summary": self._clip_summary(text),
                "suggested_actions": CLIENT_SUGGESTED_ACTIONS,
                "source": CLIENT_NO_CHECKIN_SOURCE,
                "metadata": {
                    "checkin_date": scope.session_date.isoformat(),
                    "has_checkin": False,
                },
            }

        if scope.session_type == "atlas_client_chat":
            assigned_mode = self._canonical_mode(today_checkin.get("assigned_mode"))
            score = today_checkin.get("total_score")
            score_text = f"{score}/25" if score is not None else "today's readiness"
            text = (
                f"Atlas is ready. Today's MODE is {assigned_mode or 'set'} at {score_text}. "
                "I can help you work from this check-in or request a trainer connection for approval."
            )
            return {
                "text": text,
                "title": "Atlas Coach",
                "summary": self._clip_summary(text),
                "suggested_actions": [
                    "Connect me to a trainer",
                    "Build me a training routine",
                    "Talk through today's focus",
                ],
                "source": "atlas_client_mode_brief_v1",
                "metadata": {
                    "checkin_id": str(today_checkin.get("id") or "") or None,
                    "checkin_date": str(today_checkin.get("date") or scope.session_date.isoformat()),
                    "assigned_mode": assigned_mode,
                    "checkin_score": score,
                    "has_checkin": True,
                    "atlas_client_chat": True,
                },
            }

        profile = self._safe(lambda: self.repository.get_profile(scope.client_id)) or {}
        assigned_mode = self._canonical_mode(today_checkin.get("assigned_mode"))
        metadata = {
            "checkin_id": str(today_checkin.get("id") or "") or None,
            "checkin_date": str(today_checkin.get("date") or scope.session_date.isoformat()),
            "assigned_mode": assigned_mode,
            "checkin_score": today_checkin.get("total_score"),
            "has_checkin": True,
            "has_user_why": bool(str(profile.get("user_why") or "").strip()),
            "checkin_response_attempted": bool(today_checkin.get("checkin_response_attempted")),
        }
        raw_checkin_response = today_checkin.get("checkin_response")
        checkin_response = self._coerce_opening_checkin_response(raw_checkin_response)
        if (
            not checkin_response
            and raw_checkin_response is None
            and not metadata["checkin_response_attempted"]
            and self.daily_checkin_service
            and scope.session_type == "client_chat"
        ):
            generated_response = self._backfill_client_checkin_response(scope=scope, checkin=today_checkin)
            if generated_response:
                today_checkin = {
                    **today_checkin,
                    "checkin_response": generated_response,
                    "checkin_response_attempted": True,
                }
                checkin_response = self._coerce_opening_checkin_response(generated_response)
            metadata["checkin_response_attempted"] = True

        if checkin_response:
            text = self._build_client_checkin_response_brief(checkin_response)
            return {
                "text": text,
                "title": "Today's Coach Brief",
                "summary": self._clip_summary(text),
                "suggested_actions": CLIENT_MODE_BRIEF_ACTIONS,
                "source": CLIENT_CHECKIN_RESPONSE_BRIEF_SOURCE,
                "metadata": {
                    **metadata,
                    "checkin_response": checkin_response,
                    "checkin_response_generated_at": checkin_response.get("generated_at"),
                    "model_used": checkin_response.get("model_used"),
                },
            }

        text = self._build_client_mode_brief(today_checkin, profile=profile)
        return {
            "text": text,
            "title": "Today's Coach Brief",
            "summary": self._clip_summary(text),
            "suggested_actions": CLIENT_MODE_BRIEF_ACTIONS,
            "source": CLIENT_MODE_BRIEF_SOURCE,
            "metadata": metadata,
        }

    def _backfill_client_checkin_response(
        self,
        *,
        scope: ChatSessionScope,
        checkin: dict[str, Any],
    ) -> dict[str, Any] | None:
        if scope.session_type != "client_chat" or not scope.client_id or not self.daily_checkin_service:
            return None
        try:
            response = self.daily_checkin_service.ensure_checkin_response(
                client_id=scope.client_id,
                record=checkin,
                trainer_id=scope.trainer_id,
                trainer_display_name=scope.trainer_context.trainer_display_name,
                trace_id=f"chat-opening-{checkin.get('id') or scope.session_date.isoformat()}",
            )
        except Exception as exc:
            logger.warning(
                "Check-in response backfill failed for opening summary client_id=%s checkin_id=%s: %s",
                scope.client_id,
                checkin.get("id"),
                exc,
            )
            return None
        return response if isinstance(response, dict) else None

    def _build_client_mode_brief(self, checkin: dict[str, Any], profile: dict[str, Any] | None = None) -> str:
        mode = self._canonical_mode(checkin.get("assigned_mode")) or ""
        bundle = CLIENT_MODE_BRIEF_BUNDLES.get(mode) or CLIENT_MODE_BRIEF_BUNDLES["RECOVER"]
        score = checkin.get("total_score")
        score_line = f"{score}/25. {bundle['tagline']}" if score is not None else bundle["tagline"]
        duration, intensity, training_type = bundle["training"]
        user_why = profile.get("user_why") if isinstance(profile, dict) else None
        mindset = build_mindset_why_cue(bundle["mindset"], user_why, why_word_limit=18)
        compact_mindset = build_mindset_why_cue(bundle["mindset"], user_why, why_word_limit=12)
        candidates = [
            {
                "score_line": score_line,
                "nutrition": bundle["nutrition"],
                "mindset": mindset,
            },
            {
                "score_line": score_line,
                "nutrition": bundle["nutrition"],
                "mindset": compact_mindset,
            },
            {
                "score_line": score_line,
                "nutrition": self._shorten_words(bundle["nutrition"], 7),
                "mindset": compact_mindset,
            },
        ]

        for candidate in candidates:
            text = (
                f"{mode or 'Set'} MODE\n"
                f"{candidate['score_line']}\n"
                f"Training: {duration}, {intensity}, {training_type}.\n"
                f"Nutrition: {candidate['nutrition']}\n"
                f"Mindset: {candidate['mindset']}\n\n"
                "What do you want to achieve today?"
            )
            if self._word_count(text) <= CLIENT_MODE_BRIEF_WORD_LIMIT:
                return text

        return (
            f"{mode or 'Set'} MODE\n"
            f"{score_line}\n"
            f"Training: {duration}, {intensity}, {training_type}.\n"
            "Nutrition: fuel simply.\n"
            f"Mindset: {compact_mindset}\n\n"
            "What do you want to achieve today?"
        )

    def _coerce_opening_checkin_response(self, value: Any) -> dict[str, Any] | None:
        if not isinstance(value, dict):
            return None
        try:
            response = CheckinResponseOutput(**value)
        except Exception as exc:
            logger.warning("Ignoring malformed check-in response for opening summary: %s", exc)
            return None

        sections_by_id: dict[str, dict[str, str | None]] = {}
        for section in response.sections:
            section_id = str(section.id or "").strip()
            content = str(section.content or "").strip()
            if section_id not in CLIENT_CHECKIN_RESPONSE_SECTION_IDS or not content:
                continue
            sections_by_id[section_id] = {
                "id": section_id,
                "label": section.label,
                "content": content,
            }
        if any(section_id not in sections_by_id for section_id in CLIENT_CHECKIN_RESPONSE_SECTION_IDS):
            return None

        return {
            "mode": self._canonical_mode(response.mode) or response.mode,
            "total_score": response.total_score,
            "sections": [sections_by_id[section_id] for section_id in CLIENT_CHECKIN_RESPONSE_SECTION_IDS],
            "generated_at": response.generated_at.isoformat(),
            "model_used": response.model_used,
        }

    def _build_client_checkin_response_brief(self, checkin_response: dict[str, Any]) -> str:
        sections = {
            str(section.get("id") or ""): section
            for section in checkin_response.get("sections", [])
            if isinstance(section, dict)
        }
        mode = self._canonical_mode(checkin_response.get("mode")) or ""
        title = f"{mode} MODE" if mode else "Today's Coach Brief"
        lines = [
            title,
            str(sections["opening"].get("content") or "").strip(),
        ]
        for section_id in ("workout", "nutrition", "why"):
            section = sections[section_id]
            label = str(section.get("label") or "").strip()
            content = str(section.get("content") or "").strip()
            lines.append(f"{label}: {content}" if label else content)
        lines.extend(["", str(sections["question"].get("content") or "").strip()])
        return "\n".join(line for line in lines if line is not None).strip()

    def _canonical_mode(self, value: Any) -> str | None:
        mode = str(value or "").strip().upper()
        if not mode:
            return None
        return LEGACY_TO_CANONICAL_MODE.get(mode, mode)

    def _shorten_words(self, value: str, limit: int) -> str:
        words = str(value or "").split()
        if len(words) <= limit:
            return str(value or "")
        return " ".join(words[:limit]).rstrip(".,;:") + "."

    def _word_count(self, value: str) -> int:
        return len([word for word in str(value or "").split() if word.strip()])

    def _with_client_name(self, scope: ChatSessionScope, session: dict[str, Any]) -> dict[str, Any]:
        if scope.role != "client" or not scope.client_id or session.get("client_name"):
            return session
        if scope.session_type == "atlas_client_chat":
            client = self._safe(lambda: self.repository.get_client_by_id(scope.client_id or "")) or {}
        else:
            client = self._safe(lambda: self.repository.get_client_for_trainer(
                trainer_id=scope.trainer_id or "",
                client_id=scope.client_id or "",
            )) or {}
        client_name = str(client.get("client_name") or "").strip()
        if not client_name:
            return session
        return {
            **session,
            "client_name": client_name,
        }

    def _is_atlas_client_session(self, session: dict[str, Any]) -> bool:
        return str(session.get("session_type") or "").strip().lower() == "atlas_client_chat"

    def _build_atlas_response(
        self,
        *,
        user_id: str,
        session: dict[str, Any],
        request: ChatSessionSendRequest,
    ) -> tuple[str, dict[str, Any]]:
        client_id = str(session.get("client_id") or "").strip()
        if not client_id:
            return (
                "I could not find your client profile for this Atlas chat. Try signing out and back in.",
                {"atlas_client_chat": True, "atlas_assignment_status": "client_missing"},
            )
        client = self.repository.get_client_by_id(client_id)
        if not client:
            return (
                "I could not find your client profile for this Atlas chat. Try signing out and back in.",
                {"atlas_client_chat": True, "atlas_assignment_status": "client_missing"},
            )
        if client.get("assigned_trainer_id"):
            return (
                "You are already connected to a trainer. I will route you back through your assigned Coach chat.",
                {"atlas_client_chat": True, "atlas_assignment_status": "already_assigned"},
            )

        requested_name = self._extract_trainer_connection_query(request.message)
        if not requested_name:
            return (
                "I can help with today's plan from your MODE check-in. If you want a trainer, say something like "
                "\"connect me to Coach Maya\" and I will create an approval request for that trainer.",
                {"atlas_client_chat": True, "atlas_assignment_status": "no_assignment_intent"},
            )

        tenant_id = str(client.get("tenant_id") or "").strip()
        matches = self._match_trainers_for_request(tenant_id=tenant_id, requested_name=requested_name)
        if not matches:
            return (
                f"I could not find an active trainer matching \"{requested_name}\" in your workspace. "
                "Try their exact display name or ask them for an invite code.",
                {
                    "atlas_client_chat": True,
                    "atlas_assignment_status": "trainer_not_found",
                    "requested_trainer": requested_name,
                },
            )
        if len(matches) > 1:
            names = ", ".join(str(item.get("display_name") or "Unnamed trainer") for item in matches[:3])
            return (
                f"I found more than one trainer matching \"{requested_name}\": {names}. "
                "Send the exact trainer name you want and I will create the approval request.",
                {
                    "atlas_client_chat": True,
                    "atlas_assignment_status": "trainer_ambiguous",
                    "requested_trainer": requested_name,
                    "matched_trainer_ids": [str(item.get("id")) for item in matches if item.get("id")],
                },
            )

        trainer = matches[0]
        trainer_id = str(trainer.get("id") or "")
        existing = self.repository.find_pending_connection_request(
            client_id=client_id,
            trainer_id=trainer_id,
        )
        if existing:
            request_row = existing
            status = "pending_existing"
        else:
            request_row = self.repository.create_connection_request({
                "client_id": client_id,
                "trainer_id": trainer_id,
                "requested_by_user_id": user_id,
                "request_text": request.message,
                "status": "pending",
                "metadata": {
                    "source": "atlas_client_chat",
                    "chat_session_id": str(session.get("id") or ""),
                    "requested_trainer": requested_name,
                },
            })
            status = "pending_created"
        trainer_name = str(trainer.get("display_name") or "that trainer").strip() or "that trainer"
        return (
            f"I sent {trainer_name} a connection request for approval. "
            "Once they approve it, your Coach tab will switch from Atlas to their trainer-backed chat.",
            {
                "atlas_client_chat": True,
                "atlas_assignment_status": status,
                "connection_request_id": str(request_row.get("id") or ""),
                "trainer_id": trainer_id,
                "trainer_display_name": trainer_name,
            },
        )

    def _extract_trainer_connection_query(self, message: str) -> str | None:
        text = " ".join(str(message or "").strip().split())
        if not text:
            return None
        lower = text.lower()
        if not re.search(r"\b(assign|connect|attach)\b", lower):
            return None
        match = re.search(
            r"\b(?:assign|connect|attach)\b(?:\s+me)?(?:\s+(?:with|to))?\s+(.+)$",
            text,
            flags=re.IGNORECASE,
        )
        if not match:
            return None
        candidate = match.group(1).strip().strip(".!?")
        candidate = re.sub(r"^(?:coach|trainer)\s+", "", candidate, flags=re.IGNORECASE).strip()
        return candidate[:120] or None

    def _trainer_match_keys(self, trainer: dict[str, Any]) -> set[str]:
        display_name = str(trainer.get("display_name") or "")
        email = str(trainer.get("email") or "")
        local_part = email.partition("@")[0]
        values = {
            display_name,
            local_part,
            display_name.replace(".", " "),
            display_name.replace("_", " "),
            local_part.replace(".", " "),
            local_part.replace("_", " "),
        }
        return {self._normalize_match_text(value) for value in values if self._normalize_match_text(value)}

    def _match_trainers_for_request(self, *, tenant_id: str, requested_name: str) -> list[dict[str, Any]]:
        if not tenant_id:
            return []
        requested_key = self._normalize_match_text(requested_name)
        if not requested_key:
            return []
        trainers = self.repository.list_active_trainers_for_tenant(tenant_id)
        matches = []
        for trainer in trainers:
            keys = self._trainer_match_keys(trainer)
            if requested_key in keys:
                matches.append(trainer)
        return matches

    def _normalize_match_text(self, value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())

    def _build_trainer_action_response(
        self,
        *,
        trainer_context: TrainerContext,
        session: dict[str, Any],
        request: ChatSessionSendRequest,
        current_date: date,
    ) -> tuple[str, dict[str, Any]] | None:
        if str(session.get("role") or "") != "trainer":
            return None
        if str(session.get("session_type") or "") != "coach_ai":
            return None
        if not self._is_trainer_flag_review_intent(request.message):
            return None

        base_metadata = {
            "response_source": TRAINER_FLAG_REVIEW_SOURCE,
            "action_type": TRAINER_FLAG_REVIEW_ACTION,
            "command_center_date": current_date.isoformat(),
        }
        if not self.trainer_home_service:
            return (
                "I could not load Command Center data for client flags right now. "
                "Try the Clients tab, then retry this review once the backend has the trainer home service available.",
                {
                    **base_metadata,
                    "fallback_reason": "trainer_home_service_unavailable",
                    "included_client_count": 0,
                    "client_ids": [],
                },
            )

        command_center = self._safe(lambda: self.trainer_home_service.build_command_center(
            trainer_context,
            current_date,
        ))
        if command_center is None:
            return (
                "I could not load Command Center data for client flags right now. "
                "I can review flags once the priority board and daily score summaries are available.",
                {
                    **base_metadata,
                    "fallback_reason": "command_center_unavailable",
                    "included_client_count": 0,
                    "client_ids": [],
                },
            )

        return self._build_trainer_flag_review(command_center, current_date, base_metadata)

    def _is_trainer_flag_review_intent(self, message: str) -> bool:
        normalized = " ".join(str(message or "").strip().lower().split())
        if not normalized:
            return False
        patterns = [
            r"\breview\b.*\bflagged\b.*\bclients?\b",
            r"\bclient\b.*\bflags?\b",
            r"\bflags?\b.*\bclients?\b",
            r"\bshow\b.*\bpriorit(?:y|ies)\b",
            r"\bhighest\b.*\bpriorit(?:y|ies)\b",
            r"\bhigh(?:est)?[-\s]?priority\b.*\bclients?\b",
            r"\breview\b.*\bmissed\b.*\bclients?\b",
            r"\bmissed\b.*\bcheck[-\s]?ins?\b",
            r"\bnot doing (?:so )?well\b",
            r"\bdoing poorly\b",
            r"\bstruggling\b",
            r"\blow\b.*\b(?:scores?|readiness|recovery)\b",
            r"\bweak\b.*\b(?:scores?|readiness|recovery)\b",
            r"\bdaily\b.*\b(?:scores?|readiness)\b",
        ]
        return any(re.search(pattern, normalized) for pattern in patterns)

    def _build_trainer_flag_review(
        self,
        command_center: Any,
        current_date: date,
        base_metadata: dict[str, Any],
    ) -> tuple[str, dict[str, Any]]:
        clients = list(self._item_get(command_center, "clients", []) or [])
        totals = self._item_get(command_center, "totals", None)
        assigned_count = int(self._item_get(totals, "assigned_clients", len(clients)) or 0)
        flagged_clients = self._flagged_command_center_clients(clients)
        review_clients = flagged_clients[:TRAINER_FLAG_REVIEW_CLIENT_LIMIT]
        client_ids = [
            str(self._item_get(client, "client_id", "") or "")
            for client in review_clients
            if self._item_get(client, "client_id", None)
        ]
        metadata = {
            **base_metadata,
            "assigned_clients": assigned_count,
            "total_flagged_client_count": len(flagged_clients),
            "included_client_count": len(review_clients),
            "client_ids": client_ids,
        }

        if not review_clients:
            text = (
                f"Your client flag board is clear for {current_date.isoformat()}. "
                f"I found {assigned_count} assigned client{'s' if assigned_count != 1 else ''}, "
                "but none are currently high priority or carrying Command Center risk flags. "
                "Best move: keep programming steady and use the Clients tab if you want to scan the full roster."
            )
            return text, metadata

        lines = []
        cards = []
        summarizer_sources: set[str] = set()
        for client in review_clients:
            client_card, summarizer_source = self._build_flag_review_client_card(client)
            cards.append(client_card)
            lines.append(self._render_flag_review_card(client_card))
            summarizer_sources.add(summarizer_source)
        if len(flagged_clients) > len(review_clients):
            remaining = len(flagged_clients) - len(review_clients)
            lines.append(
                f"{remaining} more flagged client{'s' if remaining != 1 else ''} "
                f"remain after these top {len(review_clients)}."
            )
        metadata["summarizer"] = (
            "llm_with_deterministic_fallback"
            if "llm" in summarizer_sources
            else "deterministic_structured"
        )
        metadata["flagged_client_review_v3"] = {
            "version": 3,
            "cards": cards,
        }
        return "\n\n".join(lines), metadata

    def _flagged_command_center_clients(self, clients: list[Any]) -> list[Any]:
        indexed_clients = list(enumerate(clients))
        flagged = [
            (index, client)
            for index, client in indexed_clients
            if self._client_has_command_center_flag(client)
        ]
        return [
            client
            for _, client in sorted(
                flagged,
                key=lambda item: self._command_center_client_sort_key(item[1], item[0]),
            )
        ]

    def _client_has_command_center_flag(self, client: Any) -> bool:
        priority_tier = str(self._item_get(client, "priority_tier", "low") or "low").lower()
        risk_flags = list(self._item_get(client, "risk_flags", []) or [])
        missed_dates = list(self._item_get(client, "missed_checkin_dates_7d", []) or [])
        low_dates = list(self._item_get(client, "recent_low_readiness_dates", []) or [])
        week_summary = self._item_get(client, "week_summary", None)
        avg_score = self._float_or_none(self._item_get(week_summary, "avg_score_7d", None))
        return (
            priority_tier in {"high", "critical"}
            or bool(risk_flags)
            or bool(missed_dates)
            or bool(low_dates)
            or (avg_score is not None and avg_score < 18)
        )

    def _command_center_client_sort_key(self, client: Any, index: int) -> tuple[Any, ...]:
        priority_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        tier = str(self._item_get(client, "priority_tier", "low") or "low").lower()
        priority_score = self._float_or_none(self._item_get(client, "priority_score", None))
        risk_count = len(list(self._item_get(client, "risk_flags", []) or []))
        return (
            priority_rank.get(tier, 4),
            -(priority_score or 0),
            -risk_count,
            index,
        )

    def _build_flag_review_client_card(self, client: Any) -> tuple[dict[str, Any], str]:
        raw_metrics = self._collect_flag_review_raw_metrics(client)
        interpretation = self._interpret_flag_review_behavior(raw_metrics)
        fallback_card = self._build_flag_review_executive_summary(raw_metrics, interpretation)
        llm_card = self._try_llm_flag_review_summary(raw_metrics, interpretation, fallback_card)
        if llm_card:
            rendered = self._render_flag_review_card(llm_card)
            if self._flag_review_brief_is_valid(rendered, llm_card):
                return llm_card, "llm"

        return fallback_card, "deterministic"

    def _collect_flag_review_raw_metrics(self, client: Any) -> dict[str, Any]:
        week_summary = self._item_get(client, "week_summary", None)
        risk_flags = list(self._item_get(client, "risk_flags", []) or [])
        question_summaries = list(self._item_get(week_summary, "question_summaries", []) or [])
        weak_summaries = self._weak_question_summaries(question_summaries)
        missed_dates = list(
            self._item_get(client, "missed_checkin_dates_7d", None)
            or self._item_get(week_summary, "missed_checkin_dates_7d", [])
            or []
        )
        low_readiness_dates = list(
            self._item_get(client, "recent_low_readiness_dates", None)
            or self._item_get(week_summary, "recent_low_readiness_dates", [])
            or []
        )
        flag_codes = {
            str(self._item_get(flag, "code", "") or "").lower()
            for flag in risk_flags
        }
        flag_labels = [
            str(self._item_get(flag, "label", "") or self._item_get(flag, "code", "") or "").strip()
            for flag in risk_flags
        ]
        weak_keys = {
            str(self._item_get(summary, "key", "") or "").lower()
            for summary in weak_summaries
        }
        workouts_completed = int(self._item_get(week_summary, "workouts_completed_7d", 0) or 0)
        checkins_completed = int(self._item_get(week_summary, "checkins_completed_7d", 0) or 0)
        avg_score = self._float_or_none(self._item_get(week_summary, "avg_score_7d", None))
        return {
            "client_id": str(self._item_get(client, "client_id", "") or ""),
            "client_name": str(self._item_get(client, "client_name", "Client") or "Client"),
            "priority": self._flag_review_priority_label(client, risk_flags, week_summary),
            "priority_tier": str(self._item_get(client, "priority_tier", "low") or "low").lower(),
            "flag_codes": flag_codes,
            "flag_labels": [label for label in flag_labels if label],
            "avg_score_7d": avg_score,
            "checkins_completed_7d": checkins_completed,
            "workouts_completed_7d": workouts_completed,
            "missed_checkin_count": len(missed_dates),
            "recent_low_readiness_count": len(low_readiness_dates),
            "soreness_area": self._flag_review_soreness_area(client, risk_flags),
            "weak_summaries": weak_summaries,
            "weak_keys": weak_keys,
            "low_workouts": "low_workout_completion" in flag_codes or workouts_completed <= 1,
            "consistent_checkins": checkins_completed >= 5 and len(missed_dates) == 0,
            "low_motivation": "motivation" in weak_keys or any("motivation" in code for code in flag_codes),
            "low_nutrition": "nutrition" in weak_keys or any("nutrition" in code for code in flag_codes),
            "high_soreness": "soreness" in weak_keys or any("soreness" in code for code in flag_codes),
            "low_sleep": "sleep" in weak_keys,
            "high_stress": "stress" in weak_keys,
            "low_readiness": (
                "low_7d_readiness" in flag_codes
                or len(low_readiness_dates) > 0
                or (avg_score is not None and avg_score < 18)
            ),
        }

    def _flag_review_priority_label(self, client: Any, risk_flags: list[Any], week_summary: Any) -> str:
        tier = str(self._item_get(client, "priority_tier", "low") or "low").lower()
        if tier in {"critical", "high"}:
            return "High"
        if tier == "medium":
            return "Medium"

        avg_score = self._float_or_none(self._item_get(week_summary, "avg_score_7d", None))
        has_high_severity_flag = any(
            str(self._item_get(flag, "severity", "") or "").lower() in {"critical", "high"}
            for flag in risk_flags
        )
        if has_high_severity_flag or (avg_score is not None and avg_score < 18):
            return "Medium"
        return "Low"

    def _interpret_flag_review_behavior(self, raw_metrics: dict[str, Any]) -> dict[str, Any]:
        issue_type = self._flag_review_issue_type(raw_metrics)
        profile = self._flag_review_issue_profile(issue_type)
        action_signal = self._flag_review_action_signal(issue_type, raw_metrics["priority"])
        metrics_breakdown = self._flag_review_metrics_breakdown(raw_metrics, issue_type)
        metrics_summary = self._flag_review_metrics_summary(metrics_breakdown)
        discussion_prompt = profile.get("discussion_prompt") or profile["client_message"]
        return {
            "primary_issue_type": issue_type,
            "priority": raw_metrics["priority"],
            "action_signal": action_signal,
            "main_issue": profile["main_issue"],
            "why_it_matters": profile["why_it_matters"],
            "next_action": profile["next_action"],
            "discussion_prompt": discussion_prompt,
            "client_message": discussion_prompt,
            "metrics_breakdown": metrics_breakdown,
            "metrics_summary": metrics_summary[:3],
        }

    def _build_flag_review_executive_summary(
        self,
        raw_metrics: dict[str, Any],
        interpretation: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "client_id": raw_metrics["client_id"],
            "client_name": raw_metrics["client_name"],
            "priority": interpretation["priority"],
            "primary_issue_type": interpretation["primary_issue_type"],
            "action_signal": interpretation["action_signal"],
            "main_issue": interpretation["main_issue"],
            "why_it_matters": interpretation["why_it_matters"],
            "next_action": interpretation["next_action"],
            "discussion_prompt": interpretation["discussion_prompt"],
            "client_message": interpretation["client_message"],
            "metrics_breakdown": interpretation["metrics_breakdown"],
            "metrics_summary": interpretation["metrics_summary"],
        }

    def _flag_review_issue_type(self, metrics: dict[str, Any]) -> str:
        flag_codes: set[str] = metrics["flag_codes"]
        weak_keys: set[str] = metrics["weak_keys"]
        missed_count = metrics["missed_checkin_count"]

        if metrics["low_workouts"] and metrics["low_motivation"]:
            return "adherence_collapse"
        if metrics["low_readiness"] and (metrics["high_soreness"] or metrics["low_sleep"] or metrics["high_stress"]):
            return "recovery_overload"
        if metrics["low_nutrition"] and metrics["workouts_completed_7d"] >= 2:
            return "fueling_issue"
        if missed_count > 0 and metrics["low_motivation"]:
            return "disengagement_risk"
        if metrics["consistent_checkins"] and metrics["low_workouts"]:
            return "accountability_gap"
        if metrics["low_readiness"]:
            return "readiness_recovery"
        if metrics["low_nutrition"]:
            return "fueling_issue"
        if metrics["low_motivation"]:
            return "disengagement_risk"
        if metrics["high_soreness"]:
            return "recovery_overload"
        if "sleep" in weak_keys or "stress" in weak_keys:
            return "recovery_overload"
        if (
            flag_codes.intersection({"missing_today_checkin", "recent_no_show", "recent_cancelled_session"})
            or missed_count > 0
        ):
            return "checkin_adherence"
        return "general"

    def _flag_review_issue_profile(self, issue_type: str) -> dict[str, str]:
        profiles = {
            "adherence_collapse": {
                "main_issue": "Adherence is breaking down, not just training volume.",
                "why_it_matters": "Low motivation plus missed training usually becomes disengagement if the next step feels too big.",
                "next_action": "Remove friction and assign one easy training win today.",
                "client_message": "What is blocking workouts right now? Let's make today's win small and doable.",
            },
            "recovery_overload": {
                "main_issue": "Recovery is overloaded and training quality is at risk.",
                "why_it_matters": "Pushing harder now may deepen fatigue instead of building momentum.",
                "next_action": "Scale intensity and shift today's plan toward recovery.",
                "client_message": "Recovery looks taxed today, so let's adjust and keep the session productive.",
            },
            "fueling_issue": {
                "main_issue": "Fueling consistency is likely limiting recovery and follow-through.",
                "why_it_matters": "Training can stay active, but poor nutrition will keep energy and readiness unstable.",
                "next_action": "Choose one simple nutrition anchor for the next meal.",
                "client_message": "Let's keep nutrition simple today: protein at your next meal and steady water.",
            },
            "disengagement_risk": {
                "main_issue": "Disengagement risk is rising.",
                "why_it_matters": "Missed check-ins and low drive mean the plan may be losing relevance.",
                "next_action": "Ask what feels blocked and reconnect one task to their goal.",
                "client_message": "What feels hardest about showing up today? Let's reset around one small step.",
            },
            "accountability_gap": {
                "main_issue": "Accountability is present, but action is not following.",
                "why_it_matters": "They are checking in, so the leverage point is a smaller commitment, not more data.",
                "next_action": "Set a tiny training target they can complete today.",
                "client_message": "You are staying connected. Let's turn that into one easy training win today.",
            },
            "readiness_recovery": {
                "main_issue": "Readiness is low enough to adjust the plan.",
                "why_it_matters": "Forcing intensity today could turn a low-readiness patch into a setback.",
                "next_action": "Swap to controlled intensity or recovery work today.",
                "client_message": "Readiness looks low, so let's adjust today and keep momentum protected.",
            },
            "checkin_adherence": {
                "main_issue": "The biggest risk is limited signal.",
                "why_it_matters": "Without a recent check-in, programming may miss what they need today.",
                "next_action": "Get a quick readiness check-in before changing the plan.",
                "client_message": "Can you send a quick check-in so I can tune today's plan correctly?",
            },
            "general": {
                "main_issue": "Risk is rising enough to need a quick coaching touch.",
                "why_it_matters": "A small intervention now can prevent drift from becoming a pattern.",
                "next_action": "Confirm the top blocker and adjust only the next step.",
                "client_message": "Quick check: what would make today's plan easier to complete?",
            },
        }
        return profiles.get(issue_type, profiles["general"])

    def _flag_review_action_signal(self, issue_type: str, priority: str) -> dict[str, str]:
        labels = {
            "adherence_collapse": "Reduce Friction",
            "recovery_overload": "Scale Load",
            "fueling_issue": "Fuel First",
            "disengagement_risk": "Re-engage",
            "accountability_gap": "Set Tiny Target",
            "readiness_recovery": "Adjust Plan",
            "checkin_adherence": "Get Signal",
            "general": "Adjust Plan",
        }
        tone = str(priority or "Low").strip().lower()
        if tone not in {"low", "medium", "high"}:
            tone = "low"
        return {
            "label": labels.get(issue_type, labels["general"]),
            "tone": tone,
        }

    def _flag_review_metrics_summary(self, metrics_breakdown: list[dict[str, str]]) -> list[str]:
        signals: list[str] = []
        for item in metrics_breakdown:
            signal = str(item.get("signal", "") or "").strip().rstrip(".")
            signal = signal[:1].lower() + signal[1:] if signal else signal
            if signal and signal not in signals:
                signals.append(signal)
        return signals[:3]

    def _flag_review_metrics_breakdown(
        self,
        metrics: dict[str, Any],
        issue_type: str,
    ) -> list[dict[str, str]]:
        breakdown: list[dict[str, str]] = []
        domains: set[str] = set()

        def add(domain: str, signal: str, coaching_meaning: str, detail: str) -> None:
            if not domain or domain in domains:
                return
            domains.add(domain)
            breakdown.append({
                "domain": domain,
                "signal": signal,
                "coaching_meaning": coaching_meaning,
                "detail": detail,
            })

        if metrics["low_workouts"]:
            add(
                "Workouts",
                "Training follow-through is low.",
                "The plan likely needs less friction before more volume.",
                "Set one small session target the client can complete today.",
            )
        if metrics["low_nutrition"]:
            add(
                "Nutrition",
                "Nutrition consistency is slipping.",
                "Fueling may be limiting recovery, energy, and follow-through.",
                "Anchor the next meal with protein and water.",
            )
        if metrics["low_motivation"]:
            add(
                "Motivation",
                "Motivation is low.",
                "The current plan may feel too hard, irrelevant, or blocked.",
                "Ask for the blocker before changing the program.",
            )
        if metrics["high_soreness"]:
            soreness_area = str(metrics.get("soreness_area") or "").strip()
            add(
                "Soreness",
                "Soreness may limit quality work.",
                "Loading may need to drop so movement stays productive.",
                f"Reported sore area: {soreness_area}." if soreness_area else "No specific sore area was captured.",
            )
        if (
            issue_type in {"recovery_overload", "readiness_recovery"}
            or metrics["low_readiness"]
            or metrics["low_sleep"]
            or metrics["high_stress"]
        ):
            add(
                "Recovery",
                "Recovery pressure is elevated.",
                "Readiness, sleep, stress, or soreness may be limiting training quality.",
                "Scale intensity before adding hard work.",
            )
        if metrics["missed_checkin_count"] > 0 or issue_type == "checkin_adherence":
            add(
                "Check-ins",
                "Check-in signal is incomplete.",
                "There is not enough current context to adjust confidently.",
                "Get a quick readiness update before the session.",
            )
        if not breakdown:
            add(
                "Priority",
                "Risk is elevated.",
                "A quick trainer touch can keep drift from becoming a pattern.",
                "Confirm the top blocker and adjust the next step.",
            )
        return breakdown

    def _flag_review_soreness_area(self, client: Any, risk_flags: list[Any]) -> str | None:
        direct_fields = (
            "soreness_area",
            "soreness_location",
            "sore_area",
            "sore_location",
            "pain_area",
            "pain_location",
            "body_area",
            "body_part",
            "injury_notes",
        )
        sources: list[Any] = [client, self._item_get(client, "metadata", {})]
        for source in sources:
            for field in direct_fields:
                extracted = self._extract_flag_review_body_area(self._item_get(source, field, None))
                if extracted:
                    return extracted

        candidates: list[str] = []
        for flag in risk_flags:
            flag_text = " ".join(
                str(self._item_get(flag, field, "") or "")
                for field in ("code", "label", "detail")
            )
            if re.search(r"\b(sore|soreness|pain|ache|injur|hurt)\b", flag_text, flags=re.IGNORECASE):
                candidates.append(flag_text)

        talking_points = self._item_get(client, "talking_points", None)
        points = self._item_get(talking_points, "points", None)
        if points is None and isinstance(talking_points, list):
            points = talking_points
        for point in list(points or [])[:6]:
            point_text = str(point or "")
            if re.search(r"\b(sore|soreness|pain|ache|injur|hurt)\b", point_text, flags=re.IGNORECASE):
                candidates.append(point_text)

        return self._extract_flag_review_body_area(" ".join(candidates))

    def _extract_flag_review_body_area(self, value: Any) -> str | None:
        text = str(value or "").strip().lower()
        if not text or text in {"none", "n/a", "na", "unknown"}:
            return None
        body_parts = (
            "lower back",
            "upper back",
            "low back",
            "back",
            "neck",
            "shoulder",
            "elbow",
            "wrist",
            "hip",
            "glute",
            "hamstring",
            "quad",
            "knee",
            "calf",
            "achilles",
            "ankle",
            "foot",
            "feet",
            "chest",
        )
        for part in body_parts:
            pattern = rf"\b(?:(left|right)\s+)?{re.escape(part)}\b"
            match = re.search(pattern, text)
            if match:
                return " ".join(match.group(0).split())
        return None

    def _try_llm_flag_review_summary(
        self,
        raw_metrics: dict[str, Any],
        interpretation: dict[str, Any],
        fallback_card: dict[str, Any],
    ) -> dict[str, Any] | None:
        openai_client = getattr(self.conversation_service, "openai_client", None)
        if openai_client is None:
            return None

        try:
            completion = openai_client.create_chat_completion_with_usage(
                model=TRAINER_FLAG_REVIEW_LLM_MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You write executive mobile briefs for trainers reviewing flagged fitness clients. "
                            "Return JSON only with keys: priority, primary_issue_type, main_issue, why_it_matters, "
                            "next_action, discussion_prompt, client_message, metrics_summary. "
                            "Use the provided primary_issue_type. "
                            "Identify one issue only. Use plain English, no date lists, no averages, no score strings, "
                            "no raw dumps, no repeated client name, and keep the rendered brief under 75 words."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(
                            self._flag_review_llm_payload(raw_metrics, interpretation, fallback_card),
                            sort_keys=True,
                            default=str,
                        ),
                    },
                ],
            )
            payload = json.loads(completion.text)
        except Exception:
            return None

        card = self._normalize_flag_review_card(payload, fallback_card)
        if card is None:
            return None
        rendered = self._render_flag_review_card(card)
        if not self._flag_review_brief_is_valid(rendered, card):
            return None
        return card

    def _flag_review_llm_payload(
        self,
        metrics: dict[str, Any],
        interpretation: dict[str, Any],
        fallback_card: dict[str, Any],
    ) -> dict[str, Any]:
        weak_scores = []
        for summary in metrics["weak_summaries"][:4]:
            weak_scores.append({
                "key": str(self._item_get(summary, "key", "") or ""),
                "label": str(self._item_get(summary, "label", "") or ""),
                "status": str(self._item_get(summary, "status", "") or ""),
                "average_7d": self._float_or_none(self._item_get(summary, "average_7d", None)),
                "low_days_7d": int(self._item_get(summary, "low_days_7d", 0) or 0),
            })
        return {
            "client_name": metrics["client_name"],
            "priority": metrics["priority"],
            "primary_issue_type": interpretation["primary_issue_type"],
            "risk_flags": metrics["flag_labels"][:4],
            "metrics": {
                "checkins_completed_7d": metrics["checkins_completed_7d"],
                "workouts_completed_7d": metrics["workouts_completed_7d"],
                "missed_checkin_days_7d": metrics["missed_checkin_count"],
                "recent_low_readiness_days": metrics["recent_low_readiness_count"],
                "readiness_average_7d": metrics["avg_score_7d"],
                "weak_scores": weak_scores,
            },
            "deterministic_recommendation": fallback_card,
        }

    def _normalize_flag_review_card(self, payload: Any, fallback_card: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(payload, dict):
            return None

        metrics_value = payload.get("metrics_summary", [])
        if isinstance(metrics_value, str):
            metrics_summary = [part.strip(" .") for part in re.split(r";|\n", metrics_value) if part.strip(" .")]
        elif isinstance(metrics_value, list):
            metrics_summary = [str(item).strip(" .") for item in metrics_value if str(item).strip(" .")]
        else:
            metrics_summary = []

        card = {
            "client_id": fallback_card["client_id"],
            "client_name": fallback_card["client_name"],
            "priority": str(payload.get("priority") or fallback_card["priority"]).strip().capitalize(),
            "primary_issue_type": str(
                payload.get("primary_issue_type") or fallback_card["primary_issue_type"]
            ).strip(),
            "action_signal": fallback_card["action_signal"],
            "main_issue": str(payload.get("main_issue") or "").strip(),
            "why_it_matters": str(payload.get("why_it_matters") or "").strip(),
            "next_action": str(payload.get("next_action") or "").strip(),
            "discussion_prompt": str(
                payload.get("discussion_prompt")
                or payload.get("client_message")
                or payload.get("client_facing_message")
                or ""
            ).strip(),
            "metrics_breakdown": fallback_card["metrics_breakdown"],
            "metrics_summary": metrics_summary[:3] or fallback_card["metrics_summary"],
        }
        card["client_message"] = str(
            card["discussion_prompt"]
            or payload.get("client_message")
            or payload.get("client_facing_message")
            or fallback_card["client_message"]
        ).strip()
        if not card["discussion_prompt"]:
            card["discussion_prompt"] = card["client_message"]
        if not card["client_message"]:
            card["client_message"] = str(
                payload.get("client_message")
                or payload.get("client_facing_message")
                or fallback_card["client_message"]
            ).strip()
        if card["priority"] not in {"Low", "Medium", "High"}:
            card["priority"] = fallback_card["priority"]
        if card["primary_issue_type"] != fallback_card["primary_issue_type"]:
            card["primary_issue_type"] = fallback_card["primary_issue_type"]
        required_text = [
            card["main_issue"],
            card["why_it_matters"],
            card["next_action"],
            card["discussion_prompt"],
            card["client_message"],
            *card["metrics_summary"],
        ]
        if not card["metrics_summary"] or not card["metrics_breakdown"] or not all(required_text):
            return None
        return card

    def _render_flag_review_card(self, card: dict[str, Any]) -> str:
        return (
            f"{card['client_name']} \u2014 {card['priority']}\n\n"
            "Main issue:\n"
            f"{card['main_issue'].rstrip('.')}.\n\n"
            "Why it matters:\n"
            f"{card['why_it_matters'].rstrip('.')}.\n\n"
            "Next action:\n"
            f"{card['next_action'].rstrip('.')}.\n\n"
            "Message to client:\n"
            f"{card['client_message'].rstrip('.')}."
        )

    def _flag_review_brief_is_valid(
        self,
        text: str,
        card: dict[str, Any],
    ) -> bool:
        if self._word_count(text) > TRAINER_FLAG_REVIEW_CLIENT_WORD_LIMIT:
            return False
        body_text = " ".join(
            str(card.get(key, ""))
            for key in ("main_issue", "why_it_matters", "next_action", "discussion_prompt", "client_message")
        )
        body_text += " " + " ".join(str(item) for item in card.get("metrics_summary", []))
        for item in card.get("metrics_breakdown", []):
            if isinstance(item, dict):
                body_text += " " + " ".join(str(item.get(key, "")) for key in ("domain", "signal", "coaching_meaning", "detail"))
        noise_text = f"{text} {body_text}"
        if re.search(r"\b\d{4}-\d{2}-\d{2}\b", noise_text):
            return False
        if re.search(r"\bavg\b|/\d{1,2}\b|\baverage\b", noise_text, flags=re.IGNORECASE):
            return False
        normalized_name = str(card.get("client_name") or "").strip().lower()
        if normalized_name and normalized_name not in {"client", "user"} and normalized_name in body_text.lower():
            return False
        return all(
            label in text
            for label in (
                "Main issue:",
                "Why it matters:",
                "Next action:",
                "Message to client:",
            )
        )

    def _word_count(self, text: str) -> int:
        return len(re.findall(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?", text))

    def _weak_question_summaries(self, question_summaries: list[Any]) -> list[Any]:
        actionable = []
        for summary in question_summaries:
            average = self._float_or_none(self._item_get(summary, "average_7d", None))
            status = str(self._item_get(summary, "status", "") or "").lower()
            low_days = int(self._item_get(summary, "low_days_7d", 0) or 0)
            if average is None:
                continue
            if status in {"low", "watch"} or average <= 3.4 or low_days > 0:
                actionable.append(summary)
        status_rank = {"low": 0, "watch": 1, "steady": 2, "no_data": 3}
        return sorted(
            actionable,
            key=lambda summary: (
                status_rank.get(str(self._item_get(summary, "status", "") or "").lower(), 9),
                self._float_or_none(self._item_get(summary, "average_7d", None)) or 99,
                -int(self._item_get(summary, "low_days_7d", 0) or 0),
            ),
        )

    def _float_or_none(self, value: Any) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _item_get(self, item: Any, key: str, default: Any = None) -> Any:
        if isinstance(item, dict):
            return item.get(key, default)
        return getattr(item, key, default)

    def _build_trainer_opening_summary(self, scope: ChatSessionScope) -> dict[str, Any]:
        command_center = None
        if self.trainer_home_service:
            command_center = self._safe(lambda: self.trainer_home_service.build_command_center(
                scope.trainer_context,
                scope.session_date,
            ))
        clients = list(getattr(command_center, "clients", []) or [])
        totals = getattr(command_center, "totals", None)
        assigned_count = int(getattr(totals, "assigned_clients", len(clients)) or 0)
        today_missing_checkins = int(getattr(totals, "today_missing_checkins", 0) or 0)
        recent_missed_checkin_days = int(getattr(totals, "recent_missed_checkin_days", 0) or 0)
        clients_with_recent_missed_checkins = int(getattr(totals, "clients_with_recent_missed_checkins", 0) or 0)
        clients_with_low_7d_readiness = int(getattr(totals, "clients_with_low_7d_readiness", 0) or 0)
        clients_with_recent_low_readiness = int(getattr(totals, "clients_with_recent_low_readiness", 0) or 0)
        priority_clients = [
            client for client in clients
            if getattr(client, "priority_tier", "low") in {"high", "critical"}
        ]
        top_client_name = getattr(priority_clients[0], "client_name", None) if priority_clients else None
        analytics_metadata = self._trainer_opening_analytics_metadata(
            assigned_count=assigned_count,
            today_missing_checkins=today_missing_checkins,
            recent_missed_checkin_days=recent_missed_checkin_days,
            clients_with_recent_missed_checkins=clients_with_recent_missed_checkins,
            clients_with_low_7d_readiness=clients_with_low_7d_readiness,
            clients_with_recent_low_readiness=clients_with_recent_low_readiness,
            clients=clients,
        )

        if assigned_count <= 0:
            text = (
                "Your Coach AI board is clear today. Best move: use this window to tighten programming rules, "
                "review client notes, or prepare the next check-in rhythm. Want to start by setting priorities?"
            )
        else:
            client_label = "client" if assigned_count == 1 else "clients"
            recent_missed_client_label = "client" if clients_with_recent_missed_checkins == 1 else "clients"
            low_avg_client_label = "client" if clients_with_low_7d_readiness == 1 else "clients"
            low_avg_verb = "has" if clients_with_low_7d_readiness == 1 else "have"
            recent_low_client_label = "client" if clients_with_recent_low_readiness == 1 else "clients"
            recent_low_verb = "has" if clients_with_recent_low_readiness == 1 else "have"
            priority_line = (
                f" Start with {top_client_name} first."
                if top_client_name
                else " Start with the highest priority client first."
            )
            text = (
                f"You have {assigned_count} {client_label} on the board. Recent adherence: "
                f"{clients_with_recent_missed_checkins} {recent_missed_client_label} missed "
                f"{recent_missed_checkin_days} check-in days "
                f"across the previous 7 days; {today_missing_checkins} missing today. Recovery: "
                f"{clients_with_low_7d_readiness} {low_avg_client_label} {low_avg_verb} "
                f"low 7-day readiness averages and {clients_with_recent_low_readiness} "
                f"{recent_low_client_label} {recent_low_verb} recent low-readiness days. Best move: review flagged "
                f"clients before pushing new programming.{priority_line} Want to start with the highest priority?"
            )
        return {
            "text": text,
            "title": "Daily Operating Brief",
            "summary": self._clip_summary(text),
            "suggested_actions": TRAINER_SUGGESTED_ACTIONS,
            "source": "trainer_command_center_v2",
            "metadata": analytics_metadata,
        }

    def _trainer_opening_analytics_metadata(
        self,
        *,
        assigned_count: int,
        today_missing_checkins: int,
        recent_missed_checkin_days: int,
        clients_with_recent_missed_checkins: int,
        clients_with_low_7d_readiness: int,
        clients_with_recent_low_readiness: int,
        clients: list[Any],
    ) -> dict[str, Any]:
        counts = {
            "assigned_clients": assigned_count,
            "today_missing_checkins": today_missing_checkins,
            "recent_missed_checkin_days": recent_missed_checkin_days,
            "clients_with_recent_missed_checkins": clients_with_recent_missed_checkins,
            "clients_with_low_7d_readiness": clients_with_low_7d_readiness,
            "clients_with_recent_low_readiness": clients_with_recent_low_readiness,
        }
        client_rollups = []
        for client in clients:
            missed_dates = [
                self._json_date(value)
                for value in (getattr(client, "missed_checkin_dates_7d", []) or [])
            ]
            low_dates = [
                self._json_date(value)
                for value in (getattr(client, "recent_low_readiness_dates", []) or [])
            ]
            client_rollups.append({
                "client_id": str(getattr(client, "client_id", "") or ""),
                "priority_tier": str(getattr(client, "priority_tier", "") or ""),
                "missed_checkin_dates_7d": sorted(filter(None, missed_dates)),
                "recent_low_readiness_dates": sorted(filter(None, low_dates)),
            })
        payload = {
            "counts": counts,
            "clients": sorted(client_rollups, key=lambda item: item["client_id"]),
        }
        fingerprint = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:16]
        return {
            **counts,
            "analytics_fingerprint": fingerprint,
        }

    def _json_date(self, value: Any) -> str | None:
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        if value is None:
            return None
        return str(value)

    def _to_legacy_chat_request(self, request: ChatSessionSendRequest, session: dict[str, Any]) -> ChatRequest:
        context = {
            **(request.client_context or {}),
            "chat_session_id": str(session.get("id")),
            "chat_session_type": str(session.get("session_type") or ""),
            "chat_session_date": str(session.get("session_date") or ""),
        }
        return ChatRequest(
            conversation_id=None,
            request_id=request.request_id,
            message=request.message,
            client_context=context,
            client_message_id=request.client_message_id,
            idempotency_key=request.idempotency_key,
        )

    def _effective_current_date(self, request: ChatSessionSendRequest, session: dict[str, Any]) -> date:
        if request.session_date:
            return request.session_date
        backend_today = self._today()
        session_date = self._coerce_date(session.get("session_date"), backend_today)
        if (
            session_date == backend_today - timedelta(days=1)
            and self._is_recently_created(session, max_age=LEGACY_LOCAL_DAY_SEND_GRACE)
        ):
            return session_date
        return backend_today

    def _to_session_record(self, row: dict[str, Any], *, current_date: date) -> ChatSessionRecord:
        session_date = self._coerce_date(row.get("session_date"), current_date)
        return ChatSessionRecord(
            id=str(row.get("id")),
            user_id=str(row.get("user_id")),
            trainer_id=str(row.get("trainer_id")) if row.get("trainer_id") else None,
            client_id=str(row.get("client_id")) if row.get("client_id") else None,
            client_name=row.get("client_name"),
            role=str(row.get("role") or "client"),  # type: ignore[arg-type]
            session_type=str(row.get("session_type") or "client_chat"),  # type: ignore[arg-type]
            session_date=session_date,
            summary=row.get("summary"),
            title=row.get("title"),
            metadata=row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
            last_message_at=row.get("last_message_at"),
            read_only=self._is_read_only(row, current_date),
        )

    def _to_message(self, row: dict[str, Any]) -> ChatSessionMessage:
        return ChatSessionMessage(
            id=str(row.get("id")),
            session_id=str(row.get("session_id")),
            sender_type=str(row.get("sender_type") or "ai"),  # type: ignore[arg-type]
            content=str(row.get("content") or ""),
            created_at=row.get("created_at"),
            message_index=int(row.get("message_index") or 0),
            metadata=row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
        )

    def _suggested_actions_from_messages(self, messages: list[dict[str, Any]], role: str) -> list[str]:
        for message in messages:
            metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
            chips = metadata.get("suggested_action_chips")
            if isinstance(chips, list) and chips:
                return [str(chip) for chip in chips if str(chip).strip()]
        return TRAINER_SUGGESTED_ACTIONS if role == "trainer" else CLIENT_SUGGESTED_ACTIONS

    def _client_mode_greeting(self, *, client: dict[str, Any], checkin: dict[str, Any] | None) -> str:
        first_name = self._first_name(client.get("client_name")) or "there"
        greeting = f"Hey {first_name},"
        if not checkin:
            return (
                f"{greeting} I do not have today's MODE yet. "
                "A quick check-in will let me coach from your recovery, strain, and readiness instead of guessing."
            )

        mode = self._canonical_mode(checkin.get("assigned_mode")) or ""
        score = checkin.get("total_score")
        lowest = self._lowest_checkin_dimension(checkin.get("inputs"))
        score_text = f" Your readiness score is {score}/25" if score is not None else ""
        detail = f", with {lowest} as the lowest signal" if lowest and score_text else ""
        if mode:
            return f"{greeting} your current MODE is {mode}.{score_text}{detail}."
        if score is not None:
            return f"{greeting} I have today's readiness score ({score}/25), but today's MODE is not set yet."
        return f"{greeting} I do not have today's MODE yet. A quick check-in will set the context."

    def _readiness_phrase(self, checkin: dict[str, Any] | None) -> str:
        if not checkin:
            return "I do not have your readiness check-in yet today."
        score = checkin.get("total_score")
        mode = self._canonical_mode(checkin.get("assigned_mode")) or ""
        lowest = self._lowest_checkin_dimension(checkin.get("inputs"))
        detail = f", with {lowest} as the lowest signal" if lowest else ""
        if not mode:
            return f"Your readiness score is {score}/25{detail}, but today's MODE is not set yet."
        return f"Your readiness is {mode} today ({score}/25){detail}."

    def _first_name(self, value: Any) -> str | None:
        normalized = " ".join(str(value or "").strip().split())
        if not normalized:
            return None
        return normalized.split(" ", 1)[0]

    def _lowest_checkin_dimension(self, inputs: Any) -> str | None:
        if not isinstance(inputs, dict):
            return None
        candidates = {
            key: value for key, value in inputs.items()
            if key in {"sleep", "stress", "soreness", "nutrition", "motivation"}
            and isinstance(value, (int, float))
        }
        if not candidates:
            return None
        return min(candidates, key=candidates.get).replace("_", " ")

    def _client_missing_signal(self, *, today_checkin: dict[str, Any] | None, workout_count: int) -> str:
        if not today_checkin:
            return "a quick readiness check-in so I can coach from today's state"
        if workout_count <= 0:
            return "a movement signal, even if it is just a short walk or easy session"
        inputs = today_checkin.get("inputs") if isinstance(today_checkin.get("inputs"), dict) else {}
        if int(inputs.get("nutrition") or 5) <= 2:
            return "a simple food log or protein-forward meal"
        return "one visible consistency win before the day closes"

    def _memory_hint(self, memory: list[dict[str, Any]]) -> str:
        if not memory:
            return ""
        first = memory[0] or {}
        value = first.get("value_json")
        if isinstance(value, dict):
            text = str(value.get("text") or value.get("value") or "").strip()
        else:
            text = str(value or "").strip()
        if not text:
            return ""
        return f"I am also keeping this context in mind: {text[:140]}."

    def _default_title(self, scope: ChatSessionScope) -> str:
        if scope.session_type == "atlas_client_chat":
            return "Atlas Coach"
        return "Daily Operating Brief" if scope.role == "trainer" else "Today's Coach Brief"

    def _is_read_only(self, session: dict[str, Any], current_date: date) -> bool:
        metadata = session.get("metadata") if isinstance(session.get("metadata"), dict) else {}
        if metadata.get("archived_at"):
            return True
        return self._coerce_date(session.get("session_date"), current_date) != current_date

    def _clip_summary(self, text: str, limit: int = 180) -> str:
        normalized = " ".join(str(text or "").split())
        if len(normalized) <= limit:
            return normalized
        return f"{normalized[:limit].rstrip()}..."

    def _normalize_role(self, role: str) -> str:
        normalized = str(role or "").strip().lower()
        if normalized not in {"client", "trainer"}:
            raise ValueError("Invalid chat session role")
        return normalized

    def _validate_session_type_for_role(self, role: str, session_type: str) -> None:
        normalized = str(session_type or "").strip().lower()
        if role == "client" and normalized not in {"client_chat", "atlas_client_chat"}:
            raise ValueError("Invalid chat session type")
        if role == "trainer" and normalized not in {"trainer_chat", "coach_ai"}:
            raise ValueError("Invalid chat session type")

    def _coerce_date(self, value: Any, fallback: date) -> date:
        if isinstance(value, date):
            return value
        if isinstance(value, str) and value:
            try:
                return date.fromisoformat(value[:10])
            except ValueError:
                return fallback
        return fallback

    def _coerce_datetime(self, value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        if isinstance(value, str) and value:
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        return None

    def _is_recently_created(self, session: dict[str, Any], *, max_age: timedelta) -> bool:
        created_at = self._coerce_datetime(session.get("created_at"))
        if not created_at:
            return False
        age = self._now() - created_at
        return timedelta(0) <= age <= max_age

    def _today(self) -> date:
        return self._now().date()

    def _now(self) -> datetime:
        return datetime.now(timezone.utc)

    def _safe(self, fn):
        try:
            return fn()
        except Exception:
            return None
