import logging
import threading
from typing import Dict, Any

from app.ai.client import OpenAIClient
from app.ai.prompt_builder import build_workout_prompt
from app.ai.response_parser import parse_workout_response
from app.ai.router import AIRequestRouter
from app.ai.cache import workout_cache


logger = logging.getLogger(__name__)
router = AIRequestRouter()

_llm_client: OpenAIClient | None = None
_llm_client_lock = threading.Lock()


def _get_llm_client() -> OpenAIClient:
    global _llm_client
    if _llm_client is None:
        with _llm_client_lock:
            if _llm_client is None:
                _llm_client = OpenAIClient()
    return _llm_client


def generate_workout_with_ai(duration: int, workout_type: str, fitness_level: str, equipment: list, goals: list, injuries: list, user_id: str) -> Dict[str, Any]:
    # Check cache first
    cached = workout_cache.get(user_id, duration, workout_type, fitness_level, equipment, goals, injuries)
    if cached:
        logger.info("Using cached workout")
        return cached

    prompt = build_workout_prompt(duration, workout_type, fitness_level, equipment, goals, injuries)
    _, model_tier = router.route_workout_generation(duration, goals, injuries)
    model_name = router.resolve_model_name(model_tier)

    try:
        content = _get_llm_client().create_chat_completion(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
        )
        logger.info("AI response generated with model=%s", model_name)
        data = parse_workout_response(content)
        
        # Cache the result
        workout_cache.set(user_id, duration, workout_type, fitness_level, equipment, goals, injuries, data)
        
        return data
    except Exception as e:
        logger.error(f"AI generation failed: {e}")
        raise ValueError("Failed to generate workout")
