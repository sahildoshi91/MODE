from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

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
from app.modules.motivation import build_mindset_why_cue
from app.modules.trainer_home.service import TrainerHomeService


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
LEGACY_LOCAL_DAY_SEND_GRACE = timedelta(hours=12)
CLIENT_MODE_BRIEF_SOURCE = "client_daily_mode_brief_v1"
CLIENT_NO_CHECKIN_SOURCE = "client_daily_no_checkin_v1"
CLIENT_MODE_BRIEF_WORD_LIMIT = 75
LEGACY_TO_CANONICAL_MODE = {
    "GREEN": "BEAST",
    "YELLOW": "BUILD",
    "BLUE": "RECOVER",
    "RED": "REST",
}

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
    trainer_id: str
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
    ):
        self.repository = repository
        self.conversation_service = conversation_service
        self.trainer_home_service = trainer_home_service

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
    ) -> ChatSessionDetailResponse:
        session = self.repository.get_session(session_id)
        if not session:
            raise ChatSessionNotFoundError("Chat session not found")
        self._authorize_session(user_id=user_id, trainer_context=trainer_context, session=session)
        resolved_current_date = current_date or self._today()
        messages = self.repository.list_messages(str(session["id"]), limit=500)
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
        if not trainer_context.trainer_id:
            raise ChatSessionAccessError("User is not assigned to an active trainer context")

        if role == "client":
            resolved_client_id = client_id or trainer_context.client_id
            if not resolved_client_id and allow_default_client:
                resolved_client_id = trainer_context.client_id
            if not resolved_client_id or resolved_client_id != trainer_context.client_id:
                raise ChatSessionAccessError("Client chat scope does not match this account")
            if trainer_context.client_user_id and trainer_context.client_user_id != user_id:
                raise ChatSessionAccessError("Client chat scope does not match this account")
            return ChatSessionScope(
                user_id=user_id,
                trainer_id=trainer_context.trainer_id,
                client_id=resolved_client_id,
                role=role,
                session_type=session_type,
                session_date=session_date,
                trainer_context=trainer_context,
            )

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
        if str(session.get("user_id")) != scope.user_id or str(session.get("trainer_id")) != scope.trainer_id:
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
        if metadata.get("checkin_id") != opening_metadata.get("checkin_id"):
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
        client = self._safe(lambda: self.repository.get_client_for_trainer(
            trainer_id=scope.trainer_id,
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

        assigned_mode = self._canonical_mode(today_checkin.get("assigned_mode"))
        profile = self._safe(lambda: self.repository.get_profile(scope.client_id)) or {}
        text = self._build_client_mode_brief(today_checkin, profile=profile)
        return {
            "text": text,
            "title": "Today's Coach Brief",
            "summary": self._clip_summary(text),
            "suggested_actions": CLIENT_MODE_BRIEF_ACTIONS,
            "source": CLIENT_MODE_BRIEF_SOURCE,
            "metadata": {
                "checkin_id": str(today_checkin.get("id") or "") or None,
                "checkin_date": str(today_checkin.get("date") or scope.session_date.isoformat()),
                "assigned_mode": assigned_mode,
                "checkin_score": today_checkin.get("total_score"),
                "has_checkin": True,
                "has_user_why": bool(str(profile.get("user_why") or "").strip()),
            },
        }

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
        client = self._safe(lambda: self.repository.get_client_for_trainer(
            trainer_id=scope.trainer_id,
            client_id=scope.client_id or "",
        )) or {}
        client_name = str(client.get("client_name") or "").strip()
        if not client_name:
            return session
        return {
            **session,
            "client_name": client_name,
        }

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
        missed = [
            client for client in clients
            if not bool(getattr(getattr(client, "week_summary", None), "checkins_completed_today", False))
        ]
        low_recovery = [
            client for client in clients
            if any(getattr(flag, "code", "") == "low_7d_readiness" for flag in getattr(client, "risk_flags", []) or [])
        ]
        priority_clients = [
            client for client in clients
            if getattr(client, "priority_tier", "low") in {"high", "critical"}
        ]
        top_client_name = getattr(priority_clients[0], "client_name", None) if priority_clients else None

        if assigned_count <= 0:
            text = (
                "Your Coach AI board is clear today. Best move: use this window to tighten programming rules, "
                "review client notes, or prepare the next check-in rhythm. Want to start by setting priorities?"
            )
        else:
            priority_line = (
                f" Start with {top_client_name} first."
                if top_client_name
                else " Start with the highest priority client first."
            )
            text = (
                f"You have {assigned_count} clients on the board today, with {len(missed)} missed check-ins "
                f"and {len(low_recovery)} showing low recovery patterns. Best move: review flagged clients "
                f"before pushing new programming.{priority_line} Want to start with the highest priority?"
            )
        return {
            "text": text,
            "title": "Daily Operating Brief",
            "summary": self._clip_summary(text),
            "suggested_actions": TRAINER_SUGGESTED_ACTIONS,
            "source": "trainer_command_center_v1",
        }

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
            trainer_id=str(row.get("trainer_id")),
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
        if role == "client" and normalized != "client_chat":
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
