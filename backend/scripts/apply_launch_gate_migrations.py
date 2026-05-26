#!/usr/bin/env python3
"""Apply launch-gate SQL migrations from the checked-in files.

This avoids hand-copying SQL into a console, which is how invalid casts such as
`'{}':a:jsonb` can sneak in. PostgreSQL JSONB casts must use `::jsonb`.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import psycopg


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SQL_FILES = (
    BACKEND_ROOT / "sql" / "20260426e_add_distributed_rate_limits_and_rpc_execute_allowlist.sql",
    BACKEND_ROOT / "sql" / "20260426g_add_account_deletion_audit_log.sql",
    BACKEND_ROOT / "sql" / "20260426h_add_storage_upload_lifecycle_and_security_catalog_rpc.sql",
    BACKEND_ROOT / "sql" / "20260426i_add_storage_cleanup_job_heartbeats.sql",
    BACKEND_ROOT / "sql" / "20260511b_create_intelligence_jobs.sql",
    BACKEND_ROOT / "sql" / "20260511c_database_hardening_indexes.sql",
    BACKEND_ROOT / "sql" / "20260511e_drop_redundant_conversation_message_index.sql",
    BACKEND_ROOT / "sql" / "20260511f_retire_service_role_request_paths.sql",
    BACKEND_ROOT / "sql" / "20260512a_add_health_ping_rpc.sql",
    BACKEND_ROOT / "sql" / "20260514a_allow_account_deletion_intelligence_jobs.sql",
    BACKEND_ROOT / "sql" / "20260514b_grant_service_role_worker_job_tables.sql",
    BACKEND_ROOT / "sql" / "20260515a_add_chat_bootstrap_context_rpc.sql",
    BACKEND_ROOT / "sql" / "20260516a_worker_queue_lag_view.sql",
)

STORAGE_LIFECYCLE_MIGRATION = "20260426h_add_storage_upload_lifecycle_and_security_catalog_rpc.sql"
SERVICE_ROLE_RETIREMENT_MIGRATION = "20260511f_retire_service_role_request_paths.sql"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Apply launch-gate SQL migrations using MODE_SECURITY_DATABASE_URL."
    )
    parser.add_argument(
        "--database-url",
        default=os.getenv("MODE_SECURITY_DATABASE_URL"),
        help="Postgres URL. Defaults to MODE_SECURITY_DATABASE_URL.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate migration files without applying them.",
    )
    return parser


def _validate_sql(path: Path, source: str) -> list[str]:
    failures: list[str] = []
    if ":a:jsonb" in source:
        failures.append(f"{path.name}: invalid JSONB cast typo ':a:jsonb' found")
    if re.search(r"DEFAULT\s+'(?:\\{\\}|\{\})'\s*:[^:]", source):
        failures.append(f"{path.name}: invalid JSONB cast; use ::jsonb")
    if path.name == "20260511f_retire_service_role_request_paths.sql":
        for required in ("DEFAULT '{}'::jsonb", "CREATE TABLE IF NOT EXISTS public.account_deletion_requests"):
            if required not in source:
                failures.append(f"{path.name}: missing required SQL fragment: {required}")
    if path.name == "20260512a_add_health_ping_rpc.sql":
        for required in (
            "CREATE OR REPLACE FUNCTION public.mode_health_ping()",
            "GRANT EXECUTE ON FUNCTION public.mode_health_ping() TO anon",
            "NOTIFY pgrst, 'reload schema'",
        ):
            if required not in source:
                failures.append(f"{path.name}: missing required SQL fragment: {required}")
    if path.name == "20260514a_allow_account_deletion_intelligence_jobs.sql":
        for required in (
            "DROP CONSTRAINT IF EXISTS intelligence_jobs_job_type_check",
            "'account_deletion'",
            "ADD CONSTRAINT intelligence_jobs_job_type_check",
        ):
            if required not in source:
                failures.append(f"{path.name}: missing required SQL fragment: {required}")
    if path.name == "20260514b_grant_service_role_worker_job_tables.sql":
        for required in (
            "GRANT SELECT, INSERT, UPDATE ON public.intelligence_jobs TO service_role",
            "GRANT SELECT, INSERT ON public.worker_job_traces TO service_role",
        ):
            if required not in source:
                failures.append(f"{path.name}: missing required SQL fragment: {required}")
    if path.name == "20260515a_add_chat_bootstrap_context_rpc.sql":
        for required in (
            "CREATE OR REPLACE FUNCTION public.chat_bootstrap_context()",
            "SECURITY INVOKER",
            "GRANT EXECUTE ON FUNCTION public.chat_bootstrap_context() TO authenticated",
            "GRANT EXECUTE ON FUNCTION public.chat_bootstrap_context() TO service_role",
        ):
            if required not in source:
                failures.append(f"{path.name}: missing required SQL fragment: {required}")
    if path.name == "20260516a_worker_queue_lag_view.sql":
        for required in (
            "CREATE OR REPLACE VIEW public.worker_queue_lag",
            "WITH (security_invoker = true)",
            "REVOKE ALL ON public.worker_queue_lag FROM PUBLIC",
            "REVOKE SELECT ON public.worker_queue_lag FROM anon, authenticated",
            "GRANT SELECT ON public.worker_queue_lag TO service_role",
            "NOTIFY pgrst, 'reload schema'",
        ):
            if required not in source:
                failures.append(f"{path.name}: missing required SQL fragment: {required}")
    return failures


def _validate_migration_order(paths: tuple[Path, ...]) -> list[str]:
    names = [path.name for path in paths]
    failures: list[str] = []
    if SERVICE_ROLE_RETIREMENT_MIGRATION not in names:
        return failures
    if STORAGE_LIFECYCLE_MIGRATION not in names:
        failures.append(
            f"{SERVICE_ROLE_RETIREMENT_MIGRATION}: missing prerequisite {STORAGE_LIFECYCLE_MIGRATION}"
        )
        return failures
    if names.index(STORAGE_LIFECYCLE_MIGRATION) > names.index(SERVICE_ROLE_RETIREMENT_MIGRATION):
        failures.append(
            f"{STORAGE_LIFECYCLE_MIGRATION} must be applied before {SERVICE_ROLE_RETIREMENT_MIGRATION} "
            "because it creates public.storage_upload_grants and public.storage_object_ownership"
        )
    return failures


def _read_validated_sql_files() -> list[tuple[Path, str]]:
    loaded: list[tuple[Path, str]] = []
    failures: list[str] = _validate_migration_order(DEFAULT_SQL_FILES)
    for path in DEFAULT_SQL_FILES:
        if not path.exists():
            failures.append(f"missing migration: {path}")
            continue
        source = path.read_text(encoding="utf-8")
        failures.extend(_validate_sql(path, source))
        loaded.append((path, source))
    if failures:
        raise RuntimeError("\n".join(failures))
    return loaded


def main() -> int:
    args = _build_parser().parse_args()
    database_url = str(args.database_url or "").strip()

    try:
        sql_files = _read_validated_sql_files()
    except RuntimeError as exc:
        print(f"Launch migration validation failed:\n{exc}", file=sys.stderr)
        return 1

    if args.dry_run:
        for path, _ in sql_files:
            print(f"validated {path.name}")
        return 0

    if not database_url:
        print("ERROR: MODE_SECURITY_DATABASE_URL or --database-url is required", file=sys.stderr)
        return 2

    with psycopg.connect(database_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            for path, source in sql_files:
                cur.execute(source)
                print(f"applied {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
