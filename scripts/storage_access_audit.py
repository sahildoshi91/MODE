#!/usr/bin/env python3
"""
Fail-closed repository audit for direct client-side bucket access.

This check blocks legacy direct-storage calls outside approved backend service paths.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ALLOWLIST = {
    "backend/app/api/v1/storage_private.py",
    "backend/app/modules/account_deletion/repository.py",
    "backend/app/modules/feedback/service.py",
    "backend/app/modules/storage_lifecycle/repository.py",
    "backend/tests/test_storage_private_api.py",
    "scripts/storage_access_audit.py",
}
FILE_SUFFIXES = {".py", ".js", ".ts", ".tsx"}
PATTERNS = (
    re.compile(r"\bsupabase\.storage\b"),
    re.compile(r"\.storage\.from_\s*\("),
    re.compile(r"/storage/v1/object"),
)
SKIP_PARTS = {".git", "node_modules", "venv", ".venv", "__pycache__"}


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Audit repository for direct storage bucket access")
    parser.add_argument(
        "--allow",
        action="append",
        default=[],
        help="Additional repo-relative path allowlist entries",
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    allowlist = set(DEFAULT_ALLOWLIST)
    allowlist.update(str(value).strip() for value in args.allow if str(value).strip())

    findings: list[str] = []
    for path in REPO_ROOT.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in FILE_SUFFIXES:
            continue
        if any(part in SKIP_PARTS for part in path.parts):
            continue

        relative_path = path.relative_to(REPO_ROOT).as_posix()
        if relative_path in allowlist:
            continue

        try:
            source = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        for line_number, line in enumerate(source.splitlines(), start=1):
            for pattern in PATTERNS:
                if pattern.search(line):
                    findings.append(f"{relative_path}:{line_number}:{line.strip()}")
                    break

    if findings:
        print("Storage access audit: FAILED")
        print("Direct bucket access is only allowed in backend signed URL/cleanup paths.")
        for finding in findings:
            print(f"- {finding}")
        return 1

    print("Storage access audit: PASSED")
    print("No unapproved direct bucket access calls were found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
