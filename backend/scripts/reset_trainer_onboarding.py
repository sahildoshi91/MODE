#!/usr/bin/env python3
"""Reset a trainer account back to AI trainer onboarding."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings
from app.core.dependencies import trainer_context_shared_cache_key
from app.db.client import get_supabase_admin_client
from app.modules.conversation.cache import get_chat_cache


TRAINER_STUB_FLOW_KEY = "trainer_stub_v1"
TRAINER_STUB_STEP = "trainer_stub"
TRAINER_ONBOARDING_WELCOME_PROGRESS = {
    "completed_steps": 0,
    "total_steps": 8,
    "current_step": "welcome",
}
RESET_PROFILE_FIELDS = {
    "onboarding_status": "not_started",
    "onboarding_progress": TRAINER_ONBOARDING_WELCOME_PROGRESS,
    "last_completed_step": None,
    "identity": {},
    "tone": {},
    "communication_preferences": {},
    "coaching_examples": [],
    "decision_weights": {},
    "scenario_rules": [],
    "philosophy": {},
    "non_negotiables": [],
    "boundaries": {},
    "media_assets": [],
    "calibration_examples": [],
    "retrain_draft": None,
    "retrain_started_at": None,
    "version": 1,
}


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Reset a trainer account back to the AI trainer onboarding flow.",
    )
    parser.add_argument("--email", required=True, help="Trainer auth email to reset.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print matched state without writing changes.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow resetting a non-@mode.local email.",
    )
    return parser


def _require_settings() -> None:
    missing = []
    if not str(settings.supabase_url or "").strip():
        missing.append("SUPABASE_URL")
    if not str(settings.supabase_service_role_key or "").strip():
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        raise RuntimeError("Missing required env var(s): " + ", ".join(missing))


def _execute(query: Any) -> Any:
    return query.execute()


def _rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    return data if isinstance(data, list) else []


def _select_rows(
    admin: Any,
    table: str,
    fields: str,
    *,
    filters: dict[str, Any],
    limit: int | None = None,
) -> list[dict[str, Any]]:
    query = admin.table(table).select(fields)
    for field, value in filters.items():
        query = query.eq(field, value)
    if limit is not None:
        query = query.limit(limit)
    return _rows(_execute(query))


def _select_one(
    admin: Any,
    table: str,
    fields: str,
    *,
    filters: dict[str, Any],
) -> dict[str, Any] | None:
    rows = _select_rows(admin, table, fields, filters=filters, limit=1)
    return rows[0] if rows else None


def _list_auth_users(admin: Any) -> list[Any]:
    users = admin.auth.admin.list_users()
    if isinstance(users, list):
        return users
    nested = getattr(users, "users", None)
    if isinstance(nested, list):
        return nested
    return []


def _auth_user_email(user: Any) -> str:
    if isinstance(user, dict):
        return str(user.get("email") or "")
    return str(getattr(user, "email", "") or "")


def _auth_user_id(user: Any) -> str:
    if isinstance(user, dict):
        return str(user.get("id") or "")
    return str(getattr(user, "id", "") or "")


def _find_auth_user_by_email(admin: Any, email: str) -> Any | None:
    normalized_email = email.strip().lower()
    for user in _list_auth_users(admin):
        if _auth_user_email(user).strip().lower() == normalized_email:
            return user
    return None


def _ensure_user_account(admin: Any, *, user_id: str, email: str, now: str) -> dict[str, Any]:
    existing = _select_one(
        admin,
        "user_accounts",
        "id, auth_user_id, email",
        filters={"auth_user_id": user_id},
    )
    if existing:
        if email and existing.get("email") != email:
            rows = _rows(
                _execute(
                    admin.table("user_accounts")
                    .update({"email": email, "updated_at": now})
                    .eq("id", existing["id"])
                )
            )
            return rows[0] if rows else {**existing, "email": email}
        return existing
    rows = _rows(
        _execute(
            admin.table("user_accounts").insert(
                {
                    "auth_user_id": user_id,
                    "email": email,
                }
            )
        )
    )
    if not rows:
        raise RuntimeError("Unable to create user account.")
    return rows[0]


def _ensure_user_role(admin: Any, *, user_account_id: str, now: str) -> dict[str, Any]:
    payload = {
        "role": "trainer",
        "is_active": True,
        "selected_at": now,
        "updated_at": now,
    }
    existing = _select_one(admin, "user_roles", "id", filters={"user_account_id": user_account_id})
    if existing:
        rows = _rows(
            _execute(admin.table("user_roles").update(payload).eq("id", existing["id"]))
        )
        return rows[0] if rows else {**existing, **payload}
    rows = _rows(
        _execute(
            admin.table("user_roles").insert(
                {
                    "user_account_id": user_account_id,
                    **payload,
                }
            )
        )
    )
    if not rows:
        raise RuntimeError("Unable to persist trainer role.")
    return rows[0]


def _ensure_onboarding_state(admin: Any, *, user_account_id: str, now: str) -> dict[str, Any]:
    payload = {
        "flow_key": TRAINER_STUB_FLOW_KEY,
        "status": "not_started",
        "current_step": TRAINER_STUB_STEP,
        "payload": {},
        "completed_at": None,
        "updated_at": now,
    }
    existing = _select_one(admin, "onboarding_states", "id", filters={"user_account_id": user_account_id})
    if existing:
        rows = _rows(
            _execute(admin.table("onboarding_states").update(payload).eq("id", existing["id"]))
        )
        return rows[0] if rows else {**existing, **payload}
    rows = _rows(
        _execute(
            admin.table("onboarding_states").insert(
                {
                    "user_account_id": user_account_id,
                    **payload,
                }
            )
        )
    )
    if not rows:
        raise RuntimeError("Unable to persist onboarding state.")
    return rows[0]


def _reset_trainer_profile(admin: Any, *, tenant_id: str, trainer_id: str, now: str) -> dict[str, Any]:
    payload = {
        "tenant_id": tenant_id,
        "trainer_id": trainer_id,
        **RESET_PROFILE_FIELDS,
        "updated_at": now,
    }
    rows = _rows(
        _execute(
            admin.table("trainer_onboarding_profiles")
            .upsert(payload, on_conflict="trainer_id")
        )
    )
    return rows[0] if rows else payload


def _clear_persona_onboarding_markers(admin: Any, *, trainer_id: str) -> list[dict[str, Any]]:
    personas = _select_rows(
        admin,
        "trainer_personas",
        "id, onboarding_preferences",
        filters={"trainer_id": trainer_id},
    )
    cleared: list[dict[str, Any]] = []
    for persona in personas:
        preferences = persona.get("onboarding_preferences")
        if not isinstance(preferences, dict):
            preferences = {}
        removed_keys = sorted(
            key for key in preferences.keys() if str(key).startswith("trainer_onboarding")
        )
        cleaned = {
            key: value
            for key, value in preferences.items()
            if not str(key).startswith("trainer_onboarding")
        }
        _execute(
            admin.table("trainer_personas")
            .update({"onboarding_preferences": cleaned})
            .eq("id", persona["id"])
        )
        cleared.append(
            {
                "id": persona["id"],
                "removed_keys": removed_keys,
                "onboarding_preferences": cleaned,
            }
        )
    return cleared


def _snapshot(admin: Any, *, user_id: str, trainer_id: str | None = None) -> dict[str, Any]:
    account = _select_one(
        admin,
        "user_accounts",
        "id, auth_user_id, email",
        filters={"auth_user_id": user_id},
    )
    role = None
    state = None
    if account:
        role = _select_one(
            admin,
            "user_roles",
            "id, role, is_active, selected_at",
            filters={"user_account_id": account["id"]},
        )
        state = _select_one(
            admin,
            "onboarding_states",
            "id, flow_key, status, current_step, payload, completed_at",
            filters={"user_account_id": account["id"]},
        )
    trainer = _select_one(
        admin,
        "trainers",
        "id, tenant_id, user_id, display_name, is_active, is_legacy",
        filters={"user_id": user_id},
    )
    resolved_trainer_id = trainer_id or (trainer.get("id") if trainer else None)
    profile = None
    personas: list[dict[str, Any]] = []
    if resolved_trainer_id:
        profile = _select_one(
            admin,
            "trainer_onboarding_profiles",
            "onboarding_status, onboarding_progress, last_completed_step, retrain_draft",
            filters={"trainer_id": resolved_trainer_id},
        )
        raw_personas = _select_rows(
            admin,
            "trainer_personas",
            "id, onboarding_preferences",
            filters={"trainer_id": resolved_trainer_id},
        )
        for persona in raw_personas:
            preferences = persona.get("onboarding_preferences")
            preferences = preferences if isinstance(preferences, dict) else {}
            personas.append(
                {
                    "id": persona.get("id"),
                    "trainer_onboarding_keys": sorted(
                        key for key in preferences.keys() if str(key).startswith("trainer_onboarding")
                    ),
                }
            )
    return {
        "account": account,
        "role": role,
        "onboarding_state": state,
        "trainer": trainer,
        "trainer_onboarding_profile": profile,
        "personas": personas,
    }


def reset_trainer_onboarding(
    *,
    email: str,
    dry_run: bool = False,
    force: bool = False,
    admin: Any | None = None,
    cache: Any | None = None,
) -> dict[str, Any]:
    normalized_email = email.strip().lower()
    if not normalized_email:
        raise RuntimeError("--email is required.")
    if not normalized_email.endswith("@mode.local") and not force:
        raise RuntimeError("Refusing to reset non-@mode.local email without --force.")

    if admin is None:
        _require_settings()
        admin = get_supabase_admin_client()

    user = _find_auth_user_by_email(admin, normalized_email)
    if not user:
        raise RuntimeError(f"Auth user not found for email: {normalized_email}")
    user_id = _auth_user_id(user)
    if not user_id:
        raise RuntimeError(f"Auth user id missing for email: {normalized_email}")

    trainer = _select_one(
        admin,
        "trainers",
        "id, tenant_id, user_id, display_name, is_active, is_legacy",
        filters={"user_id": user_id},
    )
    if not trainer:
        raise RuntimeError(f"Trainer row not found for email: {normalized_email}")

    before = _snapshot(admin, user_id=user_id, trainer_id=trainer["id"])
    cache_key = trainer_context_shared_cache_key(user_id)

    if dry_run:
        return {
            "dry_run": True,
            "email": normalized_email,
            "user_id": user_id,
            "trainer_id": trainer["id"],
            "shared_cache_key": cache_key,
            "before": before,
        }

    now = datetime.now(timezone.utc).isoformat()
    account = _ensure_user_account(admin, user_id=user_id, email=normalized_email, now=now)
    role = _ensure_user_role(admin, user_account_id=account["id"], now=now)
    state = _ensure_onboarding_state(admin, user_account_id=account["id"], now=now)

    _execute(admin.table("trainers").update({"is_legacy": False}).eq("id", trainer["id"]))
    profile = _reset_trainer_profile(
        admin,
        tenant_id=trainer["tenant_id"],
        trainer_id=trainer["id"],
        now=now,
    )
    cleared_personas = _clear_persona_onboarding_markers(admin, trainer_id=trainer["id"])

    cache_deleted = False
    if cache is None:
        cache = get_chat_cache()
    if cache is not None:
        cache.delete(cache_key)
        cache_deleted = True

    after = _snapshot(admin, user_id=user_id, trainer_id=trainer["id"])
    return {
        "dry_run": False,
        "email": normalized_email,
        "user_id": user_id,
        "trainer_id": trainer["id"],
        "shared_cache_key": cache_key,
        "cache_deleted": cache_deleted,
        "before": before,
        "writes": {
            "user_account": account,
            "user_role": role,
            "onboarding_state": state,
            "trainer_onboarding_profile": profile,
            "personas_cleared": cleared_personas,
        },
        "after": after,
    }


def _print_result(result: dict[str, Any]) -> None:
    print(json.dumps(result, indent=2, default=str, sort_keys=True))
    if not result.get("dry_run"):
        print("")
        print(
            "Warning: running backend processes may still have in-process trainer context cached "
            f"for up to {settings.tenant_context_cache_ttl_seconds} seconds. "
            "Restart the backend for immediate validation, then fully reload the app or sign in again."
        )


def main() -> int:
    args = _build_parser().parse_args()
    try:
        result = reset_trainer_onboarding(
            email=args.email,
            dry_run=args.dry_run,
            force=args.force,
        )
        _print_result(result)
    except Exception as exc:
        print(f"reset_trainer_onboarding failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
