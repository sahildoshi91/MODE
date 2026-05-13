#!/usr/bin/env python3
"""Create and validate staging-only launch smoke auth tokens."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from supabase import create_client
from supabase.lib.client_options import SyncClientOptions

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings
from app.db.client import get_supabase_admin_client


@dataclass(frozen=True)
class SmokeFixture:
    trainer_user_id: str
    client_user_id: str
    tenant_id: str
    trainer_id: str
    client_id: str
    client_email: str
    access_token: str


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage staging launch-smoke auth tokens.")
    parser.add_argument(
        "--expected-supabase-ref",
        help="Optional Supabase project ref guard, for example abcdefghijklmnopqrst.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create-token", help="Create a trainer/client fixture and print a client JWT export.")
    create.add_argument("--prefix", help="Optional email/record prefix. Defaults to launch_smoke_<random>.")
    create.add_argument("--output", choices=("pretty", "json", "export"), default="pretty")

    validate = subparsers.add_parser("validate-token", help="Validate MODE_STAGING_AUTH_TOKEN against SUPABASE_URL.")
    validate.add_argument("--token", default=os.getenv("MODE_STAGING_AUTH_TOKEN"))

    subparsers.add_parser("probe-admin-create-user", help="Create and delete one auth user with the service-role key.")
    return parser


def _require_settings(*names: str) -> None:
    missing = []
    for name in names:
        value = getattr(settings, name.lower(), None)
        if not str(value or "").strip():
            missing.append(name)
    if missing:
        raise RuntimeError("Missing required staging env var(s): " + ", ".join(missing))


def _supabase_project_ref() -> str:
    host = urlparse(str(settings.supabase_url or "")).hostname or ""
    if not host.endswith(".supabase.co"):
        raise RuntimeError("SUPABASE_URL does not look like a Supabase project URL.")
    return host.split(".", 1)[0]


def _require_staging(expected_supabase_ref: str | None = None) -> None:
    if str(settings.app_env or "").strip().lower() != "staging":
        raise RuntimeError(f"Refusing to run unless APP_ENV=staging; got {settings.app_env!r}.")
    _require_settings("SUPABASE_URL")
    project_ref = _supabase_project_ref()
    if expected_supabase_ref and project_ref != expected_supabase_ref:
        raise RuntimeError(
            "SUPABASE_URL project ref mismatch: "
            f"expected {expected_supabase_ref!r}, got {project_ref!r}."
        )


def _anon_client():
    _require_settings("SUPABASE_ANON_KEY")
    return create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
        options=SyncClientOptions(auto_refresh_token=False, persist_session=False),
    )


def _create_auth_user(admin: object, *, email: str, password: str) -> str:
    response = admin.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
        }
    )
    return str(response.user.id)


def _create_token(*, prefix: str | None) -> SmokeFixture:
    _require_staging()
    _require_settings("SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY")
    run_id = uuid4().hex
    record_prefix = prefix or f"launch_smoke_{run_id[:10]}"
    password = f"ModeStage!{run_id[:12]}"
    trainer_email = f"{record_prefix}_trainer@example.com"
    client_email = f"{record_prefix}_client@example.com"

    admin = get_supabase_admin_client()
    anon = _anon_client()
    trainer_user_id = _create_auth_user(admin, email=trainer_email, password=password)
    client_user_id = _create_auth_user(admin, email=client_email, password=password)

    tenant = admin.rpc(
        "bootstrap_trainer_tenant",
        {
            "trainer_user_id": trainer_user_id,
            "tenant_name": f"{record_prefix}_tenant",
            "tenant_slug": f"{record_prefix}-tenant",
            "trainer_display_name": f"{record_prefix}_trainer",
            "default_persona_name": f"{record_prefix}_persona",
            "tone_description": "Warm, direct, practical.",
            "coaching_philosophy": "Temporary launch gate smoke fixture.",
        },
    ).execute().data[0]

    assignment = admin.rpc(
        "assign_client_to_trainer",
        {
            "client_user_id": client_user_id,
            "trainer_record_id": str(tenant["trainer_id"]),
        },
    ).execute().data[0]

    session = anon.auth.sign_in_with_password({"email": client_email, "password": password}).session
    if not session or not session.access_token:
        raise RuntimeError("Failed to sign in generated client user.")

    return SmokeFixture(
        trainer_user_id=trainer_user_id,
        client_user_id=client_user_id,
        tenant_id=str(tenant["tenant_id"]),
        trainer_id=str(tenant["trainer_id"]),
        client_id=str(assignment["client_id"]),
        client_email=client_email,
        access_token=str(session.access_token),
    )


def _validate_token(token: str | None) -> dict[str, str | bool | None]:
    _require_staging()
    _require_settings("SUPABASE_ANON_KEY")
    normalized_token = str(token or "").strip()
    if not normalized_token:
        raise RuntimeError("MODE_STAGING_AUTH_TOKEN or --token is required.")
    client = create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
        options=SyncClientOptions(
            auto_refresh_token=False,
            persist_session=False,
            headers={"Authorization": f"Bearer {normalized_token}"},
        ),
    )
    user = client.auth.get_user(normalized_token).user
    return {
        "token_ok": True,
        "user_id": str(user.id),
        "email": getattr(user, "email", None),
    }


def _probe_admin_create_user() -> dict[str, str | bool]:
    _require_staging()
    _require_settings("SUPABASE_SERVICE_ROLE_KEY")
    admin = get_supabase_admin_client()
    email = f"auth_probe_{uuid4().hex[:10]}@example.com"
    user_id: str | None = None
    try:
        user = admin.auth.admin.create_user(
            {
                "email": email,
                "password": "ModeStage!Probe123",
                "email_confirm": True,
            }
        ).user
        user_id = str(user.id)
        return {"admin_create_user_ok": True, "user_id": user_id, "cleanup_ok": True}
    finally:
        if user_id:
            admin.auth.admin.delete_user(user_id)


def _print_fixture(fixture: SmokeFixture, *, output: str) -> None:
    payload = asdict(fixture)
    if output == "json":
        print(json.dumps(payload, indent=2, default=str))
        return
    if output == "export":
        print(f"export MODE_STAGING_AUTH_TOKEN='{fixture.access_token}'")
        return

    print("")
    print("Generated staging launch-smoke fixture")
    print(f"trainer_user_id={fixture.trainer_user_id}")
    print(f"client_user_id={fixture.client_user_id}")
    print(f"tenant_id={fixture.tenant_id}")
    print(f"trainer_id={fixture.trainer_id}")
    print(f"client_id={fixture.client_id}")
    print(f"client_email={fixture.client_email}")
    print("")
    print("Run this export in your terminal:")
    print(f"export MODE_STAGING_AUTH_TOKEN='{fixture.access_token}'")


def main() -> int:
    args = _build_parser().parse_args()
    try:
        _require_staging(args.expected_supabase_ref)
        if args.command == "create-token":
            _print_fixture(_create_token(prefix=args.prefix), output=args.output)
        elif args.command == "validate-token":
            print(json.dumps(_validate_token(args.token), indent=2, default=str))
        elif args.command == "probe-admin-create-user":
            print(json.dumps(_probe_admin_create_user(), indent=2, default=str))
        else:  # pragma: no cover - argparse prevents this branch.
            raise RuntimeError(f"Unknown command: {args.command}")
    except Exception as exc:
        print(f"staging_auth_smoke_token failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
