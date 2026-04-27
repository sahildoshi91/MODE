#!/usr/bin/env python3
"""
iOS hardening lint checks (Expo config + optional prebuild Info.plist).
"""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_JSON_PATH = REPO_ROOT / "app.json"
BLOCKED_GENERIC_SCHEMES = {"app", "myapp", "test", "demo", "example", "sample"}
ALLOWED_ASSOCIATED_DOMAIN_PREFIXES = ("applinks:", "webcredentials:")
SENSITIVE_LOG_IDENTIFIER_PATTERN = re.compile(
    r"\b(access_?token|refresh_?token|authorization|bearer|email|prompt|chat(_message|_content|_text)?|"
    r"injury|health(_note)?|service_role|sb_secret_)\b",
    re.IGNORECASE,
)
SENSITIVE_LOG_FORMAT_PATTERN = re.compile(
    r"\b(access_?token|refresh_?token|authorization|email|prompt|chat|injury|health|service_role)\s*=\s*%[sr]",
    re.IGNORECASE,
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run iOS runtime hardening lint checks")
    parser.add_argument(
        "--info-plist",
        default=None,
        help="Optional path to prebuild Info.plist (or use MODE_IOS_INFO_PLIST_PATH)",
    )
    parser.add_argument(
        "--require-prebuild",
        action="store_true",
        help="Fail if prebuild Info.plist cannot be located",
    )
    return parser


def _load_app_json() -> dict:
    if not APP_JSON_PATH.exists():
        raise RuntimeError(f"app.json not found at {APP_JSON_PATH}")
    payload = json.loads(APP_JSON_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("expo"), dict):
        raise RuntimeError("app.json must contain an `expo` object")
    return payload["expo"]


def _find_info_plist(path_override: str | None) -> Path | None:
    candidate = str(path_override or "").strip() or str(os.getenv("MODE_IOS_INFO_PLIST_PATH") or "").strip()
    if candidate:
        path = Path(candidate)
        if path.exists():
            return path
        return None

    ios_dir = REPO_ROOT / "ios"
    if not ios_dir.exists():
        return None
    matches = sorted(ios_dir.rglob("Info.plist"))
    return matches[0] if matches else None


def _assert_ats(settings_map: dict, failures: list[str], *, location: str) -> None:
    ats = settings_map.get("NSAppTransportSecurity")
    if not isinstance(ats, dict):
        failures.append(f"{location}: NSAppTransportSecurity is missing")
        return

    if bool(ats.get("NSAllowsArbitraryLoads")):
        failures.append(f"{location}: NSAllowsArbitraryLoads must be false")

    exception_domains = ats.get("NSExceptionDomains")
    if isinstance(exception_domains, dict):
        for domain, config in exception_domains.items():
            if not isinstance(config, dict):
                continue
            if bool(config.get("NSExceptionAllowsInsecureHTTPLoads")):
                failures.append(
                    f"{location}: NSExceptionAllowsInsecureHTTPLoads must be false for domain {domain}"
                )


def _assert_deep_link_security(expo: dict, failures: list[str]) -> None:
    scheme = str(expo.get("scheme") or "").strip().lower()
    if not scheme:
        failures.append("expo.scheme is required for secure auth callback handling")
        return

    if not re.match(r"^[a-z][a-z0-9+.-]{2,}$", scheme):
        failures.append("expo.scheme must use a strict RFC-compliant custom URL scheme")
    if scheme in BLOCKED_GENERIC_SCHEMES:
        failures.append(f"expo.scheme is too generic and can be hijacked: {scheme}")

    ios_config = expo.get("ios") if isinstance(expo.get("ios"), dict) else {}
    associated_domains = ios_config.get("associatedDomains")
    if not isinstance(associated_domains, list) or not associated_domains:
        failures.append("expo.ios.associatedDomains must be configured with at least one applinks/webcredentials domain")
    else:
        for entry in associated_domains:
            value = str(entry or "").strip()
            if not value.startswith(ALLOWED_ASSOCIATED_DOMAIN_PREFIXES):
                failures.append(f"Invalid associated domain entry: {value}")

    redirect_url = str(
        os.getenv("EXPO_PUBLIC_SUPABASE_REDIRECT_URL")
        or _env_file_value("EXPO_PUBLIC_SUPABASE_REDIRECT_URL")
        or ""
    ).strip()
    if not redirect_url:
        failures.append("EXPO_PUBLIC_SUPABASE_REDIRECT_URL is required for callback hijack checks")
        return

    if "*" in redirect_url:
        failures.append("EXPO_PUBLIC_SUPABASE_REDIRECT_URL must not use wildcards")
    if "?" in redirect_url or "#" in redirect_url:
        failures.append("EXPO_PUBLIC_SUPABASE_REDIRECT_URL must not include query/fragment components")
    if not redirect_url.lower().startswith(f"{scheme}://"):
        failures.append(
            f"EXPO_PUBLIC_SUPABASE_REDIRECT_URL scheme must match expo.scheme ({scheme})"
        )
    if not redirect_url.lower().endswith("/auth/callback"):
        failures.append("EXPO_PUBLIC_SUPABASE_REDIRECT_URL must end with /auth/callback")


def _env_file_value(key: str) -> str | None:
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return None
    for raw_line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() == key:
            return value.strip()
    return None


def _assert_logging_redaction(failures: list[str]) -> None:
    skip_dirs = {
        "node_modules",
        ".git",
        "__tests__",
        "tests",
        "venv",
        ".venv",
        "build",
        "dist",
    }
    source_paths = [
        path
        for path in REPO_ROOT.rglob("*")
        if path.is_file()
        and path.suffix.lower() in {".js", ".ts", ".tsx", ".py"}
        and not any(part in skip_dirs for part in path.parts)
    ]
    log_call_pattern = re.compile(r"\b(console\.(log|warn|error)|logger\.(debug|info|warning|error|exception))\b")
    findings = []
    for path in source_paths:
        rel = path.relative_to(REPO_ROOT).as_posix()
        text = path.read_text(encoding="utf-8", errors="ignore")
        for line_number, line in enumerate(text.splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("#") or stripped.startswith("//") or stripped.startswith("/*"):
                continue
            lowered = line.lower()
            if not log_call_pattern.search(line):
                continue
            if "sb_secret_" in lowered:
                findings.append(f"{rel}:{line_number}:{line.strip()}")
                continue
            if SENSITIVE_LOG_FORMAT_PATTERN.search(line):
                findings.append(f"{rel}:{line_number}:{line.strip()}")
                continue

            # Guard against argument-based leaks such as logger.info("...", email, access_token)
            call_args = line.split("(", 1)[1] if "(" in line else line
            if "," in call_args:
                trailing_args = call_args.split(",", 1)[1]
                if SENSITIVE_LOG_IDENTIFIER_PATTERN.search(trailing_args):
                    findings.append(f"{rel}:{line_number}:{line.strip()}")
                    continue

            # Guard against direct f-string interpolation of sensitive fields.
            if "f\"" in line or "f'" in line:
                if re.search(
                    r"\{[^}]*\b(access_?token|refresh_?token|authorization|email|prompt|chat(_message|_content|_text)?|"
                    r"injury|health(_note)?|service_role|sb_secret_)\b[^}]*\}",
                    line,
                    re.IGNORECASE,
                ):
                    findings.append(f"{rel}:{line_number}:{line.strip()}")
                    continue

    if findings:
        failures.append("Sensitive logging patterns detected:\n  - " + "\n  - ".join(findings[:20]))


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    failures: list[str] = []
    try:
        expo = _load_app_json()
    except Exception as exc:
        print(f"iOS hardening lint: FAILED\n- {exc}")
        return 1

    ios_config = expo.get("ios") if isinstance(expo.get("ios"), dict) else {}
    info_plist_map = ios_config.get("infoPlist") if isinstance(ios_config.get("infoPlist"), dict) else {}
    _assert_ats(info_plist_map, failures, location="app.json expo.ios.infoPlist")
    _assert_deep_link_security(expo, failures)
    _assert_logging_redaction(failures)

    info_plist_path = _find_info_plist(args.info_plist)
    if args.require_prebuild and info_plist_path is None:
        failures.append("Prebuild Info.plist is required but was not found (set MODE_IOS_INFO_PLIST_PATH)")
    if info_plist_path is not None:
        try:
            with info_plist_path.open("rb") as handle:
                plist_payload = plistlib.load(handle)
            if isinstance(plist_payload, dict):
                _assert_ats(plist_payload, failures, location=str(info_plist_path))
        except Exception as exc:
            failures.append(f"Unable to parse Info.plist at {info_plist_path}: {exc}")

    if failures:
        print("iOS hardening lint: FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("iOS hardening lint: PASSED")
    if info_plist_path is not None:
        print(f"Validated prebuild Info.plist: {info_plist_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
