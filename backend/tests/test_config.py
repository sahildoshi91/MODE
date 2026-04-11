import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from app.core.config import Settings


class SettingsTests(unittest.TestCase):
    def test_ai_timeout_and_retry_defaults_are_defined(self):
        settings = Settings()

        self.assertEqual(settings.ai_request_timeout_seconds, 30.0)
        self.assertEqual(settings.ai_max_retries, 2)


if __name__ == "__main__":
    unittest.main()
