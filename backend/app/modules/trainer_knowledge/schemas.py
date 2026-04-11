from datetime import datetime
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


class TrainerKnowledgeIngestRequest(TrainerKnowledgeDocumentCreate):
    pass


class TrainerRule(BaseModel):
    id: str
    tenant_id: str
    trainer_id: str
    document_id: str | None = None
    category: str
    rule_text: str
    confidence: float | None = None
    source_excerpt: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_archived: bool = False
    current_version: int = 1
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TrainerRuleUpdateRequest(BaseModel):
    category: str | None = None
    rule_text: str | None = None
    confidence: float | None = None
    source_excerpt: str | None = None
    metadata: dict[str, Any] | None = None


class TrainerKnowledgeExtractionSummary(BaseModel):
    strategy: str = "deterministic"
    llm_attempted: bool = False
    llm_succeeded: bool = False
    fallback_reason: str | None = None
    rules_created: int = 0


class TrainerKnowledgeIngestResponse(BaseModel):
    document: TrainerKnowledgeDocument
    extracted_rules: list[TrainerRule] = Field(default_factory=list)
    extraction: TrainerKnowledgeExtractionSummary = Field(default_factory=TrainerKnowledgeExtractionSummary)
