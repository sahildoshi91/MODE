#!/usr/bin/env python3
"""
Scan iOS release artifacts (IPA) for secrets, staging endpoints, and debug/test leakage.
"""

from __future__ import annotations

import argparse
import os
import plistlib
import re
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MAX_PLIST_BYTES = 5 * 1024 * 1024
STREAM_CHUNK_BYTES = 1024 * 1024
TEXT_SCAN_OVERLAP_BYTES = 8192
BLOCKED_GENERIC_SCHEMES = {"app", "myapp", "test", "demo", "example", "sample"}
SCHEME_PATTERN = re.compile(r"^[a-z][a-z0-9+.-]{2,}$")

PATTERN_GROUPS: dict[str, list[re.Pattern[str]]] = {
    "service_role_or_secret_keys": [
        re.compile(r"EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", re.IGNORECASE),
        re.compile(r"SUPABASE_SERVICE_ROLE_KEY", re.IGNORECASE),
        re.compile(r"\bsb_secret_[A-Za-z0-9._-]{20,}\b"),
    ],
    "private_api_keys": [
        re.compile(r"\bsk_live_[A-Za-z0-9]{16,}\b"),
        re.compile(r"\bsk-proj-[A-Za-z0-9_-]{16,}\b"),
        re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b"),
        re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    ],
    "staging_or_local_urls": [
        re.compile(r"https?://(?:localhost|127\.0\.0\.1|staging)[^\"'\s>]*", re.IGNORECASE),
        re.compile(r"https?://(?:192\.168\.|10\.|172\.16\.)[^\"'\s>]*", re.IGNORECASE),
        re.compile(r"https?://[^\"'\s>]*(?:\.dev|dev\.|development)[^\"'\s>]*", re.IGNORECASE),
    ],
    "stale_expo_metadata": [
        re.compile(r"\bEXSDKVersion\b", re.IGNORECASE),
        re.compile(r"\bsdkVersion\b", re.IGNORECASE),
        re.compile(r"host\.exp\.Exponent", re.IGNORECASE),
    ],
    "debug_flags_or_verbose_logs": [
        re.compile(r"\b__DEV__\b"),
        re.compile(r"SHOW_DEV_CONNECTION_DEBUG"),
        re.compile(r"EXPO_PUBLIC_SHOW_ACCOUNT_DIAGNOSTICS\s*=\s*true", re.IGNORECASE),
        re.compile(r"console\.log\s*\("),
    ],
    "test_users_or_fixtures": [
        re.compile(r"mode-stage-", re.IGNORECASE),
        re.compile(r"\btest-user\b", re.IGNORECASE),
        re.compile(r"trainer-token|client-token", re.IGNORECASE),
    ],
}

TEXTUAL_EXTENSIONS = {
    ".js",
    ".jsbundle",
    ".bundle",
    ".map",
    ".json",
    ".plist",
    ".txt",
    ".xml",
    ".html",
    ".env",
    ".strings",
    ".cfg",
}


FindingKey = tuple[str, str]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scan IPA artifact for security leakage patterns")
    parser.add_argument("--ipa", default=None, help="Path to IPA artifact (or MODE_IOS_IPA_PATH env)")
    parser.add_argument(
        "--require-ipa",
        action="store_true",
        help="Fail when IPA path is missing",
    )
    return parser


def _resolve_ipa_path(path_override: str | None) -> Path | None:
    raw = str(path_override or "").strip() or str(os.getenv("MODE_IOS_IPA_PATH") or "").strip()
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        path = (REPO_ROOT / path).resolve()
    return path


def _scan_text(
    content: str,
    *,
    file_name: str,
    findings: list[str],
    seen_findings: set[FindingKey],
) -> None:
    for category, patterns in PATTERN_GROUPS.items():
        finding_key = (category, file_name)
        if finding_key in seen_findings:
            continue
        for pattern in patterns:
            if pattern.search(content):
                findings.append(f"{category}:{file_name}:{pattern.pattern}")
                seen_findings.add(finding_key)
                break


def _scan_text_stream(
    handle,
    *,
    file_name: str,
    findings: list[str],
    seen_findings: set[FindingKey],
) -> None:
    carry = b""
    while True:
        chunk = handle.read(STREAM_CHUNK_BYTES)
        if not chunk:
            break

        window = carry + chunk
        text = window.decode("utf-8", errors="ignore")
        if text:
            _scan_text(text, file_name=file_name, findings=findings, seen_findings=seen_findings)
        carry = window[-TEXT_SCAN_OVERLAP_BYTES:]


