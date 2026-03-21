from pydantic import BaseModel, ValidationError


class ExercisePayload(BaseModel):
    name: str
    sets: int
    reps: int
    rest_seconds: int
    coaching_cue: str
    muscle_group: str


class WorkoutPayload(BaseModel):
    exercises: list[ExercisePayload]


def validate_workout_payload(data: dict) -> dict:
    try:
        return WorkoutPayload.model_validate(data).model_dump()
    except ValidationError as exc:
        raise ValueError("AI response does not match workout schema") from exc
