import logging
import os
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Iterator

from app.core.config import settings


logger = logging.getLogger(__name__)
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_FLASH_LITE_MODEL = "gemini-2.5-flash-lite"
GPT_5_4_MINI_MODEL = "gpt-5.4-mini"
ANTHROPIC_SONNET_MODEL = "claude-sonnet-4-20250514"

OpenAI = None
anthropic = None
genai = None
types = None


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


def _load_openai_class() -> Any:
    global OpenAI
    if OpenAI is None:
        from openai import OpenAI as OpenAIClass

        OpenAI = OpenAIClass
    return OpenAI


def _load_anthropic_module() -> Any:
    global anthropic
    if anthropic is None:
        import anthropic as anthropic_module

        anthropic = anthropic_module
    return anthropic


def _load_gemini_modules() -> tuple[Any, Any]:
    global genai, types
    if genai is None or types is None:
        from google import genai as genai_module
        from google.genai import types as types_module

        genai = genai_module
        types = types_module
    return genai, types


def _run_with_retries(provider: str, model: str, fn):
    attempts = max(int(settings.ai_max_retries or 1), 1)
    for attempt in range(1, attempts + 1):
        started_at = time.perf_counter()
        try:
            result = fn()
            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            logger.info(
                "provider.complete provider=%s model=%s attempt=%s duration_ms=%s",
                provider,
                model,
                attempt,
                duration_ms,
            )
            return result
        except Exception:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            logger.exception(
                "provider.error provider=%s model=%s attempt=%s duration_ms=%s",
                provider,
                model,
                attempt,
                duration_ms,
            )
            if attempt >= attempts:
                raise


class OpenAIClient:
    def __init__(self) -> None:
        openai_class = _load_openai_class()
        self.client = openai_class(
            api_key=settings.openai_api_key,
            timeout=settings.ai_request_timeout_seconds,
        )

    def create_chat_completion(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        max_output_tokens: int | None = None,
    ) -> str:
        return self.create_chat_completion_with_usage(
            model=model,
            messages=messages,
            max_output_tokens=max_output_tokens,
        ).text

    def create_chat_completion_with_usage(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        max_output_tokens: int | None = None,
    ) -> TextCompletion:
        request_payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "response_format": {"type": "json_object"},
        }
        if max_output_tokens:
            request_payload["max_completion_tokens"] = max_output_tokens
        response = _run_with_retries(
            "openai",
            model,
            lambda: self.client.chat.completions.create(**request_payload),
        )
        content = self._normalize_message_content(response.choices[0].message.content)
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

    def stream_chat_completion(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        max_output_tokens: int | None = None,
    ) -> Iterator[str]:
        request_payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
        }
        if max_output_tokens:
            request_payload["max_completion_tokens"] = max_output_tokens
        stream = _run_with_retries(
            "openai",
            model,
            lambda: self.client.chat.completions.create(**request_payload),
        )
        try:
            for chunk in stream:
                choices = getattr(chunk, "choices", None) or []
                if not choices:
                    continue
                delta = getattr(choices[0], "delta", None)
                content = getattr(delta, "content", None) if delta is not None else None
                if content:
                    yield str(content)
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                close()

    def _normalize_message_content(self, content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            text_parts: list[str] = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text" and block.get("text"):
                        text_parts.append(str(block["text"]))
                    continue
                if getattr(block, "type", None) == "text":
                    text_value = getattr(block, "text", None)
                    if isinstance(text_value, str):
                        text_parts.append(text_value)
                    elif text_value is not None and getattr(text_value, "value", None):
                        text_parts.append(str(text_value.value))
            return "".join(text_parts).strip()
        if content is None:
            return ""
        return str(content).strip()


class AnthropicClient:
    def __init__(self) -> None:
        try:
            anthropic_module = _load_anthropic_module()
        except ImportError as exc:
            raise RuntimeError(
                "anthropic is not installed. Run `pip install anthropic` in the backend environment."
            ) from exc

        api_key = os.environ.get("ANTHROPIC_API_KEY") or settings.anthropic_api_key
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")

        self.client = anthropic_module.Anthropic(api_key=api_key)

    def create_chat_completion(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        *,
        max_output_tokens: int | None = None,
    ) -> TextCompletion:
        response = _run_with_retries(
            "anthropic",
            model,
            lambda: self.client.messages.create(
                model=model,
                max_tokens=max_output_tokens or 1024,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            ),
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

    def stream_chat_completion(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        *,
        max_output_tokens: int | None = None,
    ) -> Iterator[str]:
        stream_context = _run_with_retries(
            "anthropic",
            model,
            lambda: self.client.messages.stream(
                model=model,
                max_tokens=max_output_tokens or 1024,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            ),
        )
        with stream_context as stream:
            for text in stream.text_stream:
                if text:
                    yield text


class GeminiClient:
    def __init__(self) -> None:
        try:
            genai_module, types_module = _load_gemini_modules()
        except ImportError as exc:
            raise RuntimeError(
                "google-genai is not installed. Run `pip install google-genai` in the backend environment."
            ) from exc

        api_key = os.environ.get("GEMINI_API_KEY") or settings.gemini_api_key
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")

        self._types = types_module
        self.client = genai_module.Client(api_key=api_key)

    def stream_chat_completion(
        self,
        prompt: str,
        *,
        model: str = GEMINI_MODEL,
        max_output_tokens: int | None = None,
    ) -> Iterator[str]:
        config_kwargs: dict[str, Any] = {
            "thinking_config": self._types.ThinkingConfig(thinking_budget=0),
        }
        if max_output_tokens:
            config_kwargs["max_output_tokens"] = max_output_tokens
        stream = _run_with_retries(
            "gemini",
            model,
            lambda: self.client.models.generate_content_stream(
                model=model,
                contents=prompt,
                config=self._types.GenerateContentConfig(**config_kwargs),
            ),
        )

        for chunk in stream:
            text = getattr(chunk, "text", None)
            if text:
                yield text

    def create_chat_completion(
        self,
        prompt: str,
        *,
        model: str = GEMINI_MODEL,
        max_output_tokens: int | None = None,
    ) -> GeminiCompletion:
        config_kwargs: dict[str, Any] = {
            "thinking_config": self._types.ThinkingConfig(thinking_budget=0),
        }
        if max_output_tokens:
            config_kwargs["max_output_tokens"] = max_output_tokens
        response = _run_with_retries(
            "gemini",
            model,
            lambda: self.client.models.generate_content(
                model=model,
                contents=prompt,
                config=self._types.GenerateContentConfig(**config_kwargs),
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


@lru_cache(maxsize=1)
def get_cached_openai_client() -> OpenAIClient:
    return OpenAIClient()


@lru_cache(maxsize=1)
def get_cached_anthropic_client() -> AnthropicClient:
    return AnthropicClient()


@lru_cache(maxsize=1)
def get_cached_gemini_client() -> GeminiClient:
    return GeminiClient()


def clear_cached_provider_clients() -> None:
    get_cached_openai_client.cache_clear()
    get_cached_anthropic_client.cache_clear()
    get_cached_gemini_client.cache_clear()
