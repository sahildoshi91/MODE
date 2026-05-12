#!/usr/bin/env python3
"""Apply Phase A/B SQL files when psql is unavailable."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SQL_FILES = (
    BACKEND_ROOT / "sql" / "20260511b_create_intelligence_jobs.sql",
    BACKEND_ROOT / "sql" / "20260511c_database_hardening_indexes.sql",
    BACKEND_ROOT / "sql" / "20260511e_drop_redundant_conversation_message_index.sql",
)


def main() -> int:
    database_url = str(os.getenv("MODE_SECURITY_DATABASE_URL") or "").strip()
    if not database_url:
        print("ERROR: MODE_SECURITY_DATABASE_URL is required", file=sys.stderr)
        return 2
    for path in SQL_FILES:
        if not path.exists():
            print(f"ERROR: missing migration {path}", file=sys.stderr)
            return 2

    with psycopg.connect(database_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            for path in SQL_FILES:
                cur.execute(path.read_text())
                print(f"applied {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
