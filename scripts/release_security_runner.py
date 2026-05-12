#!/usr/bin/env python3
"""
Fail-closed MODE release security runner.

Default mode is release. Pass --local for local mode that may skip unavailable live gates.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
SCHEMA_PATH = BACKEND / "security" / "production_env_schema.json"
ARTIFACTS_ROOT = ROOT / "security_artifacts" / "release"
ENV_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

ENV_CATEGORY_GROUPS: list[tuple[str, set[str]]] = [
    (
        "App runtime",
        {
            "APP_ENV",
            "OPENAI_API_KEY",
            "REDIS_URL",
            "RATE_LIMIT_BACKEND",
            "STARTUP_GUARD_ENABLED",
            "AUTH_PASSWORD_PROXY_ENABLED",
            "ACCOUNT_DELETION_ENABLED",
            "ACCOUNT_DELETION_CONTRACT_ENFORCED",
            "PERSONAL_DATA_INVENTORY_PATH",
            "ACCOUNT_DELETION_ACTIVE_SINK_CATEGORIES",
            "ACCOUNT_DELETION_DISABLED_SINK_CATEGORIES",
            "MODE_STORAGE_ORPHAN_THRESHOLD",
            "MODE_STORAGE_CLEANUP_MAX_HEARTBEAT_AGE_MINUTES",
            "MODE_STORAGE_CLEANUP_EXPECTED_INTERVAL_MINUTES",
        },
    ),
    (
        "Supabase public client config",
        {
            "EXPO_PUBLIC_SUPABASE_URL",
            "EXPO_PUBLIC_SUPABASE_ANON_KEY",
            "EXPO_PUBLIC_API_BASE_URL",
            "EXPO_PUBLIC_SUPABASE_REDIRECT_URL",
        },
    ),
    (
        "Supabase server/security config",
        {
            "SUPABASE_URL",
            "SUPABASE_ANON_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
            "MODE_SECURITY_DATABASE_URL",
        },
    ),
    (
        "iOS artifact config",
        {
            "MODE_IOS_IPA_PATH",
            "MODE_IOS_INFO_PLIST_PATH",
        },
    ),
]


@dataclass
class GateResult:
    gate_id: str
    gate_name: str
    status: str = "PASS"
    notes: list[str] = field(default_factory=list)
    commands: list[str] = field(default_factory=list)
    missing_envs: list[str] = field(default_factory=list)
    log_path: Path | None = None

    def fail(self, note: str) -> None:
        self.status = "FAIL"
        self.notes.append(note)


class RunnerContext:
    def __init__(
        self,
        *,
        local_mode: bool,
        only_gate: str | None,
        ipa: str | None,
        info_plist: str | None,
        env_file: str | None,
    ):
        self.local_mode = bool(local_mode)
        self.only_gate = only_gate
        self.ipa = str(ipa or "").strip() or None
        self.info_plist = str(info_plist or "").strip() or None
        self.env_file = str(env_file or "").strip() or None
        self.env_file_resolved: str | None = None
        self.env_file_applied_keys: int = 0
        self.env_file_skipped_keys: int = 0
        self.timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M%S")
        self.artifacts_dir = ARTIFACTS_ROOT / self.timestamp
        self.lines: list[str] = []

        self.backend_python = self._resolve_backend_binary("python")
        self.backend_pytest = self._resolve_backend_binary("pytest")
        self.root_python = shutil.which("python3") or sys.executable

    @staticmethod
    def _resolve_backend_binary(name: str) -> str:
        candidate = BACKEND / "venv" / "bin" / name
        if candidate.exists():
            return str(candidate)
        if name == "python":
            return shutil.which("python3") or sys.executable
        return shutil.which(name) or name

    def print_line(self, message: str) -> None:
        print(message)
        self.lines.append(message)

    def ensure_artifacts_dir(self) -> None:
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)

    def gate_log_path(self, gate_id: str) -> Path:
        return self.artifacts_dir / f"gate_{gate_id}.log"

    def run_command(
        self,
        *,
        result: GateResult,
        cmd: list[str],
        cwd: Path,
        env_overrides: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        command_display = " ".join(shlex.quote(part) for part in cmd)
        result.commands.append(f"cd {cwd} && {command_display}")

        env = os.environ.copy()
        if env_overrides:
            env.update(env_overrides)

        completed = subprocess.run(
            cmd,
            cwd=str(cwd),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

        if result.log_path is not None:
            with result.log_path.open("a", encoding="utf-8") as handle:
                handle.write(f"$ {command_display}\n")
                if env_overrides:
                    safe_overrides = {
                        key: ("***" if any(tok in key.upper() for tok in ("KEY", "TOKEN", "SECRET", "PASSWORD")) else value)
                        for key, value in env_overrides.items()
                    }
                    handle.write(f"env_overrides={json.dumps(safe_overrides, sort_keys=True)}\n")
                handle.write(f"exit_code={completed.returncode}\n")
                handle.write("--- stdout ---\n")
                handle.write(completed.stdout or "")
                handle.write("\n--- stderr ---\n")
                handle.write(completed.stderr or "")
                handle.write("\n\n")

        return completed


def _env(name: str) -> str:
    return str(os.getenv(name) or "").strip()


def _env_int(name: str, default: int) -> int:
    raw = str(os.getenv(name) or "").strip()
    if not raw:
        return int(default)
    return int(raw)


def _has_host_token(value: str, tokens: list[str]) -> bool:
    lowered = str(value or "").strip().lower()
    return any(token and token.lower() in lowered for token in tokens)


def _parse_inventory_json(stdout: str) -> dict | None:
    start = stdout.find("{")
    end = stdout.rfind("}")
    if start < 0 or end <= start:
        return None
    candidate = stdout[start:end + 1]
    try:
        payload = json.loads(candidate)
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _parse_utc_iso(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None


def _run_psql_query(database_url: str, sql: str) -> tuple[int, str, str]:
    completed = subprocess.run(
        [
            "psql",
            database_url,
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
            "-F",
            "\t",
            "-c",
            sql,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return completed.returncode, completed.stdout, completed.stderr


def _parse_env_file_line(*, line: str, line_number: int, path: Path) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None

    if "=" not in line:
        raise ValueError(f"{path}:{line_number}: expected KEY=VALUE format")

    key_part, raw_value = line.split("=", 1)
    key = key_part.strip()
    if not key:
        raise ValueError(f"{path}:{line_number}: missing environment variable name before '='")
    if not ENV_KEY_PATTERN.match(key):
        raise ValueError(f"{path}:{line_number}: invalid environment variable name: {key}")

    value = raw_value.strip()
    if value and value[0] in {"'", '"'}:
        quote = value[0]
        if len(value) < 2 or not value.endswith(quote):
            raise ValueError(f"{path}:{line_number}: unmatched quote for {key}")
        inner = value[1:-1]
        if quote == '"':
            inner = (
                inner
                .replace("\\n", "\n")
                .replace("\\r", "\r")
                .replace("\\t", "\t")
                .replace('\\"', '"')
                .replace("\\\\", "\\")
            )
        else:
            inner = inner.replace("\\'", "'").replace("\\\\", "\\")
        value = inner

    return key, value


def _load_env_file(path_value: str) -> tuple[Path, int, int]:
    candidate = Path(str(path_value).strip()).expanduser()
    resolved = candidate if candidate.is_absolute() else (Path.cwd() / candidate).resolve()
    if not resolved.exists():
        raise ValueError(f"file does not exist: {resolved}")
    if not resolved.is_file():
        raise ValueError(f"path is not a file: {resolved}")

    try:
        source = resolved.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - OS-dependent IO details
        raise ValueError(f"unable to read file: {resolved} ({exc})") from exc

    parsed: dict[str, str] = {}
    for index, raw_line in enumerate(source.splitlines(), start=1):
        maybe = _parse_env_file_line(line=raw_line, line_number=index, path=resolved)
        if maybe is None:
            continue
        key, value = maybe
        if key in parsed:
            raise ValueError(f"{resolved}:{index}: duplicate key: {key}")
        parsed[key] = value

    applied = 0
    skipped = 0
    for key, value in parsed.items():
        existing = os.getenv(key)
        if existing is None or str(existing).strip() == "":
            os.environ[key] = value
            applied += 1
        else:
            skipped += 1

    return resolved, applied, skipped


def _group_missing_envs(missing_names: list[str]) -> list[tuple[str, list[str]]]:
    remaining = set(str(name).strip() for name in missing_names if str(name).strip())
    grouped: list[tuple[str, list[str]]] = []

    for title, keys in ENV_CATEGORY_GROUPS:
        present = sorted(name for name in remaining if name in keys)
        if not present:
            continue
        grouped.append((title, present))
        remaining -= set(present)

    if remaining:
        grouped.append(("Other configuration", sorted(remaining)))

    return grouped


def gate_environment_validation(ctx: RunnerContext, result: GateResult) -> None:
    if not SCHEMA_PATH.exists():
        result.fail(f"Missing environment schema: {SCHEMA_PATH}")
        return

    schema_payload = {}
    try:
        schema_payload = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        result.fail(f"Unable to parse production env schema: {exc}")
        return

    required_specs = schema_payload.get("required_env_vars") if isinstance(schema_payload, dict) else []
    if not isinstance(required_specs, list):
        required_specs = []

    required_env_names = {
        "APP_ENV",
        "MODE_SECURITY_DATABASE_URL",
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
    }
    for row in required_specs:
        if isinstance(row, dict):
            name = str(row.get("name") or "").strip()
            if name:
                required_env_names.add(name)

    if not ctx.local_mode:
        missing = sorted(name for name in required_env_names if not _env(name))
        if missing:
            result.missing_envs.extend(missing)
            result.fail("Missing required environment variables: " + ", ".join(missing))
    else:
        missing_local = sorted(name for name in required_env_names if not _env(name))
        if missing_local:
            result.notes.append(
                "LOCAL MODE: release-only environment variables are missing and treated as warnings: "
                + ", ".join(missing_local)
            )

    app_env = _env("APP_ENV").lower()
    if not ctx.local_mode and app_env not in {"prod", "production"}:
        result.fail("APP_ENV must be production (or prod) in release mode")

    for row in required_specs:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        value = _env(name)
        if not value:
            continue

        if bool(row.get("must_be_https")) and not value.lower().startswith("https://"):
            result.fail(f"{name} must use https")

        tokens = row.get("disallow_host_tokens")
        if isinstance(tokens, list):
            normalized_tokens = [str(token).strip().lower() for token in tokens if str(token).strip()]
            if _has_host_token(value, normalized_tokens):
                result.fail(f"{name} points to staging/local/LAN host token")

        allowed_values = row.get("allowed_values")
        if isinstance(allowed_values, list) and allowed_values:
            normalized_allowed = {str(item).strip().lower() for item in allowed_values if str(item).strip()}
            if normalized_allowed and str(value).strip().lower() not in normalized_allowed:
                result.fail(f"{name} has disallowed value")

    forbidden_client_envs = schema_payload.get("forbidden_client_env_vars") if isinstance(schema_payload, dict) else []
    if isinstance(forbidden_client_envs, list):
        for name in forbidden_client_envs:
            key = str(name or "").strip()
            if key and _env(key):
                result.fail(f"Service-role key leakage: {key} must not be set")

    for key, value in os.environ.items():
        if not str(value or "").strip():
            continue
        key_upper = str(key).strip().upper()
        if key_upper.startswith("EXPO_PUBLIC_") and "SERVICE_ROLE" in key_upper:
            result.fail(f"Service-role key leakage: {key} must never be set in client/mobile env")

    mode_security_database_url = _env("MODE_SECURITY_DATABASE_URL")
    if mode_security_database_url and _has_host_token(
        mode_security_database_url,
        ["staging", "localhost", "127.0.0.1", "192.168.", "10.", "172.16."],
    ):
        result.fail("MODE_SECURITY_DATABASE_URL points to staging/local/LAN host token")

    env_target = "development" if ctx.local_mode else "production"
    completed = ctx.run_command(
        result=result,
        cmd=[ctx.backend_python, "scripts/security_release_preflight.py", "--env", env_target],
        cwd=BACKEND,
    )
    if completed.returncode != 0:
        result.fail(f"security_release_preflight.py failed for --env {env_target}")


def gate_live_db_posture(ctx: RunnerContext, result: GateResult) -> None:
    database_url = _env("MODE_SECURITY_DATABASE_URL")
    if not database_url:
        result.missing_envs.append("MODE_SECURITY_DATABASE_URL")
        if ctx.local_mode:
            result.notes.append("LOCAL MODE: skipped live DB posture check because MODE_SECURITY_DATABASE_URL is unset")
            return
        result.fail("MODE_SECURITY_DATABASE_URL is required for live DB posture checks")
        return

    if not shutil.which("psql"):
        if ctx.local_mode:
            result.notes.append("LOCAL MODE: skipped live DB posture check because psql is not installed")
            return
        result.fail("psql is required for live DB posture checks")
        return

    completed = ctx.run_command(
        result=result,
        cmd=[ctx.backend_python, "scripts/staging_db_security_check.py", "--database-url", database_url],
        cwd=BACKEND,
    )
    if completed.returncode != 0:
        result.fail("staging_db_security_check.py failed")


def gate_cross_tenant_integration(ctx: RunnerContext, result: GateResult) -> None:
    required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
    missing = sorted(name for name in required if not _env(name))
    if missing:
        result.missing_envs.extend(missing)
        if ctx.local_mode:
            result.notes.append(
                "LOCAL MODE: skipped staging integration gate because required Supabase vars are missing: "
                + ", ".join(missing)
            )
            return
        result.fail("Missing required env vars for cross-tenant integration: " + ", ".join(missing))
        return

    completed = ctx.run_command(
        result=result,
        cmd=[
            ctx.backend_pytest,
            "-q",
            "tests/test_staging_db_security_integration.py",
            "tests/test_chat_api_staging_integration.py",
            "tests/test_daily_checkin_staging_integration.py",
            "tests/test_trainer_platform_staging_smoke.py",
            "-rs",
        ],
        cwd=BACKEND,
        env_overrides={"MODE_RUN_STAGING_SUPABASE_TESTS": "1"},
    )
    if completed.returncode != 0:
        result.fail("Staging cross-tenant integration suite failed")


def gate_gdpr_deletion_coverage(ctx: RunnerContext, result: GateResult) -> None:
    static_completed = ctx.run_command(
        result=result,
        cmd=[ctx.backend_python, "scripts/check_personal_data_inventory.py"],
        cwd=BACKEND,
    )
    if static_completed.returncode != 0:
        result.fail("check_personal_data_inventory.py failed in static mode")

    contract_completed = ctx.run_command(
        result=result,
        cmd=[
            ctx.backend_pytest,
            "-q",
            "tests/test_personal_data_inventory_contract.py",
            "tests/test_account_deletion_service.py",
            "-rs",
        ],
        cwd=BACKEND,
    )
    if contract_completed.returncode != 0:
        result.fail("GDPR deletion contract tests failed")

    database_url = _env("MODE_SECURITY_DATABASE_URL")
    if database_url:
        live_completed = ctx.run_command(
            result=result,
            cmd=[
                ctx.backend_python,
                "scripts/check_personal_data_inventory.py",
                "--check-live",
                "--database-url",
                database_url,
            ],
            cwd=BACKEND,
        )
        if live_completed.returncode != 0:
            result.fail("Live inventory parity check failed")
    else:
        result.missing_envs.append("MODE_SECURITY_DATABASE_URL")
        if ctx.local_mode:
            result.notes.append("LOCAL MODE: skipped live inventory parity check because MODE_SECURITY_DATABASE_URL is unset")
        else:
            result.fail("MODE_SECURITY_DATABASE_URL is required for live inventory parity check")


def gate_storage_security(ctx: RunnerContext, result: GateResult) -> None:
    try:
        threshold = _env_int("MODE_STORAGE_ORPHAN_THRESHOLD", 0)
        max_age_minutes = _env_int("MODE_STORAGE_CLEANUP_MAX_HEARTBEAT_AGE_MINUTES", 30)
        expected_interval_minutes = _env_int("MODE_STORAGE_CLEANUP_EXPECTED_INTERVAL_MINUTES", 15)
    except Exception:
        result.fail(
            "MODE_STORAGE_ORPHAN_THRESHOLD, MODE_STORAGE_CLEANUP_MAX_HEARTBEAT_AGE_MINUTES, "
            "and MODE_STORAGE_CLEANUP_EXPECTED_INTERVAL_MINUTES must be integers"
        )
        return

    audit_completed = ctx.run_command(
        result=result,
        cmd=[ctx.root_python, "scripts/storage_access_audit.py"],
        cwd=ROOT,
    )
    if audit_completed.returncode != 0:
        result.fail("storage_access_audit.py failed")

    tests_completed = ctx.run_command(
        result=result,
        cmd=[
            ctx.backend_pytest,
            "-q",
            "tests/test_storage_private_api.py",
            "tests/test_storage_orphan_cleanup_service.py",
            "tests/test_storage_orphan_cleanup_script_static.py",
            "tests/test_storage_access_audit_static.py",
            "-rs",
        ],
        cwd=BACKEND,
    )
    if tests_completed.returncode != 0:
        result.fail("Storage security unit/static tests failed")

    live_required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
    live_missing = sorted(name for name in live_required if not _env(name))

    if live_missing:
        result.missing_envs.extend(live_missing)
        if ctx.local_mode:
            result.notes.append(
                "LOCAL MODE: skipped live storage cleanup dry-run because required vars are missing: "
                + ", ".join(live_missing)
            )
            return
        result.fail("Missing required env vars for storage cleanup dry-run: " + ", ".join(live_missing))
        return

    cleanup_completed = ctx.run_command(
        result=result,
        cmd=[
            ctx.backend_python,
            "scripts/storage_orphan_cleanup.py",
            "--dry-run",
            "--run-source",
            "release_gate",
            "--expected-interval-minutes",
            str(max(1, expected_interval_minutes)),
        ],
        cwd=BACKEND,
    )
    if cleanup_completed.returncode != 0:
        result.fail("storage_orphan_cleanup.py --dry-run failed")
    else:
        payload = _parse_inventory_json(cleanup_completed.stdout)
        if not payload:
            result.fail("Unable to parse cleanup JSON payload from storage_orphan_cleanup.py output")
        else:
            orphan_count = int(payload.get("orphan_object_paths") or 0)
            if orphan_count > threshold:
                result.fail(
                    f"Orphan object count {orphan_count} exceeds threshold {threshold} from MODE_STORAGE_ORPHAN_THRESHOLD"
                )

    database_url = _env("MODE_SECURITY_DATABASE_URL")
    if not database_url:
        result.missing_envs.append("MODE_SECURITY_DATABASE_URL")
        if ctx.local_mode:
            result.notes.append("LOCAL MODE: skipped storage heartbeat freshness check because MODE_SECURITY_DATABASE_URL is unset")
            return
        result.fail("MODE_SECURITY_DATABASE_URL is required for storage heartbeat freshness check")
        return

    if not shutil.which("psql"):
        if ctx.local_mode:
            result.notes.append("LOCAL MODE: skipped storage heartbeat freshness check because psql is not installed")
            return
        result.fail("psql is required for storage heartbeat freshness check")
        return

    rc, stdout, stderr = _run_psql_query(
        database_url,
        """
        SELECT status, finished_at, orphan_object_paths
        FROM public.storage_cleanup_job_heartbeats
        WHERE run_source = 'scheduled'
        ORDER BY finished_at DESC
        LIMIT 1;
        """,
    )
    if result.log_path is not None:
        with result.log_path.open("a", encoding="utf-8") as handle:
            handle.write("$ psql [scheduled cleanup heartbeat query]\n")
            handle.write(f"exit_code={rc}\n")
            handle.write("--- stdout ---\n")
            handle.write(stdout or "")
            handle.write("\n--- stderr ---\n")
            handle.write(stderr or "")
            handle.write("\n\n")

    if rc != 0:
        result.fail("Unable to query storage cleanup heartbeat table")
        return

    rows = [line for line in (stdout or "").splitlines() if line.strip()]
    if not rows:
        result.fail("No scheduled storage cleanup heartbeat found")
        return

    parts = [part.strip() for part in rows[-1].split("\t")]
    if len(parts) < 3:
        result.fail("Unexpected storage cleanup heartbeat row format")
        return

    status_value = str(parts[0] or "").strip().lower()
    finished_at = _parse_utc_iso(parts[1])
    orphan_value = int(str(parts[2] or "0").strip() or "0")

    if status_value != "succeeded":
        result.fail(f"Latest scheduled cleanup heartbeat is {status_value}, expected succeeded")

    if finished_at is None:
        result.fail("Latest scheduled cleanup heartbeat has invalid finished_at timestamp")
    else:
        age_seconds = max(0.0, (datetime.now(timezone.utc) - finished_at).total_seconds())
        max_age_seconds = max(60, max_age_minutes * 60)
        if age_seconds > max_age_seconds:
            result.fail(
                f"Latest scheduled cleanup heartbeat is stale ({round(age_seconds / 60, 1)} minutes old; max {max_age_minutes})"
            )

    if orphan_value > threshold:
        result.fail(
            f"Latest scheduled cleanup heartbeat orphan count {orphan_value} exceeds threshold {threshold}"
        )


def gate_ios_artifact_scan(ctx: RunnerContext, result: GateResult) -> None:
    ipa_path = ctx.ipa or _env("MODE_IOS_IPA_PATH")
    if not ipa_path and not ctx.local_mode:
        result.missing_envs.append("MODE_IOS_IPA_PATH")
        result.fail("Release mode requires a real IPA path (MODE_IOS_IPA_PATH or --ipa)")
        return

    if not ipa_path and ctx.local_mode:
        result.notes.append("LOCAL MODE: no IPA provided, iOS artifact scan treated as warning-only")
        return

    cmd = [ctx.root_python, "scripts/ios_artifact_scan.py"]
    if ipa_path:
        cmd.extend(["--ipa", ipa_path])
    if not ctx.local_mode:
        cmd.append("--require-ipa")

    completed = ctx.run_command(result=result, cmd=cmd, cwd=ROOT)
    if completed.returncode != 0:
        result.fail("iOS artifact scan failed")


def gate_ai_adversarial(ctx: RunnerContext, result: GateResult) -> None:
    completed = ctx.run_command(
        result=result,
        cmd=[
            ctx.backend_pytest,
            "-q",
            "tests/test_prompt_injection_adversarial.py",
            "tests/test_prompt_guardrails_static.py",
            "tests/test_trainer_intelligence_service.py",
            "tests/test_conversation_history_security.py",
            "-rs",
        ],
        cwd=BACKEND,
    )
    if completed.returncode != 0:
        result.fail("AI adversarial and retrieval guardrail tests failed")


def gate_mobile_hardening(ctx: RunnerContext, result: GateResult) -> None:
    lint_cmd = [ctx.root_python, "scripts/ios_hardening_lint.py"]
    if not ctx.local_mode:
        lint_cmd.append("--require-prebuild")
    if ctx.info_plist:
        lint_cmd.extend(["--info-plist", ctx.info_plist])

    lint_completed = ctx.run_command(result=result, cmd=lint_cmd, cwd=ROOT)
    if lint_completed.returncode != 0:
        result.fail("iOS hardening lint failed")

    js_completed = ctx.run_command(
        result=result,
        cmd=[
            "npm",
            "test",
            "--",
            "--runInBand",
            "src/services/__tests__/secureSessionStorage.test.js",
            "src/services/__tests__/supabaseClient.secureSession.test.js",
            "src/services/__tests__/apiBaseUrl.test.js",
        ],
        cwd=ROOT,
    )
    if js_completed.returncode != 0:
        result.fail("Mobile hardening JS tests failed")

    static_completed = ctx.run_command(
        result=result,
        cmd=[
            ctx.backend_pytest,
            "-q",
            "tests/test_security_release_preflight_static.py",
            "tests/test_ios_security_scripts_static.py",
            "-rs",
        ],
        cwd=BACKEND,
    )
    if static_completed.returncode != 0:
        result.fail("Mobile hardening static checks failed")


GATE_DEFINITIONS: list[tuple[str, str, Callable[[RunnerContext, GateResult], None]]] = [
    ("environment", "Environment validation", gate_environment_validation),
    ("live-db", "Live DB posture", gate_live_db_posture),
    ("cross-tenant", "Cross-tenant integration", gate_cross_tenant_integration),
    ("gdpr", "GDPR deletion coverage", gate_gdpr_deletion_coverage),
    ("storage", "Storage security", gate_storage_security),
    ("ios-artifact", "iOS artifact scan", gate_ios_artifact_scan),
    ("ai-adversarial", "AI adversarial tests", gate_ai_adversarial),
    ("mobile-hardening", "Mobile hardening", gate_mobile_hardening),
]
VALID_GATE_IDS = {item[0] for item in GATE_DEFINITIONS}


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run MODE release security gates (fail-closed by default).")
    parser.add_argument("--local", action="store_true", help="Local mode: allow skipping unavailable live gates")
    parser.add_argument("--only", choices=sorted(VALID_GATE_IDS), default=None, help="Run only a single gate id")
    parser.add_argument("--env-file", default=None, help="Optional .env file to load (process env keeps precedence)")
    parser.add_argument("--ipa", default=None, help="Override IPA path for iOS artifact scan")
    parser.add_argument("--info-plist", default=None, help="Override Info.plist path for iOS hardening lint")
    return parser


def _write_artifacts(ctx: RunnerContext, results: list[GateResult], final_result: str) -> None:
    matrix_lines = [
        "MODE Release Security Gate Results",
        "",
        "| Gate | Status | Notes |",
        "|---|---|---|",
    ]
    for row in results:
        notes = " ; ".join(note.replace("\n", " ").strip() for note in row.notes) or "-"
        matrix_lines.append(f"| {row.gate_name} | {row.status} | {notes} |")

    matrix_lines.extend(["", f"Final result: {final_result}"])
    (ctx.artifacts_dir / "matrix.md").write_text("\n".join(matrix_lines) + "\n", encoding="utf-8")

    summary_payload = {
        "timestamp": ctx.timestamp,
        "mode": "local" if ctx.local_mode else "release",
        "final_result": final_result,
        "gates": [
            {
                "gate_id": row.gate_id,
                "gate_name": row.gate_name,
                "status": row.status,
                "notes": row.notes,
                "commands": row.commands,
                "missing_envs": sorted(set(row.missing_envs)),
                "log_path": str(row.log_path) if row.log_path else None,
            }
            for row in results
        ],
    }
    (ctx.artifacts_dir / "summary.json").write_text(
        json.dumps(summary_payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    (ctx.artifacts_dir / "console_output.txt").write_text("\n".join(ctx.lines) + "\n", encoding="utf-8")


def main() -> int:
    args = _build_parser().parse_args()
    ctx = RunnerContext(
        local_mode=args.local,
        only_gate=args.only,
        ipa=args.ipa,
        info_plist=args.info_plist,
        env_file=args.env_file,
    )
    ctx.ensure_artifacts_dir()
    env_file_error: str | None = None

    if ctx.env_file:
        try:
            resolved, applied, skipped = _load_env_file(ctx.env_file)
            ctx.env_file_resolved = str(resolved)
            ctx.env_file_applied_keys = int(applied)
            ctx.env_file_skipped_keys = int(skipped)
            ctx.print_line(
                f"Loaded env file: {resolved} (applied {applied} missing keys, kept {skipped} existing keys)"
            )
        except Exception as exc:
            env_file_error = f"Failed to load --env-file {ctx.env_file}: {exc}"

    selected_gates = [
        (gate_id, gate_name, fn)
        for gate_id, gate_name, fn in GATE_DEFINITIONS
        if args.only is None or args.only == gate_id
    ]

    results: list[GateResult] = []

    for gate_id, gate_name, fn in selected_gates:
        gate_result = GateResult(gate_id=gate_id, gate_name=gate_name, log_path=ctx.gate_log_path(gate_id))
        gate_result.log_path.write_text("", encoding="utf-8")
        if env_file_error:
            gate_result.fail(env_file_error + " Gate not executed.")
            results.append(gate_result)
            continue
        try:
            fn(ctx, gate_result)
        except Exception as exc:  # pragma: no cover - fail-closed runtime guard
            gate_result.fail(f"Unexpected runner exception: {exc}")
            if gate_result.log_path is not None:
                with gate_result.log_path.open("a", encoding="utf-8") as handle:
                    handle.write(f"Unexpected exception: {exc}\n")
        results.append(gate_result)

    all_pass = bool(results) and all(row.status == "PASS" for row in results)

    ctx.print_line("MODE Release Security Gate Results")
    ctx.print_line("")
    ctx.print_line("| Gate | Status | Notes |")
    ctx.print_line("|---|---|---|")
    for row in results:
        notes = " ; ".join(note.replace("\n", " ").strip() for note in row.notes) or "-"
        ctx.print_line(f"| {row.gate_name} | {row.status} | {notes} |")

    if all_pass:
        final_result = "GO — READY FOR APP STORE SUBMISSION"
        ctx.print_line("")
        ctx.print_line(final_result)
        _write_artifacts(ctx, results, final_result)
        return 0

    final_result = "NO-GO — BLOCKED"
    ctx.print_line("")
    ctx.print_line(final_result)

    failing = [row for row in results if row.status == "FAIL"]
    failing_names = ", ".join(f"{row.gate_name} ({row.gate_id})" for row in failing)
    ctx.print_line(f"Failing gates: {failing_names}")

    ctx.print_line("Rerun commands:")
    for row in failing:
        extra_flags: list[str] = []
        if ctx.env_file:
            extra_flags.extend(["--env-file", ctx.env_file])
        if ctx.local_mode:
            extra_flags.append("--local")
        extra = (" " + " ".join(shlex.quote(item) for item in extra_flags)) if extra_flags else ""
        ctx.print_line(f"- npm run release:security -- --only {row.gate_id}{extra}")

    missing_envs = sorted({name for row in failing for name in row.missing_envs})
    if missing_envs:
        ctx.print_line("Missing env vars/secrets by category:")
        grouped = _group_missing_envs(missing_envs)
        for category, names in grouped:
            ctx.print_line(f"- {category}: {', '.join(names)}")

        default_template = ".env.staging.example" if ctx.local_mode else ".env.release.example"
        default_env_file = ".env.staging" if ctx.local_mode else ".env.release"
        rerun_env_file = ctx.env_file or default_env_file
        local_suffix = " --local" if ctx.local_mode else ""
        ctx.print_line("Exact fix:")
        ctx.print_line(f"- Copy template with placeholders: cp {default_template} {default_env_file}")
        ctx.print_line("- Fill placeholders using approved secret-manager values (never commit real secrets).")
        ctx.print_line(
            f"- Re-run env preflight: npm run release:security -- --only environment --env-file {shlex.quote(rerun_env_file)}{local_suffix}"
        )
        ctx.print_line(
            f"- Re-run release gates: npm run release:security -- --env-file {shlex.quote(rerun_env_file)}{local_suffix}"
        )
        ctx.print_line("Release mode stays fail-closed: missing required env vars or failed live gates keep NO-GO.")
    else:
        ctx.print_line("Missing env vars/secrets: none")

    ctx.print_line("Generated artifacts/logs:")
    ctx.print_line(f"- {ctx.artifacts_dir}")
    for row in results:
        if row.log_path is not None:
            ctx.print_line(f"- {row.log_path}")
    ctx.print_line(f"- {ctx.artifacts_dir / 'matrix.md'}")
    ctx.print_line(f"- {ctx.artifacts_dir / 'summary.json'}")
    ctx.print_line(f"- {ctx.artifacts_dir / 'console_output.txt'}")

    _write_artifacts(ctx, results, final_result)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
