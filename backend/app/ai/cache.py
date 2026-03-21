import json
from typing import Dict, Any, Optional
import hashlib
import time

# Simple in-memory cache (for production, use Redis)
class WorkoutCache:
    def __init__(self):
        self.cache = {}
        self.ttl = 3600  # 1 hour

    def _get_key(self, user_id: str, duration: int, workout_type: str, fitness_level: str, equipment: list, goals: list, injuries: list) -> str:
        data = f"{user_id}-{duration}-{workout_type}-{fitness_level}-{','.join(sorted(equipment))}-{','.join(sorted(goals))}-{','.join(sorted(injuries))}"
        return hashlib.md5(data.encode()).hexdigest()

    def get(self, user_id: str, duration: int, workout_type: str, fitness_level: str, equipment: list, goals: list, injuries: list) -> Optional[Dict[str, Any]]:
        key = self._get_key(user_id, duration, workout_type, fitness_level, equipment, goals, injuries)
        if key in self.cache:
            entry = self.cache[key]
            if time.time() - entry['timestamp'] < self.ttl:
                return entry['data']
            else:
                del self.cache[key]
        return None

    def set(self, user_id: str, duration: int, workout_type: str, fitness_level: str, equipment: list, goals: list, injuries: list, data: Dict[str, Any]) -> None:
        key = self._get_key(user_id, duration, workout_type, fitness_level, equipment, goals, injuries)
        self.cache[key] = {
            'data': data,
            'timestamp': time.time()
        }

workout_cache = WorkoutCache()