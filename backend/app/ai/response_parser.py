import json
from typing import Dict, Any


def parse_workout_response(response: str) -> Dict[str, Any]:
    try:
        data = json.loads(response)
        # Basic validation
        if "exercises" not in data:
            raise ValueError("Invalid response format")
        return data
    except json.JSONDecodeError:
        raise ValueError("AI response is not valid JSON")