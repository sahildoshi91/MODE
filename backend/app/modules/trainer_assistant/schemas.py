from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TrainerAssistantInteractionType(str, Enum):
    LIVE = "live"
    BACKGROUND = "background"


class TrainerAssistantStakes(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class TrainerAssistantComplexity(str, Enum):
    SIMPLE = "simple"
    MULTI_CONSTRAINT = "multi_constraint"
    AMBIGUOUS = "ambiguous"


class TrainerAssistantContextSize(str, Enum):
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"


class TrainerAssistantToneFidelity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class TrainerAssistantPassConfidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class TrainerAssistantActionType(str, Enum):
    BUILD_PROGRAM = "build_program"
    ADJUST_PLAN = "adjust_plan"
    ANALYZE_CLIENT = "analyze_client"
    MESSAGE_CLIENT = "message_client"
    SUMMARIZE = "summarize"
    CLASSIFY = "classify"


class TrainerAssistantRoutingInput(BaseModel):
    interaction_type: TrainerAssistantInteractionType = TrainerAssistantInteractionType.LIVE
    stakes: TrainerAssistantStakes = TrainerAssistantStakes.MEDIUM
    complexity: TrainerAssistantComplexity = TrainerAssistantComplexity.SIMPLE
    context_size: TrainerAssistantContextSize = TrainerAssistantContextSize.MEDIUM
    tone_fidelity_needed: TrainerAssistantToneFidelity = TrainerAssistantToneFidelity.MEDIUM
    previous_pass_confidence: TrainerAssistantPassConfidence = TrainerAssistantPassConfidence.HIGH
    action_type: TrainerAssistantActionType = TrainerAssistantActionType.ANALYZE_CLIENT


class RoutingThresholdConfig(BaseModel):
    gpt_5_4_escalation_min_score: int = 4
    opus_escalation_min_score: int = 7
    second_pass_min_score: int = 3


class FallbackPolicyConfig(BaseModel):
    model_fallback_order: dict[str, list[str]] = Field(default_factory=dict)


class ProviderModelRegistry(BaseModel):
    default_live_model: str
    complex_reasoning_model: str
    premium_review_model: str
    hardest_case_model: str
    background_model: str


class TrainerAssistantRoutingDecision(BaseModel):
    model: str
    fallback_models: list[str] = Field(default_factory=list)
    reason: str
    escalation_applied: bool = False
    second_pass_model: str | None = None
    interaction_type: TrainerAssistantInteractionType = TrainerAssistantInteractionType.LIVE


class TrainerAssistantOutputSection(BaseModel):
    title: str
    text: str | None = None
    items: list[str] = Field(default_factory=list)


class TrainerAssistantNormalizedOutput(BaseModel):
    format_version: str = "v1"
    action_type: TrainerAssistantActionType
    headline: str
    summary: str
    sections: list[TrainerAssistantOutputSection] = Field(default_factory=list)
    editable_payload: dict[str, Any] = Field(default_factory=dict)
    preview_required: bool = True
    client_impacting: bool = True
    confidence: float = 0.72
    next_actions: list[str] = Field(default_factory=list)


class TrainerAssistantClientOption(BaseModel):
    client_id: str
    client_name: str
    priority_tier: str = "low"
    scheduled_today: bool = False
    risk_labels: list[str] = Field(default_factory=list)


class TrainerAssistantPulseInsight(BaseModel):
    id: str
    client_id: str
    label: str
    detail: str
    severity: str = "medium"
    action_type: TrainerAssistantActionType
    suggested_prompt: str


class TrainerAssistantBootstrapResponse(BaseModel):
    generated_at: datetime
    active_client_id: str | None = None
    requires_client_selection: bool = False
    clients: list[TrainerAssistantClientOption] = Field(default_factory=list)
    pulse_insights: list[TrainerAssistantPulseInsight] = Field(default_factory=list)
    suggested_prompts: list[str] = Field(default_factory=list)
    context_bundle: dict[str, Any] = Field(default_factory=dict)


class TrainerAssistantExecuteRequest(BaseModel):
    client_id: str | None = None
    action_type: TrainerAssistantActionType
    message: str | None = Field(default=None, max_length=4000)
    routing_input: TrainerAssistantRoutingInput | None = None


class TrainerAssistantRouteSummary(BaseModel):
    reason: str
    escalation_applied: bool = False
    fallback_applied: bool = False
    second_pass_applied: bool = False


class TrainerAssistantExecuteResponse(BaseModel):
    draft_id: str
    output: TrainerAssistantNormalizedOutput
    route: TrainerAssistantRouteSummary


class TrainerAssistantDraftEditRequest(BaseModel):
    edited_output_json: dict[str, Any]
    edited_output_text: str | None = None
    notes: str | None = None


class TrainerAssistantDraftApproveRequest(BaseModel):
    edited_output_json: dict[str, Any] | None = None
    edited_output_text: str | None = None
    notes: str | None = None


class TrainerAssistantDraftRejectRequest(BaseModel):
    reason: str | None = None


class TrainerAssistantDraftMutationResponse(BaseModel):
    draft_id: str
    review_status: str
    output: TrainerAssistantNormalizedOutput


class TrainerAssistantBackgroundJobRequest(BaseModel):
    client_id: str | None = None
    action_type: TrainerAssistantActionType
    message: str | None = Field(default=None, max_length=2000)
    essential: bool = True
    routing_input: TrainerAssistantRoutingInput | None = None


class TrainerAssistantBackgroundRunRequest(BaseModel):
    run_date: date | None = None
    jobs: list[TrainerAssistantBackgroundJobRequest] = Field(default_factory=list, max_length=5)


class TrainerAssistantBackgroundResult(BaseModel):
    action_type: TrainerAssistantActionType
    client_id: str | None = None
    status: str
    draft_id: str | None = None
    error: str | None = None


class TrainerAssistantBackgroundRunResponse(BaseModel):
    run_started_at: datetime
    run_finished_at: datetime
    results: list[TrainerAssistantBackgroundResult] = Field(default_factory=list)


class TrainerAssistantRouterEvent(BaseModel):
    trainer_id: str
    client_id: str | None = None
    action_type: TrainerAssistantActionType
    interaction_type: TrainerAssistantInteractionType
    selected_model: str
    execution_model: str
    fallback_applied: bool
    escalation_applied: bool
    second_pass_applied: bool
    route_reason: str
    latency_ms: float
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    succeeded: bool = True
    failure_reason: str | None = None
