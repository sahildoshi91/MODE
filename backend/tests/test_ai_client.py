import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from app.ai.client import OpenAIClient


class FakeOpenAIResponse:
    def __init__(self, content):
        self.choices = [SimpleNamespace(message=SimpleNamespace(content=content))]
        self.usage = SimpleNamespace(
            prompt_tokens=11,
            completion_tokens=7,
            total_tokens=18,
        )


class OpenAIClientTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
