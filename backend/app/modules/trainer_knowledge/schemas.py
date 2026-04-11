from typing import Any

from pydantic import BaseModel, Field


class TrainerKnowledgeDocument(BaseModel):
    id: str | None = None
    trainer_id: str
    title: str
    file_url: str | None = None
    document_type: str | None = None
    raw_text: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    indexing_status: str = "pending"


class TrainerKnowledgeDocumentCreate(BaseModel):
    title: str
    file_url: str | None = None
    document_type: str | None = None
    raw_text: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
