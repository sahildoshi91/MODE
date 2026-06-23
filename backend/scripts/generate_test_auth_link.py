#!/usr/bin/env python3
"""
Generate an inbox-free Supabase auth link for QA testing.

Example:
  cd backend
  ./venv/bin/python scripts/generate_test_auth_link.py \
    --email cyhfanzbckdqbtwgkv@jbsze.ne \
    --redirect-to ai.modefit.app://auth/callback \
    --check-auth-settings \
    --output pretty
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests

# Allow direct execution from backend/scripts without requiring PYTHONPATH tweaks.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings
from app.db.client import get_supabase_admin_client


def _parse_bool(raw_value: str) -> bool:
    normalized = str(raw_value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise argparse.ArgumentTypeError(
        "Expected one of: true/false, 1/0, yes/no, on/off.",
    )


def _fetch_auth_settings() -> dict[str, bool]:
    if not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is required to check auth settings.")
    if not settings.supabase_service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required to check auth settings.")

    settings_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/settings"
    try:
        response = requests.get(
            settings_url,
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
            timeout=20,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Failed to reach Supabase auth settings: {exc}") from exc

    if response.status_code >= 400:
        raise RuntimeError(
            f"Failed to read auth settings ({response.status_code}): {response.text}",
        )
    payload = response.json()

    external = payload.get("external") if isinstance(payload, dict) else {}
    external = external if isinstance(external, dict) else {}
    return {
        "email": bool(external.get("email")),
        "google": bool(external.get("google")),
        "apple": bool(external.get("apple")),
    }


def _print_pretty(result: dict) -> None:
    auth_settings = result.get("auth_settings")
    if isinstance(auth_settings, dict):
        print("Auth provider settings:")
        print(f"  email:  {auth_settings.get('email')}")
        print(f"  google: {auth_settings.get('google')}")
        print(f"  apple:  {auth_settings.get('apple')}")
        print()

    print("Generated test auth payload:")
    print(f"  email:                 {result.get('email')}")
    print(f"  user_id:               {result.get('user_id')}")
    print(f"  verification_type:     {result.get('verification_type')}")
    print(f"  requested_redirect_to: {result.get('requested_redirect_to')}")
    print(f"  actual_redirect_to:    {result.get('actual_redirect_to')}")
    print(f"  redirect_mismatch:     {result.get('redirect_mismatch')}")
    print(f"  action_link:           {result.get('action_link')}")
    print(f"  email_otp:             {result.get('email_otp')}")
    print(f"  hashed_token:          {result.get('hashed_token')}")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a Supabase admin auth link + OTP for a test email "
            "without using a real inbox."
        )
    )
    parser.add_argument("--email", required=True, help="Email address to target.")
    parser.add_argument(
        "--redirect-to",
        default="ai.modefit.app://auth/callback",
        help="Desired post-verification redirect URL.",
    )
    parser.add_argument(
        "--type",
        dest="verification_type",
        default="magiclink",
        choices=["magiclink", "signup", "recovery", "invite", "email_change_current", "email_change_new"],
        help="Supabase link type to generate.",
    )
    parser.add_argument(
        "--output",
        default="json",
        choices=["json", "pretty"],
        help="Output format. Default: json",
    )
    parser.add_argument(
        "--fail-on-redirect-mismatch",
        type=_parse_bool,
        default=True,
        help="Return exit code 2 when requested redirect does not match actual redirect. Default: true",
    )
    parser.add_argument(
        "--check-auth-settings",
        action="store_true",
        help="Fetch and include email/google/apple provider enabled states before link generation.",
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    auth_settings = None
    if args.check_auth_settings:
        try:
            auth_settings = _fetch_auth_settings()
        except Exception as exc:  # pragma: no cover - defensive wrapper for CLI ergonomics
            print(f"Failed to check auth settings: {exc}", file=sys.stderr)
            return 1

    admin = get_supabase_admin_client()

    payload = {
        "type": args.verification_type,
        "email": args.email,
        # Keep both forms for compatibility across auth SDK revisions.
        "redirect_to": args.redirect_to,
        "options": {"redirect_to": args.redirect_to},
    }

    try:
        response = admin.auth.admin.generate_link(payload)
    except Exception as exc:  # pragma: no cover - defensive wrapper for CLI ergonomics
        print(f"Failed to generate auth link: {exc}", file=sys.stderr)
        return 1

    properties = response.properties
    user = response.user
    redirect_mismatch = getattr(properties, "redirect_to", None) != args.redirect_to
    output = {
        "email": args.email,
        "user_id": getattr(user, "id", None),
        "verification_type": getattr(properties, "verification_type", None),
        "requested_redirect_to": args.redirect_to,
        "actual_redirect_to": getattr(properties, "redirect_to", None),
        "redirect_mismatch": redirect_mismatch,
        "action_link": getattr(properties, "action_link", None),
        "email_otp": getattr(properties, "email_otp", None),
        "hashed_token": getattr(properties, "hashed_token", None),
    }
    if auth_settings is not None:
        output["auth_settings"] = auth_settings

    if args.output == "pretty":
        _print_pretty(output)
    else:
        print(json.dumps(output, indent=2, default=str))

    if redirect_mismatch:
        print(
            "WARNING: redirect URL fallback detected. "
            "Check Supabase Auth URL allow-list and Site URL configuration.",
            file=sys.stderr,
        )
    if redirect_mismatch and args.fail_on_redirect_mismatch:
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
