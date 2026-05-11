from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TrainerProgramTemplate(BaseModel):
    id: str
    trainer_id: str
    name: str
    goal_type: str | None = None
    experience_level: str | None = None
    equipment_access: str | None = None
    frequency: int | None = None
    template_json: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_archived: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TrainerProgramTemplateCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    goal_type: str | None = None
    experience_level: str | None = None
    equipment_access: str | None = None
    frequency: int | None = Field(default=None, ge=1, le=14)
    template_json: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class TrainerProgramTemplatePatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    goal_type: str | None = None
    experience_level: str | None = None
    equipment_access: str | None = None
    frequency: int | None = Field(default=None, ge=1, le=14)
    template_json: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class TrainerProgramTemplateListResponse(BaseModel):
    count: int
    items: list[TrainerProgramTemplate] = Field(default_factory=list)
