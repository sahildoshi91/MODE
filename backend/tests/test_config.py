import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from app.core.config import Settings


class SettingsTests(unittest.TestCase):
    def test_ai_timeout_and_retry_defaults_are_defined(self):
        settings = Settings()

        self.assertEqual(settings.ai_request_timeout_seconds, 30.0)
        self.assertEqual(settings.ai_max_retries, 2)
        self.assertEqual(settings.max_active_chat_streams_per_instance, 25)
        self.assertTrue(settings.chat_enabled)
        self.assertTrue(settings.streaming_enabled)
        self.assertTrue(settings.llm_provider_enabled)
        self.assertTrue(settings.memory_writes_enabled)
        self.assertEqual(settings.chat_provider_timeout_seconds, 30.0)
        self.assertEqual(settings.chat_max_output_tokens, 0)
        self.assertEqual(settings.global_chat_rate_limit, 0)
        self.assertEqual(settings.per_user_chat_rate_limit, 0)

    def test_launch_chat_controls_read_from_uppercase_env(self):
        with patch.dict(
            os.environ,
            {
                "CHAT_ENABLED": "false",
                "STREAMING_ENABLED": "false",
                "LLM_PROVIDER_ENABLED": "false",
                "MEMORY_WRITES_ENABLED": "false",
                "CHAT_PROVIDER_TIMEOUT_SECONDS": "7.5",
                "CHAT_MAX_OUTPUT_TOKENS": "512",
                "GLOBAL_CHAT_RATE_LIMIT": "100",
                "PER_USER_CHAT_RATE_LIMIT": "4",
            },
            clear=False,
        ):
            settings = Settings()

        self.assertFalse(settings.chat_enabled)
        self.assertFalse(settings.streaming_enabled)
        self.assertFalse(settings.llm_provider_enabled)
        self.assertFalse(settings.memory_writes_enabled)
        self.assertEqual(settings.chat_provider_timeout_seconds, 7.5)
        self.assertEqual(settings.chat_max_output_tokens, 512)
        self.assertEqual(settings.global_chat_rate_limit, 100)
        self.assertEqual(settings.per_user_chat_rate_limit, 4)


if __name__ == "__main__":
    unittest.main()
