from app.ai.prompts.workout import WORKOUT_PROMPT_V2


def build_workout_prompt(duration: int, workout_type: str, fitness_level: str, equipment: list, goals: list, injuries: list) -> str:
    return WORKOUT_PROMPT_V2.format(
        duration=duration,
        workout_type=workout_type,
        fitness_level=fitness_level,
        equipment=", ".join(equipment) if equipment else "none",
        goals=", ".join(goals) if goals else "general fitness",
        injuries=", ".join(injuries) if injuries else "none",
    )
