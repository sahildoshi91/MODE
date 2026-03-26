import logging
import os
from dataclasses import dataclass
from typing import Iterator

try:
    from google import genai
    from google.genai import types
except ImportError:  # pragma: no cover - exercised in runtime environments missing the SDK.
    genai = None
    types = None

try:
    import anthropic
except ImportError:  # pragma: no cover - exercised in runtime environments missing the SDK.
    anthropic = None

import openai

from app.core.config import settings


logger = logging.getLogger(__name__)
GEMINI_MODEL = "gemini-2.5-flash"
GPT_5_4_MINI_MODEL = "gpt-5.4-mini"
ANTHROPIC_SONNET_MODEL = "claude-sonnet-4-20250514"


@dataclass
class TokenUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    thoughts_tokens: int = 0


@dataclass
class GeminiCompletion:
    text: str
    token_usage: TokenUsage


@dataclass
class TextCompletion:
    text: str
    token_usage: TokenUsage


class OpenAIClient:
    def create_chat_completion(self, model: str, messages: list[dict[str, str]]) -> str:
        return self.create_chat_completion_with_usage(model=model, messages=messages).text

    def create_chat_completion_with_usage(self, model: str, messages: list[dict[str, str]]) -> TextCompletion:
        response = openai.ChatCompletion.create(
            model=model,
            messages=messages,
            api_key=settings.openai_api_key,
        )
        content = response.choices[0].message.content
        logger.info("OpenAI response received for model=%s", model)
        usage = getattr(response, "usage", None)
        return TextCompletion(
            text=content,
            token_usage=TokenUsage(
                prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
                total_tokens=getattr(usage, "total_tokens", 0) or 0,
                thoughts_tokens=0,
            ),
        )


class AnthropicClient:
    def __init__(self) -> None:
        if anthropic is None:
            raise RuntimeError("anthropic is not installed. Run `pip install anthropic` in the backend environment.")

        api_key = os.environ.get("ANTHROPIC_API_KEY") or settings.anthropic_api_key
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")

        self.client = anthropic.Anthropic(api_key=api_key)

    def create_chat_completion(self, model: str, system_prompt: str, user_prompt: str) -> TextCompletion:
        response = self.client.messages.create(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text_parts = []
        for block in getattr(response, "content", []) or []:
            if getattr(block, "type", None) == "text" and getattr(block, "text", None):
                text_parts.append(block.text)

        usage = getattr(response, "usage", None)
        input_tokens = getattr(usage, "input_tokens", 0) or 0
        output_tokens = getattr(usage, "output_tokens", 0) or 0
        return TextCompletion(
            text="".join(text_parts).strip(),
            token_usage=TokenUsage(
                prompt_tokens=input_tokens,
                completion_tokens=output_tokens,
                total_tokens=input_tokens + output_tokens,
                thoughts_tokens=0,
            ),
        )

    def stream_chat_completion(self, model: str, system_prompt: str, user_prompt: str) -> Iterator[str]:
        with self.client.messages.stream(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            for text in stream.text_stream:
                if text:
                    yield text


class GeminiClient:
    def __init__(self) -> None:
        if genai is None or types is None:
            raise RuntimeError(
                "google-genai is not installed. Run `pip install google-genai` in the backend environment."
            )

        api_key = os.environ.get("GEMINI_API_KEY") or settings.gemini_api_key
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")

        self.client = genai.Client(api_key=api_key)

    def stream_chat_completion(self, prompt: str) -> Iterator[str]:
        stream = self.client.models.generate_content_stream(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )

        for chunk in stream:
            text = getattr(chunk, "text", None)
            if text:
                yield text

    def create_chat_completion(self, prompt: str) -> GeminiCompletion:
        response = self.client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        usage = getattr(response, "usage_metadata", None)
        return GeminiCompletion(
            text=(getattr(response, "text", "") or "").strip(),
            token_usage=TokenUsage(
                prompt_tokens=getattr(usage, "prompt_token_count", 0) or 0,
                completion_tokens=getattr(usage, "candidates_token_count", 0) or 0,
                total_tokens=getattr(usage, "total_token_count", 0) or 0,
                thoughts_tokens=getattr(usage, "thoughts_token_count", 0) or 0,
            ),
        )
