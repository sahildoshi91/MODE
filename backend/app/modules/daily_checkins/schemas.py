from datetime import date, datetime
from enum import Enum
from typing import Any

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


class YesterdayCheckinSummary(BaseModel):
    date: date
    score: int
    mode: str
    inputs: DailyCheckinInputs


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
    mode_tagline: str | None = None
    nutrition_tip: str | None = None
    motivational_quote: str | None = None
    primary_goal: str | None = None
    yesterday_checkin_summary: YesterdayCheckinSummary | None = None


class DailyCheckinStatusResponse(BaseModel):
    date: date
    completed: bool
    checkin: DailyCheckinResult | None = None


class SubmitDailyCheckinRequest(BaseModel):
    date: date
    inputs: DailyCheckinInputs
    time_to_complete: int | None = Field(default=None, ge=0)


class PlanType(str, Enum):
    TRAINING = "training"
    NUTRITION = "nutrition"


class Environment(str, Enum):
    FULL_GYM = "full_gym"
    HOME_GYM = "home_gym"
    HOTEL_ROOM = "hotel_room"
    OUTDOORS = "outdoors"
    BODYWEIGHT = "bodyweight"
    LIMITED = "limited"


class TrainingPlanType(str, Enum):
    HIIT = "hiit"
    STRENGTH = "strength"
    CARDIO = "cardio"
    FLEXIBILITY = "flexibility"
    MOBILITY = "mobility"
    GENERAL = "general"


class PlanDifficulty(str, Enum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class TrainingBlockItem(BaseModel):
    name: str
    duration: str
    description: str | None = None


class TrainingExercise(BaseModel):
    name: str
    sets: int
    reps: str
    rest: str
    muscleGroup: str
    description: str
    coachTip: str


class StructuredTrainingPlan(BaseModel):
    title: str
    type: TrainingPlanType
    difficulty: PlanDifficulty
    durationMinutes: int
    description: str
    warmup: list[TrainingBlockItem] = Field(default_factory=list)
    exercises: list[TrainingExercise] = Field(default_factory=list)
    cooldown: list[TrainingBlockItem] = Field(default_factory=list)
    coachNote: str


class NutritionFood(BaseModel):
    name: str
    amount: str
    calories: int
    protein: int


class NutritionMeal(BaseModel):
    name: str
    timing: str
    emoji: str
    foods: list[NutritionFood] = Field(default_factory=list)
    totalCalories: int
    totalProtein: int
    notes: str | None = None


class StructuredNutritionPlan(BaseModel):
    title: str
    totalCalories: int
    totalProtein: int
    meals: list[NutritionMeal] = Field(default_factory=list)
    coachNote: str


class GenerateCheckinPlanRequest(BaseModel):
    checkin_id: str
    plan_type: PlanType
    environment: Environment | None = None
    time_available: int | None = Field(default=None, ge=10, le=60)
    nutrition_day_note: str | None = None
    include_yesterday_context: bool = False


class GenerateCheckinPlanResponse(BaseModel):
    plan_id: str
    plan_type: PlanType
    content: str
    structured: dict[str, Any]


class LogGeneratedWorkoutRequest(BaseModel):
    generated_plan_id: str
    title: str
    elapsed_seconds: int = Field(ge=0)
    completed: bool = True


class LogGeneratedWorkoutResponse(BaseModel):
    workout_id: str
    completed: bool
