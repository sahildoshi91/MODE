#!/usr/bin/env python3
"""
Trainer assistant storage preflight.

Usage:
  cd backend
  ./venv/bin/python scripts/preflight_trainer_assistant_storage.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.modules.trainer_assistant.diagnostics import run_trainer_assistant_storage_preflight


def main() -> int:
    result = run_trainer_assistant_storage_preflight()
    print(json.dumps(result, indent=2, sort_keys=True))

    if result.get("healthy"):
        print("Trainer assistant storage preflight: PASSED")
        print(
            "Next required step: run trainer assistant execute-path smoke to validate "
            "source_type constraint support (backend/sql/20260418c_allow_trainer_assistant_draft_source_type.sql)."
        )
        return 0

    print("Trainer assistant storage preflight: FAILED", file=sys.stderr)
    missing = result.get("missing") or []
    if missing:
        print(
            "Missing schema primitives. Apply backend/sql/20260418b_add_trainer_assistant_last_client_and_router_events.sql.",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
