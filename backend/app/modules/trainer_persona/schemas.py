from typing import Any

from pydantic import BaseModel, Field


class TrainerPersona(BaseModel):
    id: str | None = None
    trainer_id: str
    persona_name: str
    tone_description: str | None = None
    coaching_philosophy: str | None = None
    communication_rules: dict[str, Any] = Field(default_factory=dict)
    onboarding_preferences: dict[str, Any] = Field(default_factory=dict)
    fallback_behavior: dict[str, Any] = Field(default_factory=dict)
    is_default: bool = True
