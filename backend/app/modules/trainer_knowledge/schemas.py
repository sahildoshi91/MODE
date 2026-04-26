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
    created_at: datetime | None = None


class TrainerKnowledgeDocumentCreate(BaseModel):
    title: str
    file_url: str | None = None
    document_type: str | None = None
    raw_text: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class TrainerKnowledgeIngestRequest(TrainerKnowledgeDocumentCreate):
    pass


class TrainerKnowledgeDocumentUpdateRequest(BaseModel):
    title: str | None = None
    file_url: str | None = None
    document_type: str | None = None
    raw_text: str | None = None
    metadata: dict[str, Any] | None = None


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


class TrainerKnowledgeSaveResponse(TrainerKnowledgeIngestResponse):
    pass


class TrainerKnowledgeEntry(BaseModel):
    id: str
    tenant_id: str
    trainer_id: str
    client_id: str | None = None
    title: str
    body: str | None = None
    raw_content: str
    structured_summary: str | None = None
    type: str = "note"
    knowledge_type: str = "note"
    scope: str = "global"
    tags: list[str] = Field(default_factory=list)
    ai_usable: bool = True
    ai_enabled: bool = True
    status: str = "active"
    source: str = "manual"
    source_message_id: str | None = None
    confidence_score: float | None = None
    embedding_status: str = "pending"
    last_embedded_at: datetime | None = None
    version_count: int = 1
    last_used_at: datetime | None = None
    usage_count: int = 0
    conflict_group_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    archived_at: datetime | None = None


class TrainerKnowledgeEntryCreateRequest(BaseModel):
    title: str | None = None
    body: str | None = None
    raw_content: str | None = None
    structured_summary: str | None = None
    type: str | None = None
    knowledge_type: str | None = None
    scope: str = "global"
    tags: list[str] = Field(default_factory=list)
    ai_usable: bool | None = None
    ai_enabled: bool = True
    source: str = "manual"
    source_message_id: str | None = None
    confidence_score: float | None = None
    client_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    change_reason: str | None = None


class TrainerKnowledgeEntryUpdateRequest(BaseModel):
    title: str | None = None
    body: str | None = None
    raw_content: str | None = None
    structured_summary: str | None = None
    type: str | None = None
    knowledge_type: str | None = None
    scope: str | None = None
    tags: list[str] | None = None
    ai_usable: bool | None = None
    ai_enabled: bool | None = None
    status: str | None = None
    confidence_score: float | None = None
    client_id: str | None = None
    source_message_id: str | None = None
    metadata: dict[str, Any] | None = None
    change_reason: str | None = None


class TrainerKnowledgeClassificationRequest(BaseModel):
    body: str | None = None
    raw_content: str | None = None
    title: str | None = None
    client_id: str | None = None
    preferred_scope: str | None = None
    preferred_knowledge_type: str | None = None


class TrainerKnowledgeClassificationSuggestion(BaseModel):
    title: str
    structured_summary: str | None = None
    type: str | None = None
    knowledge_type: str
    scope: str
    tags: list[str] = Field(default_factory=list)
    ai_usable: bool = True
    ai_enabled: bool = True
    confidence: float = 0.0
    client_id: str | None = None
    rationale: str | None = None


class TrainerKnowledgeSafetyCheckResult(BaseModel):
    ai_enabled_forced_off: bool = False
    issues: list[str] = Field(default_factory=list)
    message: str | None = None
    severity: str | None = None


class TrainerKnowledgeConflictCandidate(BaseModel):
    knowledge_entry_id: str
    title: str
    structured_summary: str | None = None
    knowledge_type: str
    score: float
    suggested_resolution: str = "review"


class TrainerKnowledgeEntryMutationResponse(BaseModel):
    entry: TrainerKnowledgeEntry
    safety: TrainerKnowledgeSafetyCheckResult = Field(default_factory=TrainerKnowledgeSafetyCheckResult)
    conflicts: list[TrainerKnowledgeConflictCandidate] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class TrainerKnowledgeVersion(BaseModel):
    id: str
    tenant_id: str
    trainer_id: str
    knowledge_entry_id: str
    version_number: int
    content: str
    structured_summary: str | None = None
    edited_by: str | None = None
    created_at: datetime | None = None
    change_reason: str | None = None


class TrainerKnowledgeRefineRequest(BaseModel):
    action: str
    content: str | None = None
    change_reason: str | None = None
