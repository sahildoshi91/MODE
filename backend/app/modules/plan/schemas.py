from pydantic import BaseModel, Field


class PlanSummary(BaseModel):
    trainer_id: str | None = None
    client_id: str | None = None
    status: str = "draft"
    rationale: str
    recommended_split: str
    next_step: str
    source_template_ids: list[str] = Field(default_factory=list)
