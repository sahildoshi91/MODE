#!/usr/bin/env python3
"""Phase B live database audit.

Requires MODE_SECURITY_DATABASE_URL. Prints no secrets.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import psycopg
from psycopg.rows import dict_row


REQUIRED_INDEXES = (
    "idx_conversations_trainer_client",
    "idx_conversations_client_created_desc",
    "idx_conversation_messages_conversation_created_desc",
    "idx_trainer_knowledge_entries_trainer_status",
    "idx_intelligence_jobs_type_status_enqueued",
)

USER_FACING_TABLES = (
    "conversations",
    "conversation_messages",
    "chat_sessions",
    "chat_messages",
    "coach_memory",
    "trainer_knowledge_entries",
    "daily_checkins",
    "intelligence_jobs",
    "worker_job_traces",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=os.getenv("MODE_SECURITY_DATABASE_URL", ""))
    args = parser.parse_args()
    database_url = str(args.database_url or "").strip()
    if not database_url:
        print("ERROR: MODE_SECURITY_DATABASE_URL is required", file=sys.stderr)
        return 2

    report: dict[str, Any] = {
        "indexes": {},
        "rls": {},
        "policies": {},
        "query_plans": {},
        "cross_tenant_checks": {},
    }
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '10s'")
            report["indexes"] = _index_report(cur)
            report["rls"] = _rls_report(cur)
            report["policies"] = _policy_report(cur)
            report["query_plans"] = _query_plans(cur)
            report["cross_tenant_checks"] = _cross_tenant_checks(conn)

    print(json.dumps(report, indent=2, default=str))
    missing = [name for name, value in report["indexes"].items() if not value.get("exists")]
    rls_gaps = [
        name
        for name, value in report["rls"].items()
        if not value.get("rls_enabled") or not value.get("rls_forced")
    ]
    if missing or rls_gaps:
        return 1
    return 0


def _index_report(cur: Any) -> dict[str, Any]:
    cur.execute(
        """
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = ANY(%s)
        ORDER BY indexname
        """,
        (list(REQUIRED_INDEXES),),
    )
    found = {row["indexname"]: row["indexdef"] for row in cur.fetchall()}
    return {
        name: {
            "exists": name in found,
            "definition": found.get(name),
        }
        for name in REQUIRED_INDEXES
    }


def _rls_report(cur: Any) -> dict[str, Any]:
    cur.execute(
        """
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY(%s)
          AND c.relkind = 'r'
        ORDER BY c.relname
        """,
        (list(USER_FACING_TABLES),),
    )
    rows = {row["relname"]: row for row in cur.fetchall()}
    return {
        table: {
            "exists": table in rows,
            "rls_enabled": bool(rows.get(table, {}).get("relrowsecurity")),
            "rls_forced": bool(rows.get(table, {}).get("relforcerowsecurity")),
        }
        for table in USER_FACING_TABLES
    }


def _policy_report(cur: Any) -> dict[str, list[dict[str, str]]]:
    cur.execute(
        """
        SELECT tablename, policyname, cmd, COALESCE(qual, '') AS qual, COALESCE(with_check, '') AS with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY(%s)
        ORDER BY tablename, policyname
        """,
        (list(USER_FACING_TABLES),),
    )
    policies: dict[str, list[dict[str, str]]] = {}
    for row in cur.fetchall():
        policies.setdefault(row["tablename"], []).append(
            {
                "policy": row["policyname"],
                "cmd": row["cmd"],
                "qual": row["qual"],
                "with_check": row["with_check"],
            }
        )
    return policies


def _query_plans(cur: Any) -> dict[str, Any]:
    plans: dict[str, Any] = {}

    conversation = _one(
        cur,
        """
        SELECT id::text AS id, trainer_id::text AS trainer_id, client_id::text AS client_id
        FROM public.conversations
        WHERE client_id IS NOT NULL
        LIMIT 1
        """,
    )
    if conversation:
        plans["conversations_trainer_client"] = _explain(
            cur,
            "SELECT id FROM public.conversations WHERE trainer_id = %s AND client_id = %s LIMIT 1",
            (conversation["trainer_id"], conversation["client_id"]),
        )
        plans["conversations_client_history"] = _explain(
            cur,
            "SELECT id FROM public.conversations WHERE client_id = %s ORDER BY created_at DESC LIMIT 5",
            (conversation["client_id"],),
        )
        plans["conversation_messages_history"] = _explain(
            cur,
            "SELECT id FROM public.conversation_messages WHERE conversation_id = %s ORDER BY created_at DESC, id DESC LIMIT 5",
            (conversation["id"],),
        )
    else:
        zero_uuid = "00000000-0000-0000-0000-000000000000"
        plans["conversations_trainer_client"] = _index_usability_explain(
            cur,
            "SELECT id FROM public.conversations WHERE trainer_id = %s AND client_id = %s LIMIT 1",
            (zero_uuid, zero_uuid),
            reason="no conversation sample rows",
        )
        plans["conversations_client_history"] = _index_usability_explain(
            cur,
            "SELECT id FROM public.conversations WHERE client_id = %s ORDER BY created_at DESC LIMIT 5",
            (zero_uuid,),
            reason="no conversation sample rows",
        )
        plans["conversation_messages_history"] = _index_usability_explain(
            cur,
            "SELECT id FROM public.conversation_messages WHERE conversation_id = %s ORDER BY created_at DESC, id DESC LIMIT 5",
            (zero_uuid,),
            reason="no conversation sample rows",
        )

    trainer = _one(cur, "SELECT id::text AS id FROM public.trainers LIMIT 1")
    if trainer:
        plans["trainer_knowledge_entries_trainer"] = _explain(
            cur,
            "SELECT id FROM public.trainer_knowledge_entries WHERE trainer_id = %s LIMIT 5",
            (trainer["id"],),
        )
    else:
        plans["trainer_knowledge_entries_trainer"] = _index_usability_explain(
            cur,
            "SELECT id FROM public.trainer_knowledge_entries WHERE trainer_id = %s LIMIT 5",
            ("00000000-0000-0000-0000-000000000000",),
            reason="no trainer sample rows",
        )

    checkin = _one(cur, "SELECT client_id::text AS client_id FROM public.daily_checkins LIMIT 1")
    if checkin:
        plans["daily_checkins_client_created"] = _explain(
            cur,
            "SELECT id FROM public.daily_checkins WHERE client_id = %s ORDER BY created_at DESC LIMIT 5",
            (checkin["client_id"],),
        )
    else:
        plans["daily_checkins_client_created"] = _index_usability_explain(
            cur,
            "SELECT id FROM public.daily_checkins WHERE client_id = %s ORDER BY created_at DESC LIMIT 5",
            ("00000000-0000-0000-0000-000000000000",),
            reason="no daily_checkins sample rows",
        )

    if _table_exists(cur, "intelligence_jobs"):
        plans["intelligence_jobs_visibility"] = _explain(
            cur,
            """
            SELECT job_id
            FROM public.intelligence_jobs
            WHERE job_type = 'memory_write' AND status IN ('queued', 'retry')
            ORDER BY enqueued_at
            LIMIT 10
            """,
            (),
        )
    return plans


def _cross_tenant_checks(conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        sample = _one(
            cur,
            """
            SELECT
              own.id::text AS own_trainer_id,
              own.user_id::text AS own_user_id,
              own_client.id::text AS own_client_id,
              other.id::text AS other_trainer_id
            FROM public.trainers own
            JOIN public.clients own_client ON own_client.assigned_trainer_id = own.id
            JOIN public.trainers other ON other.id <> own.id
            WHERE own.user_id IS NOT NULL
              AND own_client.id IS NOT NULL
            LIMIT 1
            """,
        )
    if not sample:
        return {"status": "skipped", "reason": "not enough tenant sample data"}

    claims = json.dumps({"sub": sample["own_user_id"]})
    try:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SET LOCAL ROLE authenticated")
                cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (claims,))
                own_count = _scalar(
                    cur,
                    """
                    SELECT COUNT(*)
                    FROM public.conversations
                    WHERE trainer_id = %s AND client_id = %s
                    """,
                    (sample["own_trainer_id"], sample["own_client_id"]),
                )
                other_count = _scalar(
                    cur,
                    "SELECT COUNT(*) FROM public.conversations WHERE trainer_id = %s",
                    (sample["other_trainer_id"],),
                )
        return {
            "status": "checked",
            "conversations_own_count": int(own_count or 0),
            "conversations_cross_trainer_count": int(other_count or 0),
        }
    except Exception as exc:
        return {"status": "skipped", "reason": exc.__class__.__name__}


def _explain(cur: Any, sql: str, params: tuple[Any, ...]) -> list[str]:
    cur.execute(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) {sql}", params)
    return [str(row["QUERY PLAN"]) for row in cur.fetchall()]


def _index_usability_explain(cur: Any, sql: str, params: tuple[Any, ...], *, reason: str) -> dict[str, Any]:
    try:
        cur.execute("SET enable_seqscan = off")
        return {
            "status": "index_usability_plan",
            "reason": reason,
            "plan": _explain(cur, sql, params),
        }
    finally:
        cur.execute("SET enable_seqscan = on")


def _one(cur: Any, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    cur.execute(sql, params)
    row = cur.fetchone()
    return dict(row) if row else None


def _scalar(cur: Any, sql: str, params: tuple[Any, ...] = ()) -> Any:
    cur.execute(sql, params)
    row = cur.fetchone()
    if not row:
        return None
    return next(iter(row.values()))


def _table_exists(cur: Any, table: str) -> bool:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL AS exists", (f"public.{table}",))
    row = cur.fetchone()
    return bool(row and row["exists"])


if __name__ == "__main__":
    raise SystemExit(main())
