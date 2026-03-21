# Versioned prompts for workout generation
WORKOUT_PROMPT_V1 = """
You are a certified personal trainer. Create a {duration}-minute {workout_type} workout for a {fitness_level} with access to {equipment}. Their goals: {goals}. Injuries to avoid: {injuries}. Return ONLY valid JSON: {{ "exercises": [{{ "name": "", "sets": 0, "reps": 0, "rest_seconds": 0, "coaching_cue": "", "muscle_group": "" }}] }}
"""


def build_workout_prompt(duration: int, workout_type: str, fitness_level: str, equipment: list, goals: list, injuries: list) -> str:
    return WORKOUT_PROMPT_V1.format(
        duration=duration,
        workout_type=workout_type,
        fitness_level=fitness_level,
        equipment=", ".join(equipment),
        goals=", ".join(goals),
        injuries=", ".join(injuries)
    )