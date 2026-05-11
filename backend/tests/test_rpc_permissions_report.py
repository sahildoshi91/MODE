import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "generate_rpc_permissions_report.py"
REPORT_PATH = REPO_ROOT / "security" / "rpc_permissions_report.json"


def test_rpc_permissions_report_script_exists() -> None:
    assert SCRIPT_PATH.exists(), "Expected generate_rpc_permissions_report.py to exist"


def test_rpc_permissions_report_file_exists_and_is_safe() -> None:
    assert REPORT_PATH.exists(), "Expected checked-in RPC permissions report file"
    payload = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    assert payload.get("ok") is True
    rows = {row["function_name"]: row for row in payload.get("rows", [])}
    assert rows["assign_client_to_trainer"]["grants_to"] == ["service_role"]
    assert rows["bootstrap_trainer_tenant"]["grants_to"] == ["service_role"]
    assert rows["security_enforce_rate_limit"]["grants_to"] == ["service_role"]
    assert rows["security_assert_rls_enabled"]["grants_to"] == ["service_role"]
    assert "authenticated" in rows["auth_is_trainer_user"]["grants_to"]


def test_rpc_permissions_report_check_command_passes() -> None:
    env = {
        **os.environ,
        "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY", "test-openai-key"),
        "SUPABASE_URL": os.environ.get("SUPABASE_URL", "https://example.supabase.co"),
        "SUPABASE_ANON_KEY": os.environ.get("SUPABASE_ANON_KEY", "test-anon-key"),
        "SUPABASE_SERVICE_ROLE_KEY": os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key"),
    }
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--check"],
        cwd=REPO_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