def _scan_info_plist(payload: dict, *, file_name: str, findings: list[str]) -> None:
    ats = payload.get("NSAppTransportSecurity")
    if not isinstance(ats, dict):
        findings.append(f"unsafe_ats_config:{file_name}:NSAppTransportSecurity_missing")
    else:
        if bool(ats.get("NSAllowsArbitraryLoads")):
            findings.append(f"unsafe_ats_config:{file_name}:NSAllowsArbitraryLoads_true")
        exception_domains = ats.get("NSExceptionDomains")
        if isinstance(exception_domains, dict):
            for domain, config in exception_domains.items():
                if isinstance(config, dict) and bool(config.get("NSExceptionAllowsInsecureHTTPLoads")):
                    findings.append(
                        f"unsafe_ats_config:{file_name}:NSExceptionAllowsInsecureHTTPLoads_true:{domain}"
                    )

    url_types = payload.get("CFBundleURLTypes")
    schemes: set[str] = set()
    if isinstance(url_types, list):
        for item in url_types:
            if not isinstance(item, dict):
                continue
            row_schemes = item.get("CFBundleURLSchemes")
            if not isinstance(row_schemes, list):
                continue
            for scheme in row_schemes:
                normalized = str(scheme or "").strip().lower()
                if normalized:
                    schemes.add(normalized)

    if not schemes:
        findings.append(f"unsafe_deep_link_config:{file_name}:CFBundleURLTypes_missing")
        return

    for scheme in sorted(schemes):
        if scheme in {"http", "https"}:
            findings.append(f"unsafe_deep_link_config:{file_name}:http_scheme_disallowed:{scheme}")
            continue
        if scheme in BLOCKED_GENERIC_SCHEMES:
            findings.append(f"unsafe_deep_link_config:{file_name}:generic_scheme:{scheme}")
            continue
        if not SCHEME_PATTERN.match(scheme):
            findings.append(f"unsafe_deep_link_config:{file_name}:invalid_scheme:{scheme}")


def _scan_plist(raw_bytes: bytes, *, file_name: str, findings: list[str]) -> None:
    try:
        payload = plistlib.loads(raw_bytes)
    except Exception:
        return
    if not isinstance(payload, dict):
        return
    _scan_info_plist(payload, file_name=file_name, findings=findings)


def _should_scan_text_member(info: zipfile.ZipInfo) -> bool:
    suffix = Path(info.filename).suffix.lower()
    return suffix in TEXTUAL_EXTENSIONS or info.file_size <= MAX_PLIST_BYTES


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    ipa_path = _resolve_ipa_path(args.ipa)
    if ipa_path is None:
        if args.require_ipa:
            print("iOS artifact scan: FAILED")
            print("- IPA path is required (use --ipa or MODE_IOS_IPA_PATH)")
            return 1
        print("iOS artifact scan: SKIPPED (no IPA path provided)")
        return 0

    if not ipa_path.exists():
        print("iOS artifact scan: FAILED")
        print(f"- IPA file does not exist: {ipa_path}")
        return 1

    findings: list[str] = []
    seen_findings: set[FindingKey] = set()
    try:
        with zipfile.ZipFile(ipa_path, "r") as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                file_name = info.filename

                if file_name.endswith("Info.plist"):
                    if info.file_size > MAX_PLIST_BYTES:
                        findings.append(f"unsafe_ats_config:{file_name}:Info.plist_too_large")
                    else:
                        with archive.open(info, "r") as handle:
                            raw_bytes = handle.read(MAX_PLIST_BYTES + 1)
                        if len(raw_bytes) <= MAX_PLIST_BYTES:
                            _scan_plist(raw_bytes, file_name=file_name, findings=findings)

                if not _should_scan_text_member(info):
                    continue

                with archive.open(info, "r") as handle:
                    _scan_text_stream(
                        handle,
                        file_name=file_name,
                        findings=findings,
                        seen_findings=seen_findings,
                    )
    except Exception as exc:
        print("iOS artifact scan: FAILED")
        print(f"- Unable to scan IPA: {exc}")
        return 1

    if findings:
        print("iOS artifact scan: FAILED")
        for finding in findings[:100]:
            print(f"- {finding}")
        if len(findings) > 100:
            print(f"- ... and {len(findings) - 100} more findings")
        return 1

    print("iOS artifact scan: PASSED")
    print(f"Scanned IPA: {ipa_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
