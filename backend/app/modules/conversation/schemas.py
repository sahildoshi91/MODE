from typing import Any

from pydantic import BaseModel, Field


class ConversationState(BaseModel):
    current_stage: str = "welcome"
    onboarding_complete: bool = False


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str
    client_context: dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    conversation_id: str | None
    assistant_message: str
    quick_replies: list[str] = Field(default_factory=list)
    conversation_state: ConversationState
    profile_patch: dict[str, Any] = Field(default_factory=dict)
    trainer_context: dict[str, Any] = Field(default_factory=dict)
    fallback_triggered: bool = False
