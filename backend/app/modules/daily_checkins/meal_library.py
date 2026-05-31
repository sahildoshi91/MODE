MEAL_EXAMPLES = {
    "low": {
        "examples": [
            "eggs and toast",
            "Greek yogurt with fruit and a handful of nuts",
            "peanut butter on whole grain bread with a banana",
        ],
        "timing": "Try to eat something - anything with protein - before you train.",
        "why": "Your body is running low. Even a small meal is better than nothing.",
    },
    "neutral": {
        "examples": [
            "eggs and toast",
            "Greek yogurt with fruit",
            "rice and chicken if you've got it",
            "a protein shake with oats blended in",
        ],
        "timing": "Aim to eat 60-90 minutes before you train.",
        "why": "That fuel is what keeps your energy from crashing mid-session.",
    },
    "high": {
        "examples": [
            "a bigger meal works here - chicken and rice, eggs with oatmeal",
            "a substantial smoothie with protein and fruit",
        ],
        "timing": "Keep that going. Eat well before and refuel after.",
        "why": "Your body can handle more today and will use it.",
    },
}


EFFORT_GUIDANCE = {
    "BEAST": {
        "sets": "4-5 sets",
        "reps": "5-6 reps",
        "intensity": "85-90% of what you've got",
        "feel": "You should feel challenged on the last 2 reps - not destroyed, but genuinely working.",
        "modifier_if_body_low": None,
    },
    "BUILD": {
        "sets": "3-4 sets",
        "reps": "8-10 reps",
        "intensity": "about 70% of what you'd normally push",
        "feel": "You should finish each set feeling like you had 2-3 more reps in you.",
        "modifier_if_body_low": "Keep the rep count but drop the weight slightly - your joints will thank you.",
    },
    "RECOVER": {
        "sets": "2-3 sets",
        "reps": "12-15 reps or time-based (20-30 sec)",
        "intensity": "easy effort - 50% or less",
        "feel": "Nothing should burn. If it does, back off.",
        "modifier_if_body_low": "Stick to bodyweight or resistance bands only today.",
    },
    "REST": {
        "sets": None,
        "reps": None,
        "intensity": None,
        "feel": "No training today. Movement only - a walk, light stretching, whatever feels comfortable.",
        "modifier_if_body_low": None,
    },
}


def get_nutrition_level(score: int) -> str:
    if score <= 2:
        return "low"
    if score == 3:
        return "neutral"
    return "high"
