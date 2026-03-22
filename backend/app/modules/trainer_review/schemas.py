from pydantic import BaseModel, Field


class ReviewQueueItem(BaseModel):
    id: str | None = None
    trainer_id: str
    client_id: str | None = None
    conversation_id: str | None = None
    message_id: str | None = None
    user_question: str
    model_draft_answer: str | None = None
    confidence_score: float | None = None
    status: str = "open"


class ReviewApprovalRequest(BaseModel):
    approved_answer: str
    response_tags: list[str] = Field(default_factory=list)
