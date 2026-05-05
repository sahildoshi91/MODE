from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from app.modules.conversation.schemas import ChatRequest


CHAT_STREAM_EVENT_TYPES = frozenset({"status", "message_delta", "done", "error"})
CHAT_STREAM_FRIENDLY_ERROR_MESSAGE = "I couldn't finish that response. Try again in a moment."

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


def message_delta_event(delta: str, **payload: Any) -> dict[str, Any]:
    return {
        "type": "message_delta",
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
        event_type = str(payload.get("type") or "")
        if event_type not in CHAT_STREAM_EVENT_TYPES:
            event_type = "status"
            payload = {
                "type": event_type,
                "stage": STATUS_PREPARING_COACHING_RESPONSE,
                "message": GENERIC_STATUS_MESSAGE,
                **payload,
            }

        self.seq += 1
        payload_with_meta = {
            **payload,
            "request_id": self.request_id,
            "seq": self.seq,
        }
        stage = payload_with_meta.get("stage")

        if persist and callable(self.append_event):
            self.append_event(
                request_id=self.request_id,
                seq=self.seq,
                event_type=event_type,
                stage=str(stage) if stage else None,
                payload=payload_with_meta,
            )
        if request_status and callable(self.update_status):
            self.update_status(
                request_id=self.request_id,
                status=request_status,
                latest_event_seq=self.seq,
                completed_message_id=completed_message_id,
                error_detail=error_detail,
            )

        return f"event: {event_type}\ndata: {json.dumps(payload_with_meta, default=str)}\n\n"
