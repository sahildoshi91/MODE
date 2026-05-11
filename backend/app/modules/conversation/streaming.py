from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from app.core.config import settings
from app.modules.conversation.schemas import ChatRequest


CHAT_STREAM_EVENT_TYPES = frozenset({"status", "token", "message_delta", "done", "error"})
CHAT_STREAM_FRIENDLY_ERROR_MESSAGE = "Something went wrong. Your trainer has been notified."

STREAMING_RESPONSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

STATUS_READING_USER_MESSAGE = "reading_user_message"
STATUS_LOADING_CLIENT_PROFILE = "loading_client_profile"
STATUS_RETRIEVING_TRAINER_KNOWLEDGE = "retrieving_trainer_knowledge"
STATUS_CHECKING_RECENT_SIGNALS = "checking_recent_signals"
STATUS_GENERATING_RECOMMENDATION = "generating_recommendation"
STATUS_WRITING_FINAL_COACH_RESPONSE = "writing_final_coach_response"
STATUS_PREPARING_COACHING_RESPONSE = "preparing_coaching_response"

GENERIC_STATUS_MESSAGE = "Preparing your coaching response..."


def is_checkin_context(request: ChatRequest | Any | None) -> bool:
    client_context = getattr(request, "client_context", None)
    if not isinstance(client_context, dict):
        return False
    entrypoint = str(client_context.get("entrypoint") or "").strip().lower()
    if entrypoint in {"post_checkin", "daily_checkin", "daily-checkin", "checkin"}:
        return True
    checkin_context = client_context.get("checkin_context")
    return isinstance(checkin_context, dict) and bool(checkin_context)


def resolve_status_message(stage: str, request: ChatRequest | Any | None = None) -> str:
    if stage == STATUS_READING_USER_MESSAGE:
        return "Reading your check-in..." if is_checkin_context(request) else "Coach is checking their notes"
    if stage == STATUS_RETRIEVING_TRAINER_KNOWLEDGE:
        return "Applying your coach's preferences..."
    if stage == STATUS_CHECKING_RECENT_SIGNALS:
        return "Checking your recovery signals..."
    if stage == STATUS_GENERATING_RECOMMENDATION:
        return "Building today's recommendation..."
    if stage == STATUS_WRITING_FINAL_COACH_RESPONSE:
        return "Writing your coaching response..."
    return GENERIC_STATUS_MESSAGE


def status_event(stage: str, *, request: ChatRequest | Any | None = None, **payload: Any) -> dict[str, Any]:
    return {
        "type": "status",
        "stage": stage,
        "message": resolve_status_message(stage, request),
        **payload,
    }


def status_event_for_intent(
    stage: str,
    *,
    routed_intent: Any | None = None,
    request: ChatRequest | Any | None = None,
    **payload: Any,
) -> dict[str, Any]:
    status_messages = getattr(routed_intent, "status_messages", None)
    if isinstance(status_messages, dict):
        routed_message = str(status_messages.get(stage) or "").strip()
        if routed_message:
            payload["message"] = routed_message
    if stage == STATUS_GENERATING_RECOMMENDATION and "message" not in payload:
        routed_message = str(getattr(routed_intent, "user_status_message", "") or "").strip()
        if routed_message:
            payload["message"] = routed_message
    return status_event(stage, request=request, **payload)


def message_delta_event(delta: str, **payload: Any) -> dict[str, Any]:
    return {
        "type": "token",
        "content": delta,
        "delta": delta,
        **payload,
    }


def done_event(**payload: Any) -> dict[str, Any]:
    return {
        "type": "done",
        **payload,
    }


def error_event(detail: str | None = None, **payload: Any) -> dict[str, Any]:
    safe_detail = detail or "Chat response could not be completed"
    return {
        "type": "error",
        "message": CHAT_STREAM_FRIENDLY_ERROR_MESSAGE,
        "detail": safe_detail,
        "retry": True,
        **payload,
    }


@dataclass
class ChatStreamSseEncoder:
    request_id: str
    append_event: Callable[..., None] | None = None
    update_status: Callable[..., None] | None = None
    seq: int = 0

    def encode(
        self,
        payload: dict[str, Any],
        *,
        persist: bool = True,
        request_status: str | None = None,
        error_detail: str | None = None,
        completed_message_id: str | None = None,
    ) -> str:
        event_type, payload = self._normalized_payload(payload)

        self.seq += 1
        payload_with_meta = {
            **payload,
            "request_id": self.request_id,
            "seq": self.seq,
        }

        self.record_encoded_event(
            payload,
            persist=persist,
            request_status=request_status,
            error_detail=error_detail,
            completed_message_id=completed_message_id,
            seq=self.seq,
        )

        canonical = f"event: {event_type}\ndata: {json.dumps(payload_with_meta, default=str)}\n\n"
        if event_type != "token" or not settings.chat_stream_legacy_alias_enabled:
            return canonical

        self.seq += 1
        legacy_payload = {
            **payload_with_meta,
            "type": "message_delta",
            "delta": payload_with_meta.get("content") or payload_with_meta.get("delta") or "",
            "seq": self.seq,
            "legacy_alias": True,
            "legacy_alias_for_seq": payload_with_meta.get("seq"),
        }
        return canonical + f"event: message_delta\ndata: {json.dumps(legacy_payload, default=str)}\n\n"

    def record_encoded_event(
        self,
        payload: dict[str, Any],
        *,
        persist: bool = True,
        request_status: str | None = None,
        error_detail: str | None = None,
        completed_message_id: str | None = None,
        seq: int | None = None,
    ) -> None:
        event_type, payload = self._normalized_payload(payload)
        seq_value = int(seq if seq is not None else self.seq)
        payload_with_meta = {
            **payload,
            "request_id": self.request_id,
            "seq": seq_value,
        }
        stage = payload_with_meta.get("stage")

        if persist and callable(self.append_event):
            self.append_event(
                request_id=self.request_id,
                seq=seq_value,
                event_type=event_type,
                stage=str(stage) if stage else None,
                payload=payload_with_meta,
            )
        if request_status and callable(self.update_status):
            self.update_status(
                request_id=self.request_id,
                status=request_status,
                latest_event_seq=seq_value,
                completed_message_id=completed_message_id,
                error_detail=error_detail,
            )

    @staticmethod
    def _normalized_payload(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        event_type = str(payload.get("type") or "")
        if event_type in CHAT_STREAM_EVENT_TYPES:
            return event_type, payload
        event_type = "status"
        return event_type, {
            "type": event_type,
            "stage": STATUS_PREPARING_COACHING_RESPONSE,
            "message": GENERIC_STATUS_MESSAGE,
            **payload,
        }
