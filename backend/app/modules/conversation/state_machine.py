from typing import Any


REQUIRED_PROFILE_FIELDS = (
    "primary_goal",
    "equipment_access",
    "workout_frequency_target",
)


def detect_profile_patch(message: str) -> dict[str, Any]:
    lowered = message.lower()
    patch: dict[str, Any] = {}

    goal_keywords = {
        "muscle": "muscle_gain",
        "strength": "muscle_gain",
        "fat loss": "fat_loss",
        "lose weight": "fat_loss",
        "general": "general_fitness",
        "fitness": "general_fitness",
        "performance": "performance",
        "run": "performance",
    }
    for keyword, value in goal_keywords.items():
        if keyword in lowered:
            patch["primary_goal"] = value
            break

    equipment_keywords = {
        "full gym": "full_gym",
        "home gym": "home_gym",
        "dumbbell": "dumbbells_bands",
        "band": "dumbbells_bands",
        "bodyweight": "bodyweight_only",
        "no equipment": "bodyweight_only",
    }
    for keyword, value in equipment_keywords.items():
        if keyword in lowered:
            patch["equipment_access"] = value
            break

    for days in (2, 3, 4, 5, 6):
        if f"{days} day" in lowered or f"{days}x" in lowered:
            patch["workout_frequency_target"] = days
            break

    if "beginner" in lowered:
        patch["experience_level"] = "beginner"
    elif "intermediate" in lowered:
        patch["experience_level"] = "intermediate"
    elif "advanced" in lowered:
        patch["experience_level"] = "advanced"

    if "injury" in lowered or "pain" in lowered:
        patch["injuries_present"] = True
        patch["injury_notes"] = message

    return patch


def determine_stage(profile: dict[str, Any]) -> str:
    if not profile.get("primary_goal"):
        return "goal"
    if profile.get("is_training_for_event") and not profile.get("event_type"):
        return "event_details"
    if profile.get("injuries_present") and not profile.get("injury_notes"):
        return "injury_details"
    if not profile.get("equipment_access"):
        return "equipment"
    if not profile.get("workout_frequency_target"):
        return "frequency"
    return "plan_ready"


def is_plan_ready(profile: dict[str, Any]) -> bool:
    return all(profile.get(field) for field in REQUIRED_PROFILE_FIELDS)


def build_assistant_prompt(stage: str, trainer_name: str | None) -> tuple[str, list[str]]:
    coach_name = trainer_name or "your coach"

    prompts = {
        "goal": (
            f"{coach_name} is getting a feel for what matters most to you first. What are you primarily training for right now?",
            ["Build muscle", "Lose fat", "General fitness", "Performance"],
        ),
        "event_details": (
            "Got it. What event are you training for, and when is it happening?",
            ["Running race", "Sport season", "Trip/event", "Not sure yet"],
        ),
        "injury_details": (
            "Thanks for flagging that. What should we be careful around so the plan stays safe and realistic?",
            ["Knee", "Back", "Shoulder", "I will type it"],
        ),
        "equipment": (
            "What equipment do you realistically have access to most weeks?",
            ["Full gym", "Home gym", "Dumbbells + bands", "Bodyweight only"],
        ),
        "frequency": (
            "How many training days per week feels sustainable for you right now?",
            ["3 days", "4 days", "5 days+", "Not sure"],
        ),
        "plan_ready": (
            "We have enough to build a strong starting plan. I can generate your first trainer-aligned plan next.",
            ["Generate my plan", "Adjust one thing first"],
        ),
    }
    return prompts.get(
        stage,
        (
            "Let’s get you set up with just a few quick questions so the plan fits your real life.",
            ["Let’s do it", "Tell me more", "I’m not sure"],
        ),
    )
