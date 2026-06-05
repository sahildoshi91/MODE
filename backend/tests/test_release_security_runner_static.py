import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "release_security_runner.py"
ARTIFACTS_ROOT = REPO_ROOT / "security_artifacts" / "release"


def _import_runner():
    spec = importlib.util.spec_from_file_location("release_security_runner", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    # Must register before exec_module so @dataclass can resolve the module namespace
    sys.modules["release_security_runner"] = module
    spec.loader.exec_module(module)
    return module
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
        env_path = Path(tmpdir) / ".env.staging"
        env_path.write_text(
            "\n".join(
                [
                    "# comment",
                    'APP_ENV="staging"',
                    "SUPABASE_URL='https://example.supabase.co'",
                    "SUPABASE_ANON_KEY=test-anon",
                    "SUPABASE_SERVICE_ROLE_KEY=test-service",
                    "MODE_SECURITY_DATABASE_URL=postgresql://example-user:example-pass@example-host:5432/postgres",
                    "EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co",
                    "EXPO_PUBLIC_API_BASE_URL=https://mode-backend-staging.onrender.com",
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


def test_local_mode_accepts_staging_app_env() -> None:
    env = {
        "PATH": os.environ.get("PATH", ""),
        "APP_ENV": "staging",
        "EXPO_PUBLIC_API_BASE_URL": "https://mode-backend-staging.onrender.com",
    }
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--local", "--only", "environment"],
        cwd=REPO_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    assert "| Environment validation | PASS |" in completed.stdout, completed.stdout


def test_local_mode_rejects_fabricated_staging_api_url() -> None:
    env = {
        "PATH": os.environ.get("PATH", ""),
        "APP_ENV": "staging",
        "EXPO_PUBLIC_API_BASE_URL": "https://my-staging-clone.example.com",
    }
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--local", "--only", "environment"],
        cwd=REPO_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 1
    assert "EXPO_PUBLIC_API_BASE_URL in local mode must be https://mode-backend-staging.onrender.com" in completed.stdout


def test_release_mode_rejects_staging_app_env() -> None:
    env = {
        "PATH": os.environ.get("PATH", ""),
        "APP_ENV": "staging",
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
    assert "APP_ENV must be production" in completed.stdout


def test_redact_db_url_strips_password() -> None:
    runner = _import_runner()
    redact = runner._redact_db_url
    assert redact("postgresql://user:supersecret@host:5432/db") == "postgresql://user:***@host:5432/db"
    assert redact("postgres://user:p%40ss@host:5432/db") == "postgres://user:***@host:5432/db"
    assert redact("cmd --flag postgresql://user:secret@host:5432/db end") == "cmd --flag postgresql://user:***@host:5432/db end"
    assert redact("POSTGRESQL://User:S3cr3t@HOST:6543/postgres") == "POSTGRESQL://User:***@HOST:6543/postgres"
    assert redact("no url here") == "no url here"
    assert redact("") == ""
    # Multiple URLs in one string
    assert redact(
        "postgresql://a:pass1@host1:5432/db and postgres://b:pass2@host2:5432/db"
    ) == "postgresql://a:***@host1:5432/db and postgres://b:***@host2:5432/db"


def test_db_credentials_absent_from_runner_artifacts() -> None:
    """Raw DB passwords must not appear in any runner output or artifact."""
    raw_password = "xXxTEST_SECRET_PASS_xXx"
    fake_db_url = f"postgresql://postgres.testref:{raw_password}@aws-east.pooler.supabase.com:6543/postgres"

    env = {
        "PATH": os.environ.get("PATH", ""),
        "APP_ENV": "staging",
        "MODE_SECURITY_DATABASE_URL": fake_db_url,
    }

    before: set[Path] = set(ARTIFACTS_ROOT.glob("*")) if ARTIFACTS_ROOT.exists() else set()

    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--local", "--only", "gdpr"],
        env=env,
        check=False,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )

    after: set[Path] = set(ARTIFACTS_ROOT.glob("*")) if ARTIFACTS_ROOT.exists() else set()
    new_dirs = after - before

    assert raw_password not in completed.stdout, "Raw password found in runner stdout"
    assert raw_password not in completed.stderr, "Raw password found in runner stderr"

    for artifact_dir in new_dirs:
        for filename in ("summary.json", "matrix.md", "console_output.txt", "gate_gdpr.log"):
            path = artifact_dir / filename
            if path.exists():
                content = path.read_text(encoding="utf-8")
                assert raw_password not in content, f"Raw password found in {path.name}"
