#!/usr/bin/env python3
"""
Production release security preflight checks.

Usage:
  cd backend
  ./venv/bin/python scripts/security_release_preflight.py --env production
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = SCRIPT_DIR.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings
from app.security.personal_data_inventory import PersonalDataInventoryError, load_personal_data_inventory


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
CLIENT_ROOT = REPO_ROOT / "src"
APP_JSON_PATH = REPO_ROOT / "app.json"
SUPABASE_BLOCKED_HOST_TOKENS = {"staging", "localhost", "127.0.0.1"}
API_BLOCKED_HOST_TOKENS = {"staging", "localhost", "127.0.0.1", "192.168.", "10.", "172.16."}


def _contains_blocked_host(url: str) -> bool:
    lowered = str(url or "").strip().lower()
    return any(token in lowered for token in SUPABASE_BLOCKED_HOST_TOKENS)


def _contains_blocked_api_host(url: str) -> bool:
    lowered = str(url or "").strip().lower()
    return any(token in lowered for token in API_BLOCKED_HOST_TOKENS)


def _scan_text_files_for_patterns(
    *,
    root: Path,
    include_suffixes: set[str],
    patterns: list[re.Pattern[str]],
    skip_parts: set[str],
) -> list[str]:
    findings: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in include_suffixes:
            continue
        if any(part in skip_parts for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for pattern in patterns:
            if pattern.search(text):
                findings.append(path.relative_to(REPO_ROOT).as_posix())
                break
    return sorted(set(findings))


def run_checks(target_env: str) -> tuple[list[str], list[str]]:
    failures: list[str] = []
    notes: list[str] = []

    env_lower = str(target_env or "").strip().lower()
    if env_lower != "production":
        notes.append("Non-production mode selected; production-only fail-closed checks skipped.")
        return failures, notes

    raw_app_env = str(os.getenv("APP_ENV") or "").strip().lower()
    if not raw_app_env:
        failures.append("APP_ENV is required and must be set to production for release preflight.")
    elif raw_app_env not in {"prod", "production"}:
        failures.append("APP_ENV must be production (or prod) for release preflight.")

    if not settings.is_production:
        failures.append("APP_ENV must be set to production for release preflight.")

    if settings.expose_route_debug:
        failures.append("expose_route_debug must be false in production.")

    if not settings.startup_guard_enabled:
        failures.append("startup_guard_enabled must be true in production.")

    if not settings.auth_password_proxy_enabled:
        failures.append("auth_password_proxy_enabled must be true in production.")

    if not settings.account_deletion_enabled:
        failures.append("account_deletion_enabled must be true in production.")

    if not settings.account_deletion_contract_enforced:
        failures.append("account_deletion_contract_enforced must be true in production.")

    if str(settings.rate_limit_backend).strip().lower() != "redis":
        failures.append("rate_limit_backend must be redis in production.")
    if not str(settings.redis_url or "").strip():
        failures.append("REDIS_URL is required when rate_limit_backend is redis in production.")

    if not str(settings.supabase_service_role_key or "").strip():
        failures.append("SUPABASE_SERVICE_ROLE_KEY is required server-side in production.")

    if str(os.getenv("EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY") or "").strip():
        failures.append("EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY must never be set.")

    supabase_url = str(settings.supabase_url or "").strip()
    if not supabase_url:
        failures.append("SUPABASE_URL is required in production.")
    elif _contains_blocked_host(supabase_url):
        failures.append("SUPABASE_URL points to staging/local host token.")

    public_supabase_url = str(os.getenv("EXPO_PUBLIC_SUPABASE_URL") or "").strip()
    if public_supabase_url and _contains_blocked_host(public_supabase_url):
        failures.append("EXPO_PUBLIC_SUPABASE_URL points to staging/local host token.")

    public_api_base_url = str(os.getenv("EXPO_PUBLIC_API_BASE_URL") or "").strip()
    if public_api_base_url and _contains_blocked_api_host(public_api_base_url):
        failures.append("EXPO_PUBLIC_API_BASE_URL points to staging/local/LAN host token.")

    if not settings.production_required_rls_tables_list:
        failures.append("production_required_rls_tables must be configured in production.")

    if not str(settings.storage_private_bucket or "").strip():
        failures.append("storage_private_bucket must be configured in production.")
    if int(settings.storage_upload_window_seconds) > 300:
        failures.append("storage_upload_window_seconds must be <= 300 seconds in production.")
    if int(settings.storage_upload_window_seconds) < 30:
        failures.append("storage_upload_window_seconds must be >= 30 seconds in production.")

    inventory_path = Path(str(settings.personal_data_inventory_path or "").strip())
    if not str(settings.personal_data_inventory_path or "").strip():
        failures.append("personal_data_inventory_path must be configured in production.")
    else:
        resolved_inventory_path = inventory_path if inventory_path.is_absolute() else BACKEND_ROOT / inventory_path
        if not resolved_inventory_path.exists():
            failures.append(f"personal_data_inventory_path does not exist: {resolved_inventory_path}")
        else:
            try:
                load_personal_data_inventory(path_override=str(resolved_inventory_path), strict=True)
            except PersonalDataInventoryError as exc:
                failures.append(f"personal data inventory contract is invalid: {exc}")

    if not settings.account_deletion_active_sink_categories_list:
        failures.append("account_deletion_active_sink_categories must be configured in production.")
    if not settings.account_deletion_disabled_sink_categories_list:
        failures.append("account_deletion_disabled_sink_categories must be configured in production.")

    main_source = (BACKEND_ROOT / "app" / "main.py").read_text(encoding="utf-8")
    if "docs_url=None if settings.is_production else \"/docs\"" not in main_source:
        failures.append("FastAPI docs_url production guard missing in backend/app/main.py.")
    if "openapi_url=None if settings.is_production else \"/openapi.json\"" not in main_source:
        failures.append("FastAPI openapi_url production guard missing in backend/app/main.py.")

    supabase_client_source = (CLIENT_ROOT / "services" / "supabaseClient.js").read_text(encoding="utf-8")
    if "storage: AsyncStorage" in supabase_client_source:
        failures.append("Plaintext AsyncStorage session persistence detected in supabaseClient.js.")

    secret_like_patterns = [
        re.compile(r"EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", re.IGNORECASE),
        re.compile(r"SUPABASE_SERVICE_ROLE_KEY\s*=", re.IGNORECASE),
        re.compile(r"\bsb_secret_[A-Za-z0-9._-]{20,}\b"),
    ]
    secret_findings = _scan_text_files_for_patterns(
        root=REPO_ROOT,
        include_suffixes={".js", ".ts", ".tsx", ".json", ".env", ".plist"},
        patterns=secret_like_patterns,
        skip_parts={".git", "node_modules", "venv", ".venv"},
    )
    filtered_findings = [
        item
        for item in secret_findings
        if item not in {"backend/.env", ".env", "backend/security/production_env_schema.json"}
        and not item.startswith("docs/")
    ]
    if filtered_findings:
        failures.append(
            "Potential service-role/client secret leakage detected in tracked files: "
            + ", ".join(filtered_findings)
        )

    debug_route_patterns = [
        re.compile(r"@router\.(get|post|patch|delete)\(\"/debug", re.IGNORECASE),
        re.compile(r"app\.(get|post|patch|delete)\(\"/debug", re.IGNORECASE),
    ]
    debug_findings = _scan_text_files_for_patterns(
        root=BACKEND_ROOT / "app",
        include_suffixes={".py"},
        patterns=debug_route_patterns,
        skip_parts={"__pycache__"},
    )
    if debug_findings:
        failures.append("Debug route definitions found: " + ", ".join(debug_findings))

    if APP_JSON_PATH.exists():
        app_json = APP_JSON_PATH.read_text(encoding="utf-8")
        if re.search(r"EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", app_json, re.IGNORECASE):
            failures.append("app.json contains EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY.")
        if re.search(r"https?://(localhost|127\.0\.0\.1|staging)", app_json, re.IGNORECASE):
            failures.append("app.json contains localhost/staging URL.")

    return failures, notes


def main() -> int:
    parser = argparse.ArgumentParser(description="Run MODE production security release preflight checks.")
    parser.add_argument(
        "--env",
        default="production",
        choices=["production", "staging", "development"],
        help="Target environment to validate.",
    )
    args = parser.parse_args()

    failures, notes = run_checks(args.env)
    for note in notes:
        print(f"[note] {note}")

    if failures:
        print("Security release preflight: FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Security release preflight: PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
