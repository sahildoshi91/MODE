from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TrainerIntelligencePromptContext(BaseModel):
    system_appendix: str = ""
    user_appendix: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
