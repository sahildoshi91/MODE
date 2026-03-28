from datetime import date, datetime

from pydantic import BaseModel, Field


class DailyCheckinInputs(BaseModel):
    sleep: int = Field(ge=1, le=5)
    stress: int = Field(ge=1, le=5)
    soreness: int = Field(ge=1, le=5)
    nutrition: int = Field(ge=1, le=5)
    motivation: int = Field(ge=1, le=5)


class TrainingRecommendation(BaseModel):
    type: str
    duration: str
    intensity: str


class NutritionRecommendation(BaseModel):
    rule: str


class MindsetRecommendation(BaseModel):
    cue: str


class DailyCheckinResult(BaseModel):
    id: str
    date: date
    score: int
    mode: str
    inputs: DailyCheckinInputs
    training: TrainingRecommendation
    nutrition: NutritionRecommendation
    mindset: MindsetRecommendation
    time_to_complete: int | None = None
    completion_timestamp: datetime | None = None


class DailyCheckinStatusResponse(BaseModel):
    date: date
    completed: bool
    checkin: DailyCheckinResult | None = None


class SubmitDailyCheckinRequest(BaseModel):
    date: date
    inputs: DailyCheckinInputs
    time_to_complete: int | None = Field(default=None, ge=0)
