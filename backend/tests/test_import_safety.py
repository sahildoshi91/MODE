from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path

_BACKEND_DIR = str(Path(__file__).resolve().parents[1])


def _env_without_openai() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k != "OPENAI_API_KEY"}
    env.setdefault("SUPABASE_URL", "https://example.supabase.co")
    env.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
    env.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
    return env


class ImportSafetyTests(unittest.TestCase):
    def test_workout_generator_imports_without_openai_key(self):
        result = subprocess.run(
            [sys.executable, "-c", "import app.ai.workout_generator"],
            env=_env_without_openai(),
            capture_output=True,
            text=True,
            cwd=_BACKEND_DIR,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_app_main_imports_without_openai_key(self):
        result = subprocess.run(
            [sys.executable, "-c", "import app.main"],
            env=_env_without_openai(),
            capture_output=True,
            text=True,
            cwd=_BACKEND_DIR,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
