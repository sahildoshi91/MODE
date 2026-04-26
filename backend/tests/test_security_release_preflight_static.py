import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "security_release_preflight.py"


def test_security_release_preflight_script_exists() -> None:
    assert SCRIPT_PATH.exists(), "Expected security_release_preflight.py to exist"


def test_security_release_preflight_contains_required_guards() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY" in source
    assert "rate_limit_backend must be postgres in production" in source
    assert "Plaintext AsyncStorage session persistence" in source
    assert "SUPABASE_SERVICE_ROLE_KEY is required server-side in production" in source


def test_security_release_preflight_development_mode_runs() -> None:
    env = {
        **os.environ,
        "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY", "test-openai-key"),
        "SUPABASE_URL": os.environ.get("SUPABASE_URL", "https://example.supabase.co"),
        "SUPABASE_ANON_KEY": os.environ.get("SUPABASE_ANON_KEY", "test-anon-key"),
        "SUPABASE_SERVICE_ROLE_KEY": os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key"),
    }
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--env", "development"],
        cwd=REPO_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
