import openai
import json
import logging
from typing import Dict, Any
from app.core.config import settings
from app.ai.prompt_builder import build_workout_prompt
from app.ai.response_parser import parse_workout_response
from app.ai.cache import workout_cache


logger = logging.getLogger(__name__)


def generate_workout_with_ai(duration: int, workout_type: str, fitness_level: str, equipment: list, goals: list, injuries: list, user_id: str) -> Dict[str, Any]:
    # Check cache first
    cached = workout_cache.get(user_id, duration, workout_type, fitness_level, equipment, goals, injuries)
    if cached:
        logger.info("Using cached workout")
        return cached

    prompt = build_workout_prompt(duration, workout_type, fitness_level, equipment, goals, injuries)
    
    try:
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            api_key=settings.openai_api_key
        )
        content = response.choices[0].message.content
        logger.info(f"AI response: {content}")
        data = parse_workout_response(content)
        
        # Cache the result
        workout_cache.set(user_id, duration, workout_type, fitness_level, equipment, goals, injuries, data)
        
        return data
    except Exception as e:
        logger.error(f"AI generation failed: {e}")
        raise ValueError("Failed to generate workout")