from __future__ import annotations

from datetime import date
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


ChatSessionRole = Literal["client", "trainer"]
ChatSessionType = Literal["client_chat", "trainer_chat", "coach_ai"]
ChatSenderType = Literal["user", "ai", "system"]


class ChatSessionTodayRequest(BaseModel):
    role: ChatSessionRole
    session_type: ChatSessionType
    client_id: UUID | None = None
    session_date: date | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_role_session_type(self):
        if self.role == "client" and self.session_type != "client_chat":
            raise ValueError("client role only supports client_chat sessions")
        if self.role == "trainer" and self.session_type not in {"trainer_chat", "coach_ai"}:
            raise ValueError("trainer role only supports trainer_chat or coach_ai sessions")
        return self


class ChatSessionContinueRequest(BaseModel):
    session_date: date | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatSessionSendRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    client_context: dict[str, Any] = Field(default_factory=dict)
    session_date: date | None = None
    client_message_id: str | None = Field(default=None, min_length=1, max_length=120)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=120)
    request_id: UUID | None = None

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message must not be empty")
        return normalized

    @field_validator("client_context")
    @classmethod
    def validate_client_context(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(value) > 32:
            raise ValueError("client_context has too many keys")
        return value

    @field_validator("client_message_id", "idempotency_key")
    @classmethod
    def validate_optional_delivery_identifiers(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ChatSessionRecord(BaseModel):
    id: str
    user_id: str
    trainer_id: str
    client_id: str | None = None
    client_name: str | None = None
    role: ChatSessionRole
    session_type: ChatSessionType
    session_date: date
    summary: str | None = None
    title: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None
    last_message_at: str | None = None
    read_only: bool = False


class ChatSessionMessage(BaseModel):
    id: str
    session_id: str
    sender_type: ChatSenderType
    content: str
    created_at: str | None = None
    message_index: int
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatSessionTodayResponse(BaseModel):
    session: ChatSessionRecord
    messages: list[ChatSessionMessage] = Field(default_factory=list)
    suggested_actions: list[str] = Field(default_factory=list)
    read_only: bool = False


class ChatSessionListResponse(BaseModel):
    sessions: list[ChatSessionRecord] = Field(default_factory=list)


class ChatSessionDetailResponse(BaseModel):
    session: ChatSessionRecord
    messages: list[ChatSessionMessage] = Field(default_factory=list)
    suggested_actions: list[str] = Field(default_factory=list)
    read_only: bool = False


class ChatSessionSendResponse(BaseModel):
    session: ChatSessionRecord
    user_message: ChatSessionMessage
    ai_message: ChatSessionMessage
    suggested_actions: list[str] = Field(default_factory=list)
