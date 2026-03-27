import json
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field
from pydantic import field_validator


class ConversationState(BaseModel):
    current_stage: str = "welcome"
    onboarding_complete: bool = False


class ChatRequest(BaseModel):
    conversation_id: UUID | None = None
    message: str = Field(min_length=1, max_length=4000)
    client_context: dict[str, Any] = Field(default_factory=dict)

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
        if len(json.dumps(value, default=str)) > 8000:
            raise ValueError("client_context payload is too large")
        return value


class TokenUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    thoughts_tokens: int = 0


class RouteDebug(BaseModel):
    selected_provider: str
    selected_model: str
    execution_provider: str
    execution_model: str
    flow: str
    reason: str
    task_type: str
    response_mode: str
    fallback_reason: str | None = None


class ConversationUsage(BaseModel):
    conversation_id: str
    total_prompt_tokens: int = 0
    total_completion_tokens: int = 0
    total_tokens: int = 0
    total_thoughts_tokens: int = 0
    usage_event_count: int = 0
    last_execution_provider: str | None = None
    last_execution_model: str | None = None
    models_used: list[str] = Field(default_factory=list)
    providers_used: list[str] = Field(default_factory=list)
    last_usage_at: str | None = None


class ChatResponse(BaseModel):
    conversation_id: str | None
    assistant_message: str
    quick_replies: list[str] = Field(default_factory=list)
    conversation_state: ConversationState
    profile_patch: dict[str, Any] = Field(default_factory=dict)
    trainer_context: dict[str, Any] = Field(default_factory=dict)
    fallback_triggered: bool = False
    token_usage: TokenUsage = Field(default_factory=TokenUsage)
    route_debug: RouteDebug | None = None
    conversation_usage: ConversationUsage | None = None
