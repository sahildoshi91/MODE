import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from app.ai.client import OpenAIClient, _run_with_retries, clear_cached_provider_clients, get_cached_openai_client
from app.core.config import settings


class FakeOpenAIResponse:
    def __init__(self, content):
        self.choices = [SimpleNamespace(message=SimpleNamespace(content=content))]
        self.usage = SimpleNamespace(
            prompt_tokens=11,
            completion_tokens=7,
            total_tokens=18,
        )


class OpenAIClientTests(unittest.TestCase):
    def tearDown(self):
        clear_cached_provider_clients()

    def test_cached_openai_client_reuses_process_instance(self):
        clear_cached_provider_clients()
        fake_client = object()

        with patch("app.ai.client.OpenAIClient", return_value=fake_client) as openai_client_cls:
            first = get_cached_openai_client()
            second = get_cached_openai_client()

        self.assertIs(first, fake_client)
        self.assertIs(second, fake_client)
        openai_client_cls.assert_called_once()

    def test_create_chat_completion_uses_supported_sdk_client(self):
        fake_response = FakeOpenAIResponse('{"title":"Builder"}')
        create_mock = unittest.mock.Mock(return_value=fake_response)
        fake_sdk_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=create_mock),
            )
        )

        with patch("app.ai.client.OpenAI", return_value=fake_sdk_client) as openai_cls:
            client = OpenAIClient()
            completion = client.create_chat_completion_with_usage(
                model="gpt-5.4-mini",
                messages=[{"role": "user", "content": "Return JSON"}],
            )

        openai_cls.assert_called_once()
        create_mock.assert_called_once_with(
            model="gpt-5.4-mini",
            messages=[{"role": "user", "content": "Return JSON"}],
            response_format={"type": "json_object"},
        )
        self.assertEqual(completion.text, '{"title":"Builder"}')
        self.assertEqual(completion.token_usage.total_tokens, 18)

    def test_create_chat_completion_normalizes_text_content_blocks(self):
        fake_response = FakeOpenAIResponse(
            [
                {"type": "text", "text": '{"title":"'},
                SimpleNamespace(type="text", text="Builder"),
                SimpleNamespace(type="text", text=SimpleNamespace(value='"}')),
            ]
        )
        fake_sdk_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=unittest.mock.Mock(return_value=fake_response)),
            )
        )

        with patch("app.ai.client.OpenAI", return_value=fake_sdk_client):
            client = OpenAIClient()
            text = client.create_chat_completion(
                model="gpt-5.4-mini",
                messages=[{"role": "user", "content": "Return JSON"}],
            )

        self.assertEqual(text, '{"title":"Builder"}')

    def test_openai_client_uses_chat_provider_timeout_setting(self):
        original_timeout = settings.chat_provider_timeout_seconds
        settings.chat_provider_timeout_seconds = 12.5
        fake_sdk_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=unittest.mock.Mock()),
            )
        )
        try:
            with patch("app.ai.client.OpenAI", return_value=fake_sdk_client) as openai_cls:
                OpenAIClient()
        finally:
            settings.chat_provider_timeout_seconds = original_timeout

        openai_cls.assert_called_once_with(api_key=settings.openai_api_key, timeout=12.5)

    def test_provider_disabled_prevents_openai_request(self):
        original_enabled = settings.llm_provider_enabled
        settings.llm_provider_enabled = False
        create_mock = unittest.mock.Mock(return_value=FakeOpenAIResponse("{}"))
        fake_sdk_client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=create_mock),
            )
        )
        try:
            with patch("app.ai.client.OpenAI", return_value=fake_sdk_client):
                client = OpenAIClient()
                with self.assertRaisesRegex(RuntimeError, "llm_provider_disabled"):
                    client.create_chat_completion_with_usage(
                        model="gpt-5.4-mini",
                        messages=[{"role": "user", "content": "Return JSON"}],
                    )
        finally:
            settings.llm_provider_enabled = original_enabled

        create_mock.assert_not_called()

    def test_run_with_retries_retries_timeout_once(self):
        original_max_retries = settings.ai_max_retries
        settings.ai_max_retries = 2
        calls = []

        def flaky_call():
            calls.append("call")
            if len(calls) == 1:
                raise TimeoutError("provider timed out")
            return "ok"

        try:
            result = _run_with_retries("test", "model", flaky_call)
        finally:
            settings.ai_max_retries = original_max_retries

        self.assertEqual(result, "ok")
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
