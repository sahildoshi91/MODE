import json
from typing import Dict, Any

from app.ai.parsers.workout import validate_workout_payload


def parse_workout_response(response: str) -> Dict[str, Any]:
    try:
        data = json.loads(response)
        return validate_workout_payload(data)
    except json.JSONDecodeError:
        raise ValueError("AI response is not valid JSON")
