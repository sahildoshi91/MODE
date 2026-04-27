from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


AtlasKnowledgeType = Literal[
    "adherence_strategy",
    "motivation_strategy",
    "programming_rule",
    "injury_modification_rule",
    "nutrition_coaching_pattern",
    "tone_pattern",
    "escalation_rule",
    "expectation_setting",
    "behavior_change_pattern",
    "accountability_pattern",
]
AtlasLearningEventType = Literal[
    "trainer_correction",
    "trainer_approval",
    "trainer_rejection",
    "resolved_review_item",
    "programming_rule_observed",
    "trainer_deleted_extraction",
    "admin_import",
]
AtlasLearningScope = Literal["trainer_specific", "atlas_level", "both", "neither"]
AtlasLearningEventStatus = Literal["accepted", "rejected", "needs_review"]
AtlasReviewStatus = Literal["pending", "approved", "rejected", "edited"]
AtlasKnowledgeStatus = Literal["proposed", "approved", "rejected", "retired"]
TrainerAiKnowledgeStatus = Literal["proposed", "approved", "rejected", "retired"]


class AtlasSanitizationResult(BaseModel):
    sanitized_text: str
    privacy_risk_score: float = 0.0
    privacy_flags: list[str] = Field(default_factory=list)


class AtlasExtractorOutput(BaseModel):
    should_store: bool = False
    scope: AtlasLearningScope = "neither"
    knowledge_type: AtlasKnowledgeType = "adherence_strategy"
    situation_tags: list[str] = Field(default_factory=list)
    client_context_tags: list[str] = Field(default_factory=list)
    generalized_learning: str = ""
    response_pattern: str | None = None
    trainer_specific_rule: str | None = None
    contraindications: list[str] = Field(default_factory=list)
    confidence_score: float = 0.0
    privacy_risk_score: float = 1.0
    privacy_flags: list[str] = Field(default_factory=list)


class TrainerAiReviewQueueItem(BaseModel):
    id: str
    trainer_id: str
    proposed_rule: str
    reason_detected: str
    confidence_score: float = 0.0
    knowledge_type: str = "trainer_preference"
    example_pattern_sanitized: str | None = None
    reviewer_status: AtlasReviewStatus = "pending"
    reviewer_notes: str | None = None
    created_at: datetime | None = None
    reviewed_at: datetime | None = None


class TrainerAiKnowledgeItem(BaseModel):
    id: str
    trainer_id: str
    knowledge_type: str
    learned_rule: str
    example_pattern_sanitized: str | None = None
    confidence_score: float = 0.0
    status: TrainerAiKnowledgeStatus = "proposed"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TrainerAiReviewQueueUpdateRequest(BaseModel):
    proposed_rule: str | None = None
    reviewer_notes: str | None = None


class TrainerAiReviewQueueRejectRequest(BaseModel):
    reviewer_notes: str | None = None


class AtlasAdminMeResponse(BaseModel):
    allowed: bool = False
    email: str | None = None


class AtlasReviewQueueItem(BaseModel):
    id: str
    proposed_learning: str
    knowledge_type: str
    situation_tags: list[str] = Field(default_factory=list)
    client_context_tags: list[str] = Field(default_factory=list)
    privacy_flags: list[str] = Field(default_factory=list)
    privacy_risk_score: float = 1.0
    confidence_score: float = 0.0
    response_pattern: str | None = None
    contraindications: list[str] | None = None
    reviewer_status: AtlasReviewStatus = "pending"
    reviewer_notes: str | None = None
    created_at: datetime | None = None
    reviewed_at: datetime | None = None


class AtlasKnowledgeItem(BaseModel):
    id: str
    knowledge_type: AtlasKnowledgeType
    situation_tags: list[str] = Field(default_factory=list)
    client_context_tags: list[str] = Field(default_factory=list)
    generalized_learning: str
    response_pattern: str | None = None
    contraindications: list[str] | None = None
    confidence_score: float = 0.0
    privacy_risk_score: float = 1.0
    evidence_count: int = 1
    status: AtlasKnowledgeStatus = "proposed"
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_used_at: datetime | None = None


class AtlasReviewQueueUpdateRequest(BaseModel):
    proposed_learning: str | None = None
    knowledge_type: str | None = None
    situation_tags: list[str] | None = None
    client_context_tags: list[str] | None = None
    privacy_flags: list[str] | None = None
    confidence_score: float | None = None
    privacy_risk_score: float | None = None
    response_pattern: str | None = None
    contraindications: list[str] | None = None
    reviewer_notes: str | None = None


class AtlasReviewQueueRejectRequest(BaseModel):
    reviewer_notes: str | None = None


class AtlasAuditRecord(BaseModel):
    event_type: str
    actor_type: str
    action: str
    privacy_risk_score: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
