import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "release_security_runner.py"
WRAPPER_PATH = REPO_ROOT / "scripts" / "release_security.sh"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
PRODUCTION_ENV_SCHEMA = REPO_ROOT / "backend" / "security" / "production_env_schema.json"


def test_release_security_runner_scripts_exist() -> None:
    assert SCRIPT_PATH.exists(), "Expected scripts/release_security_runner.py"
    assert WRAPPER_PATH.exists(), "Expected scripts/release_security.sh"


def test_release_security_runner_contains_required_output_contract() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "MODE Release Security Gate Results" in source
    assert "GO — READY FOR APP STORE SUBMISSION" in source
    assert "NO-GO — BLOCKED" in source
    assert "--local" in source
    assert "--only" in source
    assert "security_artifacts" in source


def test_release_workflows_do_not_pin_postgres_rate_limit_backend() -> None:
    workflow_paths = sorted(WORKFLOWS_DIR.glob("*.yml"))
    assert workflow_paths, "Expected GitHub workflow files to exist"
    offenders = [
        path.relative_to(REPO_ROOT).as_posix()
        for path in workflow_paths
        if "RATE_LIMIT_BACKEND: postgres" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_production_env_schema_requires_redis_rate_limit_backend() -> None:
    payload = json.loads(PRODUCTION_ENV_SCHEMA.read_text(encoding="utf-8"))
    required_env_vars = payload.get("required_env_vars")
    assert isinstance(required_env_vars, list)
    by_name = {
        str(row.get("name")): row
        for row in required_env_vars
        if isinstance(row, dict) and row.get("name")
    }
    assert by_name["RATE_LIMIT_BACKEND"]["allowed_values"] == ["redis"]
    assert "rate_limit_backend=redis" in payload.get("required_backend_settings", [])


def test_release_security_runner_help_lists_required_flags() -> None:
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--help"],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0
    assert "--local" in completed.stdout
    assert "--only" in completed.stdout
    assert "--env-file" in completed.stdout
    assert "--ipa" in completed.stdout
    assert "--info-plist" in completed.stdout


def test_release_security_runner_release_mode_without_ipa_is_no_go() -> None:
    env = dict(os.environ)
    env.pop("MODE_IOS_IPA_PATH", None)
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--only", "ios-artifact"],
        cwd=REPO_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 1
    assert "MODE Release Security Gate Results" in completed.stdout
    assert "| iOS artifact scan | FAIL |" in completed.stdout
    assert "NO-GO — BLOCKED" in completed.stdout
    assert "npm run release:security -- --only ios-artifact" in completed.stdout


def test_release_security_runner_local_mode_without_ipa_is_warning_only_go() -> None:
    env = dict(os.environ)
    env.pop("MODE_IOS_IPA_PATH", None)
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--local", "--only", "ios-artifact"],
        cwd=REPO_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0
    assert "MODE Release Security Gate Results" in completed.stdout
    assert "| iOS artifact scan | PASS |" in completed.stdout
    assert "LOCAL MODE: no IPA provided, iOS artifact scan treated as warning-only" in completed.stdout
    assert "GO — READY FOR APP STORE SUBMISSION" in completed.stdout


def test_release_security_runner_fails_with_clear_message_for_missing_env_file() -> None:
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--only", "environment", "--env-file", ".env.this-file-does-not-exist"],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 1
    assert "Failed to load --env-file" in completed.stdout
    assert "NO-GO — BLOCKED" in completed.stdout


def test_release_security_runner_prints_grouped_missing_env_sections_on_no_go() -> None:
    env = {
        "PATH": os.environ.get("PATH", ""),
    }
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--only", "environment"],
        cwd=REPO_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 1
    assert "Missing env vars/secrets by category:" in completed.stdout
    assert "App runtime:" in completed.stdout
    assert "Supabase server/security config:" in completed.stdout
    assert "Supabase public client config:" in completed.stdout
    assert "Exact fix:" in completed.stdout
    assert ".env.release.example" in completed.stdout


def test_release_security_runner_preflight_only_command_supports_env_file() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        env_path = Path(tmpdir) / ".env.release"
        env_path.write_text(
            "\n".join(
                [
                    "# comment",
                    'APP_ENV="production"',
                    "SUPABASE_URL='https://example.supabase.co'",
                    "SUPABASE_ANON_KEY=test-anon",
                    "SUPABASE_SERVICE_ROLE_KEY=test-service",
                    "MODE_SECURITY_DATABASE_URL=postgresql://example-user:example-pass@example-host:5432/postgres",
                    "EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co",
                    "EXPO_PUBLIC_API_BASE_URL=https://api.example.com",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        env = {"PATH": os.environ.get("PATH", "")}
        completed = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                "--local",
                "--only",
                "environment",
                "--env-file",
                str(env_path),
            ],
            cwd=REPO_ROOT,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
    assert completed.returncode == 0
    assert "Loaded env file:" in completed.stdout
    assert "| Environment validation | PASS |" in completed.stdout
