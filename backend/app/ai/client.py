import logging
from typing import Any

import openai

from app.core.config import settings


logger = logging.getLogger(__name__)


class OpenAIClient:
    def create_chat_completion(self, model: str, messages: list[dict[str, str]]) -> str:
        response = openai.ChatCompletion.create(
            model=model,
            messages=messages,
            api_key=settings.openai_api_key,
        )
        content = response.choices[0].message.content
        logger.info("OpenAI response received for model=%s", model)
        return content
