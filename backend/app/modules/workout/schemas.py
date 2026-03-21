from pydantic import BaseModel
from typing import List, Optional


class Exercise(BaseModel):
    name: str
    sets: int
    reps: int
    rest_seconds: int
    coaching_cue: str
    muscle_group: str


class WorkoutData(BaseModel):
    exercises: List[Exercise]


class WorkoutRequest(BaseModel):
    duration: int
    workout_type: str


class WorkoutResponse(BaseModel):
    plan_id: str
    workout: WorkoutData
