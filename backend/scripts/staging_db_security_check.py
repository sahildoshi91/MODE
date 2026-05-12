#!/usr/bin/env python3
"""
Live staging/production database security posture checks.

Requires:
  MODE_SECURITY_DATABASE_URL=postgres://...

Usage:
  cd backend
  MODE_SECURITY_DATABASE_URL=postgres://... ./venv/bin/python scripts/staging_db_security_check.py
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable
from uuid import uuid4

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = SCRIPT_DIR.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings
from app.db.client import get_supabase_admin_client
from app.security.personal_data_inventory import load_personal_data_inventory


PRIVILEGED_RPCS = (
    "bootstrap_trainer_tenant",
    "assign_client_to_trainer",
    "security_enforce_rate_limit",
    "security_assert_rls_enabled",
    "security_list_public_tables",
)

RLS_SCOPE_TOKENS = (
    "auth.uid(",
    "auth_is_",
    "auth_can_",
    "trainer_id",
    "client_id",
    "tenant_id",
    "user_id",
    "assigned_trainer_id",
)

RELATIONAL_SCOPE_TOKENS = (
    ("exists(", "chat_sessions", "session_id"),
)

FALSE_EXPRESSIONS = {"false", ""}
TRUE_EXPRESSIONS = {"true"}
PSQL_COMMAND_STATUS_RE = re.compile(
    r"^(?:SET|RESET|BEGIN|COMMIT|ROLLBACK|CREATE(?:\s+\w+)?|ALTER(?:\s+\w+)?|DROP(?:\s+\w+)?|"
    r"GRANT|REVOKE|INSERT\s+\d+\s+\d+|UPDATE\s+\d+|DELETE\s+\d+)$",
    re.IGNORECASE,
)


@dataclass
class CrossTenantFixture:
    user_ids: list[str] = field(default_factory=list)
    tenant_ids: list[str] = field(default_factory=list)


class SecurityCheckError(RuntimeError):
    pass


class PsqlRunner:
    def __init__(self, database_url: str):
        self.database_url = str(database_url or "").strip()
        if not self.database_url:
            raise SecurityCheckError("MODE_SECURITY_DATABASE_URL (or --database-url) is required")
        if not shutil.which("psql"):
            raise SecurityCheckError("psql was not found in PATH")

    def query_rows(self, sql: str) -> list[list[str]]:
        completed = subprocess.run(
            [
                "psql",
                self.database_url,
                "-v",
                "ON_ERROR_STOP=1",
                "-At",
                "-F",
                "\t",
                "-c",
                sql,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            raise SecurityCheckError(completed.stderr.strip() or completed.stdout.strip() or "psql query failed")
        rows: list[list[str]] = []
        for line in completed.stdout.splitlines():
            if not line.strip():
                continue
            rows.append([part.strip() for part in line.split("\t")])
        return rows

    def query_scalar(self, sql: str) -> str:
        rows = self.query_rows(sql)
        for row in reversed(rows):
            if not row:
                continue
            value = str(row[0] or "").strip()
            if not value or PSQL_COMMAND_STATUS_RE.match(value):
                continue
            return value
        return ""


def _sql_text_array(values: Iterable[str]) -> str:
    escaped = []
    for value in values:
        normalized = str(value).replace("'", "''")
        escaped.append("'" + normalized + "'")
    return "ARRAY[" + ", ".join(escaped) + "]::text[]"


def _sql_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _policy_expr_sql(column: str) -> str:
    safe_column = str(column).strip()
    if safe_column not in {"qual", "with_check"}:
        raise ValueError(f"unsupported policy expression column: {column}")
    return f"regexp_replace(COALESCE({safe_column}, ''), '[[:space:]]+', ' ', 'g')"


def _normalize_expr(expr: str) -> str:
    normalized = re.sub(r"\s+", "", str(expr or "").strip().lower())
    while normalized.startswith("(") and normalized.endswith(")") and len(normalized) >= 2:
        normalized = normalized[1:-1].strip()
    return normalized


def _roles_from_policy_roles(value: str) -> set[str]:
    return {token for token in re.split(r"[^a-zA-Z0-9_]+", str(value or "").lower()) if token}


def _authenticated_policy_has_scope(combined_expr: str) -> bool:
    normalized = _normalize_expr(combined_expr)
    if any(token in normalized for token in RLS_SCOPE_TOKENS):
        return True
    return any(all(token in normalized for token in token_group) for token_group in RELATIONAL_SCOPE_TOKENS)


def _check_privileged_rpc_grants(runner: PsqlRunner, failures: list[str]) -> None:
    rpc_array = _sql_text_array(PRIVILEGED_RPCS)
    existing_rows = runner.query_rows(
        f"""
        SELECT p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY ({rpc_array})
        ORDER BY p.proname;
        """
    )
    existing_functions = {row[0] for row in existing_rows if row}
    missing = sorted(set(PRIVILEGED_RPCS) - existing_functions)
    if missing:
        failures.append("Missing required privileged RPCs: " + ", ".join(missing))

    grant_rows = runner.query_rows(
        f"""
        SELECT routine_name, grantee
        FROM information_schema.role_routine_grants
        WHERE specific_schema = 'public'
          AND routine_name = ANY ({rpc_array})
          AND privilege_type = 'EXECUTE'
        ORDER BY routine_name, grantee;
        """
    )
    grants: dict[str, set[str]] = defaultdict(set)
    for row in grant_rows:
        if len(row) < 2:
            continue
        grants[row[0]].add(row[1])

    for function_name in PRIVILEGED_RPCS:
        grantees = grants.get(function_name, set())
        if "service_role" not in grantees:
            failures.append(f"Privileged RPC {function_name} is not executable by service_role")
        for forbidden in ("anon", "authenticated", "public"):
            if forbidden in grantees:
                failures.append(f"Privileged RPC {function_name} is executable by forbidden role {forbidden}")


def _check_rls_for_personal_tables(runner: PsqlRunner, failures: list[str]) -> None:
    inventory = load_personal_data_inventory(strict=True)
    tables = sorted({row.table for row in inventory.personal_or_derived_tables})
    table_array = _sql_text_array(tables)
    rows = runner.query_rows(
        f"""
        SELECT c.relname, c.relrowsecurity::int, c.relforcerowsecurity::int
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY ({table_array})
          AND c.relkind = 'r'
        ORDER BY c.relname;
        """
    )
    posture = {row[0]: (row[1], row[2]) for row in rows if len(row) >= 3}
    for table in tables:
        flags = posture.get(table)
        if flags is None:
            failures.append(f"Personal-data table {table} is missing from live public schema")
            continue
        rls_enabled = flags[0] == "1"
        rls_forced = flags[1] == "1"
        if not rls_enabled or not rls_forced:
            failures.append(
                f"Personal-data table {table} must have RLS enabled+forced (enabled={rls_enabled}, forced={rls_forced})"
            )


def _check_dangerous_policies(runner: PsqlRunner, failures: list[str]) -> None:
    rows = runner.query_rows(
        f"""
        SELECT
          schemaname,
          tablename,
          policyname,
          COALESCE(array_to_string(roles, ','), ''),
          {_policy_expr_sql("qual")},
          {_policy_expr_sql("with_check")}
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY schemaname, tablename, policyname;
        """
    )
    for row in rows:
        if len(row) < 6:
            continue
        schemaname, tablename, policyname, roles_raw, qual_raw, with_check_raw = row[:6]
        roles = _roles_from_policy_roles(roles_raw)
        normalized_qual = _normalize_expr(qual_raw)
        normalized_with_check = _normalize_expr(with_check_raw)
        location = f"{schemaname}.{tablename}:{policyname}"

        if normalized_qual in TRUE_EXPRESSIONS:
            failures.append(f"Dangerous policy detected ({location}): USING (true)")
        if normalized_with_check in TRUE_EXPRESSIONS:
            failures.append(f"Dangerous policy detected ({location}): WITH CHECK (true)")

        if "authenticated" in roles:
            is_deny_policy = (
                normalized_qual in FALSE_EXPRESSIONS
                and normalized_with_check in FALSE_EXPRESSIONS
            )
            if is_deny_policy:
                continue
            combined_expr = f"{normalized_qual} {normalized_with_check}"
            if combined_expr.strip() and not _authenticated_policy_has_scope(combined_expr):
                failures.append(
                    f"Authenticated policy appears unscoped ({location}); expected tenant/user scoping predicate"
                )


def _check_storage_lifecycle_exception_posture(runner: PsqlRunner, failures: list[str]) -> None:
    posture_rows = runner.query_rows(
        """
        SELECT c.relname, c.relrowsecurity::int, c.relforcerowsecurity::int
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('storage_upload_grants', 'storage_object_ownership')
          AND c.relkind = 'r'
        ORDER BY c.relname;
        """
    )
    posture = {row[0]: (row[1], row[2]) for row in posture_rows if len(row) >= 3}
    lifecycle_tables = ("storage_upload_grants", "storage_object_ownership")
    for table in lifecycle_tables:
        flags = posture.get(table)
        if flags is None:
            failures.append(f"public.{table} is missing")
            continue
        if flags[0] != "1" or flags[1] != "1":
            failures.append(f"public.{table} must have RLS enabled and forced")

    privilege_rows = runner.query_rows(
        """
        SELECT grantee, table_name, privilege_type
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name IN ('storage_upload_grants', 'storage_object_ownership')
          AND grantee IN ('anon', 'authenticated', 'public')
        ORDER BY grantee, table_name, privilege_type;
        """
    )
    authenticated_privileges: dict[str, set[str]] = defaultdict(set)
    for grantee, table_name, privilege_type in privilege_rows:
        if grantee in {"anon", "public"}:
            failures.append(f"public.{table_name} grants {privilege_type} to {grantee}; expected no public access")
            continue
        authenticated_privileges[table_name].add(privilege_type)
    for table in lifecycle_tables:
        missing = {"SELECT", "INSERT", "UPDATE", "DELETE"} - authenticated_privileges.get(table, set())
        if missing:
            failures.append(f"public.{table} missing authenticated grants: {', '.join(sorted(missing))}")

    policy_rows = runner.query_rows(
        f"""
        SELECT
          tablename,
          policyname,
          COALESCE(array_to_string(roles, ','), ''),
          {_policy_expr_sql("qual")},
          {_policy_expr_sql("with_check")}
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('storage_upload_grants', 'storage_object_ownership')
        ORDER BY tablename, policyname;
        """
    )
    authenticated_scoped_actions: dict[str, set[str]] = defaultdict(set)
    for row in policy_rows:
        if len(row) < 5:
            continue
        table_name, policy_name, roles_raw, qual_raw, with_check_raw = row
        roles = _roles_from_policy_roles(roles_raw)
        normalized_qual = _normalize_expr(qual_raw)
        normalized_with_check = _normalize_expr(with_check_raw)
        if {"anon", "public"}.intersection(roles):
            failures.append(f"public.{table_name} policy {policy_name} exposes forbidden roles ({roles_raw})")
        if "authenticated" not in roles:
            continue
        combined = f"{normalized_qual}|{normalized_with_check}"
        if "owner_user_id=auth.uid(" not in combined:
            failures.append(
                f"public.{table_name} authenticated policy {policy_name} must scope to owner_user_id = auth.uid()"
            )
            continue
        if "select" in policy_name:
            authenticated_scoped_actions[table_name].add("SELECT")
        elif "insert" in policy_name:
            authenticated_scoped_actions[table_name].add("INSERT")
        elif "update" in policy_name:
            authenticated_scoped_actions[table_name].add("UPDATE")
        elif "delete" in policy_name:
            authenticated_scoped_actions[table_name].add("DELETE")

    for table in lifecycle_tables:
        missing = {"SELECT", "INSERT", "UPDATE", "DELETE"} - authenticated_scoped_actions.get(table, set())
        if missing:
            failures.append(f"public.{table} missing owner-scoped authenticated policies: {', '.join(sorted(missing))}")


def _check_trainer_invite_codes_locked_down(runner: PsqlRunner, failures: list[str]) -> None:
    posture_rows = runner.query_rows(
        """
        SELECT c.relrowsecurity::int, c.relforcerowsecurity::int
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'trainer_invite_codes'
          AND c.relkind = 'r'
        LIMIT 1;
        """
    )
    if not posture_rows:
        failures.append("public.trainer_invite_codes is missing from live schema")
        return

    posture = posture_rows[0]
    if len(posture) < 2 or posture[0] != "1" or posture[1] != "1":
        failures.append("public.trainer_invite_codes must have RLS enabled and forced")

    privilege_rows = runner.query_rows(
        """
        SELECT grantee, privilege_type
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = 'trainer_invite_codes'
          AND grantee IN ('anon', 'authenticated', 'public')
        ORDER BY grantee, privilege_type;
        """
    )
    for grantee, privilege_type in privilege_rows:
        failures.append(
            f"public.trainer_invite_codes grants {privilege_type} to {grantee}; expected service-only access"
        )

    policy_rows = runner.query_rows(
        f"""
        SELECT
          policyname,
          COALESCE(array_to_string(roles, ','), ''),
          {_policy_expr_sql("qual")},
          {_policy_expr_sql("with_check")}
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'trainer_invite_codes'
        ORDER BY policyname;
        """
    )
    for row in policy_rows:
        if len(row) < 4:
            continue
        policy_name, roles_raw, qual_raw, with_check_raw = row
        roles = _roles_from_policy_roles(roles_raw)
        if {"anon", "authenticated", "public"}.intersection(roles):
            failures.append(
                f"public.trainer_invite_codes policy {policy_name} exposes forbidden roles ({roles_raw})"
            )
            continue

        normalized_qual = _normalize_expr(qual_raw)
        normalized_with_check = _normalize_expr(with_check_raw)
        if normalized_qual in TRUE_EXPRESSIONS or normalized_with_check in TRUE_EXPRESSIONS:
            failures.append(
                f"public.trainer_invite_codes policy {policy_name} is permissive (USING/WITH CHECK true)"
            )


def _count_as_authenticated(runner: PsqlRunner, *, subject_user_id: str, sql_count_query: str) -> int:
    statement = (
        "SET ROLE authenticated;"
        "SELECT set_config('request.jwt.claim.role', 'authenticated', true);"
        f"SELECT set_config('request.jwt.claim.sub', {_sql_quote(subject_user_id)}, true);"
        f"{sql_count_query};"
        "RESET ROLE;"
    )
    value = runner.query_scalar(statement)
    return int(str(value or "0").strip())


def _ephemeral_fixture_guard_failures() -> list[str]:
    failures: list[str] = []
    if os.getenv("MODE_RUN_STAGING_SUPABASE_TESTS") != "1":
        failures.append("MODE_RUN_STAGING_SUPABASE_TESTS=1")
    if str(settings.app_env or "").strip().lower() != "staging":
        failures.append("APP_ENV=staging")
    required_env = {
        "SUPABASE_URL": settings.supabase_url,
        "SUPABASE_ANON_KEY": settings.supabase_anon_key,
        "SUPABASE_SERVICE_ROLE_KEY": settings.supabase_service_role_key,
    }
    missing = [name for name, value in required_env.items() if not str(value or "").strip()]
    failures.extend(missing)
    return failures


def _create_auth_user(admin: object, *, email: str, password: str, fixture: CrossTenantFixture) -> str:
    response = admin.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
        }
    )
    user = response.user
    fixture.user_ids.append(str(user.id))
    return str(user.id)


def _create_ephemeral_cross_tenant_fixture(fixture: CrossTenantFixture | None = None) -> CrossTenantFixture:
    admin = get_supabase_admin_client()
    fixture = fixture or CrossTenantFixture()
    run_id = uuid4().hex
    password = f"ModeStage!{run_id[:12]}"
    prefix = f"security_gate_{run_id[:10]}"

    trainer_a_user_id = _create_auth_user(
        admin,
        email=f"{prefix}_trainer_a@example.com",
        password=password,
        fixture=fixture,
    )
    trainer_b_user_id = _create_auth_user(
        admin,
        email=f"{prefix}_trainer_b@example.com",
        password=password,
        fixture=fixture,
    )
    client_b_user_id = _create_auth_user(
        admin,
        email=f"{prefix}_client_b@example.com",
        password=password,
        fixture=fixture,
    )

    tenant_a = admin.rpc(
        "bootstrap_trainer_tenant",
        {
            "trainer_user_id": trainer_a_user_id,
            "tenant_name": f"Security Gate Tenant A {run_id}",
            "tenant_slug": f"security-gate-a-{run_id}",
            "trainer_display_name": "Security Gate Coach A",
            "default_persona_name": "Security Gate Persona A",
            "tone_description": "Temporary launch-gate fixture.",
            "coaching_philosophy": "Validate cross-tenant RLS.",
        },
    ).execute()
    tenant_a_row = tenant_a.data[0]
    fixture.tenant_ids.append(str(tenant_a_row["tenant_id"]))

    tenant_b = admin.rpc(
        "bootstrap_trainer_tenant",
        {
            "trainer_user_id": trainer_b_user_id,
            "tenant_name": f"Security Gate Tenant B {run_id}",
            "tenant_slug": f"security-gate-b-{run_id}",
            "trainer_display_name": "Security Gate Coach B",
            "default_persona_name": "Security Gate Persona B",
            "tone_description": "Temporary launch-gate fixture.",
            "coaching_philosophy": "Validate cross-tenant RLS.",
        },
    ).execute()
    tenant_b_row = tenant_b.data[0]
    fixture.tenant_ids.append(str(tenant_b_row["tenant_id"]))

    admin.rpc(
        "assign_client_to_trainer",
        {
            "client_user_id": client_b_user_id,
            "trainer_record_id": str(tenant_b_row["trainer_id"]),
        },
    ).execute()
    return fixture


def _cleanup_ephemeral_cross_tenant_fixture(fixture: CrossTenantFixture, failures: list[str]) -> None:
    admin = get_supabase_admin_client()
    cleanup_failures: list[str] = []
    for tenant_id in fixture.tenant_ids:
        try:
            admin.table("tenants").delete().eq("id", tenant_id).execute()
        except Exception as exc:
            cleanup_failures.append(f"tenant {tenant_id}: {exc.__class__.__name__}")
    for user_id in fixture.user_ids:
        try:
            admin.auth.admin.delete_user(user_id)
        except Exception as exc:
            cleanup_failures.append(f"auth user {user_id}: {exc.__class__.__name__}")
    if cleanup_failures:
        failures.append("Ephemeral cross-tenant fixture cleanup failed: " + "; ".join(cleanup_failures))


def _check_cross_tenant_with_ephemeral_fixture(runner: PsqlRunner, failures: list[str]) -> None:
    fixture = CrossTenantFixture()
    try:
        fixture = _create_ephemeral_cross_tenant_fixture(fixture)
        _check_cross_tenant_access_denied(runner, failures, allow_ephemeral_fixture=False)
    except Exception as exc:
        failures.append(f"Cross-tenant ephemeral fixture check failed: {exc.__class__.__name__}")
    finally:
        if fixture.user_ids or fixture.tenant_ids:
            _cleanup_ephemeral_cross_tenant_fixture(fixture, failures)


def _check_cross_tenant_access_denied(
    runner: PsqlRunner,
    failures: list[str],
    *,
    allow_ephemeral_fixture: bool = True,
) -> None:
    fixture_rows = runner.query_rows(
        """
        SELECT
          t1.user_id AS trainer_a_user_id,
          t1.id AS trainer_a_id,
          t2.id AS trainer_b_id,
          c2.id AS client_b_id,
          c2.user_id AS client_b_user_id
        FROM public.trainers t1
        JOIN public.trainers t2
          ON t1.tenant_id <> t2.tenant_id
        JOIN public.clients c2
          ON c2.assigned_trainer_id = t2.id
        WHERE t1.user_id IS NOT NULL
          AND c2.user_id IS NOT NULL
        LIMIT 1;
        """
    )
    if not fixture_rows:
        guard_failures = _ephemeral_fixture_guard_failures()
        if allow_ephemeral_fixture and not guard_failures:
            _check_cross_tenant_with_ephemeral_fixture(runner, failures)
            return
        failures.append(
            "Cross-tenant access check could not run: staging data must include two tenants with trainer/client "
            "records, or enable ephemeral fixtures with "
            + ", ".join(guard_failures or ["MODE_RUN_STAGING_SUPABASE_TESTS=1", "APP_ENV=staging"])
        )
        return

    trainer_a_user_id, trainer_a_id, _trainer_b_id, client_b_id, client_b_user_id = fixture_rows[0][:5]

    try:
        trainer_can_read_other_client = _count_as_authenticated(
            runner,
            subject_user_id=trainer_a_user_id,
            sql_count_query=f"SELECT COUNT(*) FROM public.clients WHERE id = {_sql_quote(client_b_id)}",
        )
    except Exception as exc:
        failures.append(f"Cross-tenant trainer->client check failed to execute: {exc}")
        trainer_can_read_other_client = 0

    if trainer_can_read_other_client != 0:
        failures.append(
            f"Cross-tenant isolation failure: trainer {trainer_a_user_id} can read unrelated client {client_b_id}"
        )

    try:
        client_can_read_other_trainer = _count_as_authenticated(
            runner,
            subject_user_id=client_b_user_id,
            sql_count_query=f"SELECT COUNT(*) FROM public.trainers WHERE id = {_sql_quote(trainer_a_id)}",
        )
    except Exception as exc:
        failures.append(f"Cross-tenant client->trainer check failed to execute: {exc}")
        client_can_read_other_trainer = 0

    if client_can_read_other_trainer != 0:
        failures.append(
            f"Cross-tenant isolation failure: client {client_b_user_id} can read unrelated trainer {trainer_a_id}"
        )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run live staging/prod DB security posture checks")
    parser.add_argument(
        "--database-url",
        default=None,
        help="Postgres URL (defaults to MODE_SECURITY_DATABASE_URL)",
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    database_url = str(args.database_url or "").strip() or str(os.getenv("MODE_SECURITY_DATABASE_URL") or "").strip()
    try:
        runner = PsqlRunner(database_url)
    except SecurityCheckError as exc:
        print(f"Staging DB security check: FAILED\n- {exc}")
        return 1

    failures: list[str] = []
    _check_privileged_rpc_grants(runner, failures)
    _check_rls_for_personal_tables(runner, failures)
    _check_dangerous_policies(runner, failures)
    _check_storage_lifecycle_exception_posture(runner, failures)
    _check_trainer_invite_codes_locked_down(runner, failures)
    _check_cross_tenant_access_denied(runner, failures)

    if failures:
        print("Staging DB security check: FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Staging DB security check: PASSED")
    print("Verified privileged RPC grants, RLS posture, dangerous policy guards, storage lifecycle RLS, accepted signed-url exception, and cross-tenant isolation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
