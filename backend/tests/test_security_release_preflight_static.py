import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "security_release_preflight.py"
WORKFLOW_PATH = REPO_ROOT.parent / ".github" / "workflows" / "security-release-gates.yml"


def test_security_release_preflight_script_exists() -> None:
    assert SCRIPT_PATH.exists(), "Expected security_release_preflight.py to exist"


def test_security_release_preflight_contains_required_guards() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY" in source
    assert "rate_limit_backend must be redis in production" in source
    assert "REDIS_URL is required when rate_limit_backend is redis in production" in source
    assert "Plaintext AsyncStorage session persistence" in source
    assert "SUPABASE_SERVICE_ROLE_KEY is required server-side in production" in source
    assert "APP_ENV is required and must be set to production" in source
    assert "account_deletion_contract_enforced must be true in production" in source
    assert "personal_data_inventory_path must be configured in production" in source


def test_ci_workflow_sets_auth_password_proxy_enabled_for_regression_step() -> None:
    assert WORKFLOW_PATH.exists(), "Expected security-release-gates.yml to exist"
    source = WORKFLOW_PATH.read_text(encoding="utf-8")
    assert 'AUTH_PASSWORD_PROXY_ENABLED: "true"' in source, (
        "security-release-gates.yml must set AUTH_PASSWORD_PROXY_ENABLED: \"true\" "
        "on the regression gate step so the production preflight passes in CI"
    )


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
