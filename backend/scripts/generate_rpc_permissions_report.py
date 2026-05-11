#!/usr/bin/env python3
"""
Generate and validate the expected RPC execute-permissions report.

This script is static-analysis based and derives expected grants from the
security migration allowlists. It is designed to be deterministic for CI.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SQL_DIR = REPO_ROOT / "sql"
ALLOWLIST_MIGRATION = SQL_DIR / "20260426e_add_distributed_rate_limits_and_rpc_execute_allowlist.sql"
REPORT_PATH = REPO_ROOT / "security" / "rpc_permissions_report.json"

AUTH_ARRAY_PATTERN = re.compile(
    r"authenticated_allowlist\s+TEXT\[\]\s*:=\s*ARRAY\[(?P<body>.*?)\];",
    re.DOTALL | re.IGNORECASE,
)
SERVICE_ARRAY_PATTERN = re.compile(
    r"service_role_only_allowlist\s+TEXT\[\]\s*:=\s*ARRAY\[(?P<body>.*?)\];",
    re.DOTALL | re.IGNORECASE,
)
STRING_LITERAL_PATTERN = re.compile(r"'([^']+)'")
FUNCTION_PATTERN = re.compile(
    r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\(",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class PermissionRow:
    function_name: str
    grants_to: tuple[str, ...]
    category: str


def _extract_allowlist(pattern: re.Pattern[str], source: str) -> list[str]:
    match = pattern.search(source)
    if not match:
        return []
    body = match.group("body")
    return sorted({item.strip() for item in STRING_LITERAL_PATTERN.findall(body) if item.strip()})


def _discover_public_functions() -> list[str]:
    functions: set[str] = set()
    for path in sorted(SQL_DIR.glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        for match in FUNCTION_PATTERN.findall(text):
            functions.add(str(match).strip())
    return sorted(functions)


def _build_rows(
    *,
    discovered_functions: list[str],
    authenticated_allowlist: list[str],
    service_role_only_allowlist: list[str],
) -> list[PermissionRow]:
    rows: list[PermissionRow] = []
    auth_allow = set(authenticated_allowlist)
    service_allow = set(service_role_only_allowlist)

    for name in discovered_functions:
        if name in auth_allow:
            rows.append(PermissionRow(function_name=name, grants_to=("authenticated", "service_role"), category="safe_allowlist"))
            continue
        if name in service_allow:
            rows.append(PermissionRow(function_name=name, grants_to=("service_role",), category="privileged_service_only"))
            continue
        rows.append(PermissionRow(function_name=name, grants_to=tuple(), category="revoked_all_non_owner"))

    return rows


def _dangerous_grant_findings(rows: list[PermissionRow]) -> list[dict[str, str]]:
    privileged_names = {
        "bootstrap_trainer_tenant",
        "assign_client_to_trainer",
        "security_enforce_rate_limit",
        "security_assert_rls_enabled",
    }
    findings = []
    for row in rows:
        if row.function_name not in privileged_names:
            continue
        if "authenticated" in row.grants_to or "anon" in row.grants_to:
            findings.append(
                {
                    "function": row.function_name,
                    "issue": "privileged function exposed to non-service role",
                }
            )
    return findings


def _build_report() -> dict:
    migration_source = ALLOWLIST_MIGRATION.read_text(encoding="utf-8")
    authenticated_allowlist = _extract_allowlist(AUTH_ARRAY_PATTERN, migration_source)
    service_role_only_allowlist = _extract_allowlist(SERVICE_ARRAY_PATTERN, migration_source)
    discovered_functions = _discover_public_functions()
    rows = _build_rows(
        discovered_functions=discovered_functions,
        authenticated_allowlist=authenticated_allowlist,
        service_role_only_allowlist=service_role_only_allowlist,
    )
    dangerous_findings = _dangerous_grant_findings(rows)

    return {
        "source_migration": ALLOWLIST_MIGRATION.relative_to(REPO_ROOT).as_posix(),
        "authenticated_allowlist": authenticated_allowlist,
        "service_role_only_allowlist": service_role_only_allowlist,
        "functions_discovered_count": len(discovered_functions),
        "rows": [
            {
                "function_name": row.function_name,
                "grants_to": list(row.grants_to),
                "category": row.category,
            }
            for row in rows
        ],
        "dangerous_grant_findings": dangerous_findings,
        "ok": len(dangerous_findings) == 0,
    }


def _canonical_json(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate or validate RPC execute-permissions report.")
    parser.add_argument("--check", action="store_true", help="Fail if checked-in report differs from generated output.")
    parser.add_argument("--stdout", action="store_true", help="Print generated report JSON to stdout.")
    args = parser.parse_args()

    report = _build_report()
    canonical = _canonical_json(report)

    if args.stdout:
        print(canonical, end="")

    if args.check:
        if not REPORT_PATH.exists():
            print(f"RPC permissions report is missing: {REPORT_PATH}")
            return 1
        existing = REPORT_PATH.read_text(encoding="utf-8")
        if existing != canonical:
            print("RPC permissions report drift detected. Regenerate with:")
            print("  cd backend && ./venv/bin/python scripts/generate_rpc_permissions_report.py")
            return 1
        if not report.get("ok", False):
            print("Dangerous RPC permission findings detected:")
            for finding in report.get("dangerous_grant_findings", []):
                print(f"  - {finding['function']}: {finding['issue']}")
            return 1
        print("RPC permissions report check: PASSED")
        return 0

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(canonical, encoding="utf-8")
    print(f"Wrote {REPORT_PATH.relative_to(REPO_ROOT)}")
    if not report.get("ok", False):
        print("Warning: dangerous RPC permission findings detected.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
