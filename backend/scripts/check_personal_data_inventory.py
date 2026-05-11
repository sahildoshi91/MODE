#!/usr/bin/env python3
"""
Validate personal-data deletion contract coverage.

Checks:
- inventory schema/contract validity
- migration table coverage vs inventory table coverage
- (optional) live database public tables vs inventory

Usage:
  cd backend
  ./venv/bin/python scripts/check_personal_data_inventory.py
  MODE_SECURITY_DATABASE_URL=postgres://... ./venv/bin/python scripts/check_personal_data_inventory.py --check-live
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = SCRIPT_DIR.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.security.personal_data_inventory import load_personal_data_inventory, validate_personal_data_inventory


SQL_DIR = BACKEND_ROOT / "sql"
TABLE_PATTERN = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)",
    re.IGNORECASE,
)


def _discover_public_tables_from_migrations() -> set[str]:
    tables: set[str] = set()
    for path in sorted(SQL_DIR.glob("*.sql")):
        source = path.read_text(encoding="utf-8")
        for match in TABLE_PATTERN.findall(source):
            tables.add(str(match).strip().lower())
    return tables


def _run_psql_table_query(database_url: str) -> set[str]:
    if not shutil.which("psql"):
        raise RuntimeError("psql is required for --check-live but was not found in PATH")

    sql = """
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname;
    """
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
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "psql command failed")

    return {
        line.strip().lower()
        for line in completed.stdout.splitlines()
        if line.strip()
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate personal data inventory coverage")
    parser.add_argument("--inventory-path", default=None, help="Optional override for inventory JSON path")
    parser.add_argument(
        "--check-live",
        action="store_true",
        help="Also compare inventory tables against live database schema",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Postgres URL for live checks. Falls back to MODE_SECURITY_DATABASE_URL.",
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    failures = validate_personal_data_inventory(path_override=args.inventory_path)
    if failures:
        print("Personal data inventory check: FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1

    inventory = load_personal_data_inventory(path_override=args.inventory_path, strict=True)
    inventory_tables = set(inventory.table_names)

    migration_tables = _discover_public_tables_from_migrations()
    missing_inventory_tables = sorted(migration_tables - inventory_tables)
    if missing_inventory_tables:
        failures.append(
            "Migration tables missing from inventory: " + ", ".join(missing_inventory_tables)
        )

    extra_inventory_tables = sorted(inventory_tables - migration_tables)
    if extra_inventory_tables:
        failures.append(
            "Inventory includes tables not present in migrations: " + ", ".join(extra_inventory_tables)
        )

    if args.check_live:
        database_url = str(args.database_url or "").strip() or str(
            os.getenv("MODE_SECURITY_DATABASE_URL") or ""
        ).strip()
        if not database_url:
            failures.append("--check-live requires --database-url or MODE_SECURITY_DATABASE_URL")
        else:
            try:
                live_tables = _run_psql_table_query(database_url)
            except Exception as exc:
                failures.append(f"Live schema check failed: {exc}")
            else:
                unknown_live_tables = sorted(live_tables - inventory_tables)
                missing_live_tables = sorted(inventory_tables - live_tables)
                if unknown_live_tables:
                    failures.append(
                        "Live schema has new public tables missing from inventory: " + ", ".join(unknown_live_tables)
                    )
                if missing_live_tables:
                    failures.append(
                        "Inventory includes tables missing from live schema: " + ", ".join(missing_live_tables)
                    )

    if failures:
        print("Personal data inventory check: FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Personal data inventory check: PASSED")
    print(f"Inventory tables: {len(inventory_tables)}")
    print(f"Migration tables: {len(migration_tables)}")
    if args.check_live:
        print("Live schema coverage: PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
