#!/usr/bin/env python3
"""
Cleanup unverified uploads, orphan storage objects, and files owned by deleted users.

Usage:
  cd backend
  ./venv/bin/python scripts/storage_orphan_cleanup.py
  ./venv/bin/python scripts/storage_orphan_cleanup.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = SCRIPT_DIR.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings
from app.db.client import get_supabase_admin_client
from app.modules.storage_lifecycle.repository import StorageLifecycleRepository
from app.modules.storage_lifecycle.service import StorageLifecycleError, StorageLifecycleService


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run storage orphan cleanup routines")
    parser.add_argument("--dry-run", action="store_true", help="Report cleanup targets without deleting data")
    parser.add_argument(
        "--max-items",
        type=int,
        default=1000,
        help="Maximum rows/paths to process per run (default: 1000)",
    )
    parser.add_argument(
        "--bucket",
        default=None,
        help="Override storage bucket (defaults to storage_private_bucket setting)",
    )
    parser.add_argument(
        "--run-source",
        default="manual",
        choices=["scheduled", "manual", "release_gate"],
        help="Source label written to cleanup heartbeat rows (default: manual)",
    )
    parser.add_argument(
        "--expected-interval-minutes",
        type=int,
        default=15,
        help="Expected schedule interval used for heartbeat freshness checks (default: 15)",
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    bucket = str(args.bucket or settings.storage_private_bucket or "").strip()
    if not bucket:
        print("Storage orphan cleanup: FAILED")
        print("- storage_private_bucket is not configured")
        return 1

    repository = StorageLifecycleRepository(get_supabase_admin_client())
    service = StorageLifecycleService(repository)
    started_at_iso = datetime.now(timezone.utc).isoformat()
    try:
        result = service.run_cleanup(
            bucket=bucket,
            known_prefixes=settings.storage_cleanup_known_prefixes_list or ["client", "trainer", "user", "users", "auth"],
            dry_run=bool(args.dry_run),
            max_items=max(1, int(args.max_items)),
        )
        finished_at_iso = datetime.now(timezone.utc).isoformat()
        service.record_cleanup_heartbeat(
            run_source=args.run_source,
            status="succeeded",
            bucket=bucket,
            result=result,
            started_at_iso=started_at_iso,
            finished_at_iso=finished_at_iso,
            expected_interval_minutes=max(1, int(args.expected_interval_minutes)),
        )
    except StorageLifecycleError as exc:
        finished_at_iso = datetime.now(timezone.utc).isoformat()
        try:
            service.record_cleanup_heartbeat(
                run_source=args.run_source,
                status="failed",
                bucket=bucket,
                result=None,
                started_at_iso=started_at_iso,
                finished_at_iso=finished_at_iso,
                expected_interval_minutes=max(1, int(args.expected_interval_minutes)),
                error_message=exc.message,
            )
        except Exception:
            pass
        print("Storage orphan cleanup: FAILED")
        print(f"- {exc.message}")
        return int(exc.status_code) if int(exc.status_code) >= 1 else 1
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        finished_at_iso = datetime.now(timezone.utc).isoformat()
        try:
            service.record_cleanup_heartbeat(
                run_source=args.run_source,
                status="failed",
                bucket=bucket,
                result=None,
                started_at_iso=started_at_iso,
                finished_at_iso=finished_at_iso,
                expected_interval_minutes=max(1, int(args.expected_interval_minutes)),
                error_message=str(exc),
            )
        except Exception:
            pass
        print("Storage orphan cleanup: FAILED")
        print(f"- {exc}")
        return 1

    print(json.dumps(result, indent=2, sort_keys=True))
    print("Storage orphan cleanup: PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
