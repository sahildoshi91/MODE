#!/usr/bin/env python3
"""Launch Gate / Staging Verification runner.

The runner is intentionally conservative: live destructive/account-deletion and
LLM/load checks only run when explicitly requested.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from uuid import uuid4

import httpx

from apply_launch_gate_migrations import _read_validated_sql_files


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
CHAT_STREAM_PATH = "/api/v1/chat/stream"

STATIC_TEST_TARGETS = (
    "tests/test_security_phase_e.py::SecurityPhaseETests::test_service_role_key_not_used_in_request_handler",
    "tests/test_security_phase_e.py::SecurityPhaseETests::test_storage_private_is_only_api_handler_service_role_exception",
    "tests/test_security_phase_e.py::SecurityPhaseETests::test_service_role_key_not_used_in_request_time_foundations",
    "tests/test_security_phase_e.py::SecurityPhaseETests::test_dependency_admin_factories_are_internal_only",
    "tests/test_security_hardening_migrations_static.py::test_service_role_retirement_migration_adds_authenticated_storage_and_deletion_rls",
    "tests/test_security_release_preflight_static.py",
    "tests/test_staging_db_security_check_static.py",
)


@dataclass
class CheckResult:
    name: str
    status: str
    detail: str = ""
    metrics: dict[str, Any] = field(default_factory=dict)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Launch Gate / Staging Verification checks.")
    parser.add_argument(
        "--base-url",
        default=os.getenv("MODE_STAGING_API_BASE_URL") or os.getenv("EXPO_PUBLIC_API_BASE_URL") or "http://127.0.0.1:8000",
        help="Backend origin to verify.",
    )
    parser.add_argument("--auth-token", default=os.getenv("MODE_STAGING_AUTH_TOKEN"))
    parser.add_argument(
        "--auth-token-file",
        default=os.getenv("MODE_STAGING_AUTH_TOKEN_FILE"),
        help="Optional file with one bearer token per line for chat load.",
    )
    parser.add_argument("--timeout-seconds", type=float, default=8.0)
    parser.add_argument("--health-probes", type=int, default=5)
    parser.add_argument("--health-target-ms", type=int, default=100)
    parser.add_argument("--local", action="store_true", help="Allow degraded health and skipped live gates.")
    parser.add_argument("--allow-degraded-health", action="store_true")
    parser.add_argument("--skip-static-tests", action="store_true")
    parser.add_argument("--skip-route-surface", action="store_true")
    parser.add_argument("--skip-db-security", action="store_true")
    parser.add_argument("--skip-chat-smoke", action="store_true")
    parser.add_argument("--run-storage-smoke", action="store_true")
    parser.add_argument("--storage-scope", default="client_self", choices=("client_self", "trainer_workspace", "trainer_client"))
    parser.add_argument("--storage-client-id", default=os.getenv("MODE_STAGING_STORAGE_CLIENT_ID"))
    parser.add_argument("--run-account-deletion-enqueue-smoke", action="store_true")
    parser.add_argument("--chat-load-requests", type=int, default=0)
    parser.add_argument("--chat-load-concurrency", type=int, default=1)
    parser.add_argument("--ttft-target-ms", type=int, default=2500)
    return parser


def _percentile(values: list[int], percentile: int) -> int | None:
    if not values:
        return None
    sorted_values = sorted(values)
    index = max(0, min(len(sorted_values) - 1, math.ceil((percentile / 100) * len(sorted_values)) - 1))
    return sorted_values[index]


def _request(
    base_url: str,
    path: str,
    *,
    timeout: float,
    method: str = "GET",
    token: str | None = None,
    body: dict[str, Any] | None = None,
) -> tuple[int, str, int]:
    headers = {"Accept": "application/json"}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    url = urljoin(f"{base_url.rstrip('/')}/", path.lstrip("/"))
    started = time.perf_counter()
    req = Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urlopen(req, timeout=timeout) as response:
            payload = response.read().decode("utf-8", errors="replace")
            return int(response.getcode()), payload, int((time.perf_counter() - started) * 1000)
    except HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        return int(exc.code), payload, int((time.perf_counter() - started) * 1000)
    except (TimeoutError, socket.timeout, URLError, OSError) as exc:
        raise RuntimeError(str(exc)) from exc


def _run_command(name: str, command: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> CheckResult:
    completed = subprocess.run(
        command,
        cwd=cwd,
        env={**os.environ, **(env or {})},
        check=False,
        capture_output=True,
        text=True,
    )
    output = (completed.stdout + completed.stderr).strip()
    if completed.returncode == 0:
        return CheckResult(name, "PASS", output[-1200:])
    return CheckResult(name, "FAIL", output[-4000:])


def _validate_sql() -> CheckResult:
    try:
        loaded = _read_validated_sql_files()
    except RuntimeError as exc:
        return CheckResult("migration_sql_validation", "FAIL", str(exc))
    return CheckResult(
        "migration_sql_validation",
        "PASS",
        "Validated launch SQL files; JSONB casts use ::jsonb.",
        {"files": [path.name for path, _ in loaded]},
    )


def _health_check(args: argparse.Namespace) -> CheckResult:
    client_durations: list[int] = []
    server_durations: list[int] = []
    payloads: list[dict[str, Any]] = []
    failures: list[str] = []
    client_latency_notes: list[str] = []
    required_fields = {"status", "ok", "db", "redis", "queue", "duration_ms", "checks", "cache_age_ms"}
    for _ in range(max(1, int(args.health_probes))):
        try:
            status, body, duration_ms = _request(args.base_url, "/healthz", timeout=args.timeout_seconds)
        except RuntimeError as exc:
            failures.append(str(exc))
            continue
        client_durations.append(duration_ms)
        if status != 200:
            failures.append(f"/healthz returned {status}: {body[:200]}")
            continue
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            failures.append(f"/healthz did not return JSON: {body[:200]}")
            continue
        payloads.append(payload)
        missing_fields = sorted(required_fields - set(payload.keys()))
        if missing_fields:
            failures.append(
                "/healthz returned a stale or legacy payload missing current structured fields: "
                + ", ".join(missing_fields)
            )
            continue
        checks = payload.get("checks")
        if not isinstance(checks, dict) or not {"db", "redis", "queue"}.issubset(checks.keys()):
            failures.append("/healthz structured payload is missing checks.db/checks.redis/checks.queue")
            continue
        try:
            server_durations.append(int(payload.get("duration_ms")))
        except (TypeError, ValueError):
            failures.append("/healthz duration_ms must be an integer")
            continue
        allow_degraded = bool(args.local or args.allow_degraded_health)
        if not allow_degraded and payload.get("ok") is not True:
            failures.append(f"/healthz not ok: {json.dumps(payload, default=str)[:500]}")

    client_p95 = _percentile(client_durations, 95)
    server_p95 = _percentile(server_durations, 95)
    if server_p95 is not None and server_p95 > int(args.health_target_ms):
        failures.append(f"/healthz server duration p95 {server_p95}ms exceeds target {args.health_target_ms}ms")
    if (
        client_p95 is not None
        and client_p95 > int(args.health_target_ms)
        and (server_p95 is None or server_p95 <= int(args.health_target_ms))
    ):
        client_latency_notes.append(
            f"client round-trip p95 {client_p95}ms exceeds target {args.health_target_ms}ms; "
            "server duration is within target, so use an in-region probe for launch latency evidence"
        )
    status = "PASS" if not failures else "FAIL"
    detail = "; ".join(failures)
    if not detail:
        detail = "Health probe passed."
        if client_latency_notes:
            detail += " " + " ".join(client_latency_notes)
    return CheckResult(
        "healthz",
        status,
        detail,
        {
            "p95_ms": client_p95,
            "client_p95_ms": client_p95,
            "server_duration_p95_ms": server_p95,
            "probe_count": len(client_durations),
            "last_payload": payloads[-1] if payloads else None,
        },
    )


def _route_surface(args: argparse.Namespace) -> CheckResult:
    if args.skip_route_surface:
        return CheckResult("route_surface", "SKIP", "Skipped by flag.")
    command = [
        sys.executable,
        "scripts/preflight_runtime_route_surface.py",
        "--base-url",
        args.base_url,
        "--timeout-seconds",
        str(args.timeout_seconds),
    ]
    if args.auth_token:
        command.extend(["--auth-token", args.auth_token])
    return _run_command("route_surface", command, cwd=BACKEND_ROOT)


def _static_security_tests(args: argparse.Namespace) -> CheckResult:
    if args.skip_static_tests:
        return CheckResult("static_security_tests", "SKIP", "Skipped by flag.")
    return _run_command(
        "static_security_tests",
        [sys.executable, "-m", "pytest", "-q", *STATIC_TEST_TARGETS],
        cwd=BACKEND_ROOT,
    )


def _db_security(args: argparse.Namespace) -> CheckResult:
    if args.skip_db_security:
        return CheckResult("db_security", "SKIP", "Skipped by flag.")
    if not os.getenv("MODE_SECURITY_DATABASE_URL"):
        status = "SKIP" if args.local else "FAIL"
        return CheckResult("db_security", status, "MODE_SECURITY_DATABASE_URL is not set.")
    return _run_command("db_security", [sys.executable, "scripts/staging_db_security_check.py"], cwd=BACKEND_ROOT)


def _classify_sse_data_line(event_name: str, data: str) -> tuple[str | None, bool, bool, bool]:
    inferred_event = event_name or None
    token_seen = event_name in {"token", "message_delta"} and bool(data and data != "{}")
    done_seen = event_name == "done"
    error_seen = event_name == "error"
    if token_seen or done_seen or error_seen:
        return inferred_event, token_seen, done_seen, error_seen
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return inferred_event, token_seen, done_seen, error_seen
    if not isinstance(payload, dict):
        return inferred_event, token_seen, done_seen, error_seen
    payload_type = str(payload.get("type") or "").strip()
    if payload.get("done") is True or payload_type == "done":
        return inferred_event or "done", token_seen, True, error_seen
    if payload_type == "error" or "error" in payload:
        return inferred_event or "error", token_seen, done_seen, True
    if "token" in payload or payload_type in {"token", "message_delta"}:
        return inferred_event or "token", True, done_seen, error_seen
    return inferred_event, token_seen, done_seen, error_seen


def _chat_stream_once(base_url: str, token: str, timeout: float, message: str) -> dict[str, Any]:
    headers = {
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    body = {
        "request_id": str(uuid4()),
        "message": message,
        "client_context": {"launch_gate_smoke": True},
    }
    request_id = str(body["request_id"])
    url = urljoin(f"{base_url.rstrip('/')}/", CHAT_STREAM_PATH.lstrip("/"))
    started = time.perf_counter()
    headers_ms: int | None = None
    first_event_ms: int | None = None
    first_event: str | None = None
    first_token_ms: int | None = None
    event_name = ""
    event_count = 0
    data_line_count = 0
    line_count = 0
    done_seen = False
    error_seen = False
    first_error_ms: int | None = None
    last_event: str | None = None
    last_data: str | None = None
    req = Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    try:
        with urlopen(req, timeout=timeout) as response:
            headers_ms = int((time.perf_counter() - started) * 1000)
            status = int(response.getcode())
            for raw_line in response:
                line_count += 1
                line = raw_line.decode("utf-8", errors="replace").strip()
                if line.startswith("event:"):
                    event_name = line.split(":", 1)[1].strip()
                    last_event = event_name or last_event
                    event_count += 1
                    if first_event_ms is None:
                        first_event_ms = int((time.perf_counter() - started) * 1000)
                        first_event = event_name
                elif line.startswith("data:"):
                    data_line_count += 1
                    data = line.split(":", 1)[1].strip()
                    last_data = data[:500]
                    inferred_event, token_seen, line_done_seen, line_error_seen = _classify_sse_data_line(event_name, data)
                    last_event = inferred_event or last_event
                    if first_event_ms is None and inferred_event:
                        first_event_ms = int((time.perf_counter() - started) * 1000)
                        first_event = inferred_event
                        if not event_name:
                            event_count += 1
                    if token_seen and first_token_ms is None:
                        first_token_ms = int((time.perf_counter() - started) * 1000)
                    if line_error_seen:
                        error_seen = True
                        if first_error_ms is None:
                            first_error_ms = int((time.perf_counter() - started) * 1000)
                    if line_done_seen:
                        done_seen = True
                        break
            return {
                "ok": status == 200 and first_token_ms is not None and done_seen,
                "status": status,
                "request_id": request_id,
                "headers_ms": headers_ms,
                "first_event": first_event,
                "first_event_ms": first_event_ms,
                "first_token_ms": first_token_ms,
                "ttft_ms": first_token_ms,
                "total_ms": int((time.perf_counter() - started) * 1000),
                "event_count": event_count,
                "data_line_count": data_line_count,
                "line_count": line_count,
                "done_seen": done_seen,
                "error_seen": error_seen,
                "first_error_ms": first_error_ms,
                "last_event": last_event,
                "last_data": last_data,
            }
    except HTTPError as exc:
        return {
            "ok": False,
            "status": int(exc.code),
            "request_id": request_id,
            "total_ms": int((time.perf_counter() - started) * 1000),
            "error": exc.read().decode("utf-8", errors="replace")[:500],
        }
    except Exception as exc:
        return {
            "ok": False,
            "status": None,
            "request_id": request_id,
            "total_ms": int((time.perf_counter() - started) * 1000),
            "error": str(exc),
        }


async def _chat_stream_once_async(
    client: httpx.AsyncClient,
    base_url: str,
    token: str,
    message: str,
) -> dict[str, Any]:
    headers = {
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    body = {
        "request_id": str(uuid4()),
        "message": message,
        "client_context": {"launch_gate_smoke": True},
    }
    request_id = str(body["request_id"])
    url = urljoin(f"{base_url.rstrip('/')}/", CHAT_STREAM_PATH.lstrip("/"))
    started = time.perf_counter()
    headers_ms: int | None = None
    first_event_ms: int | None = None
    first_event: str | None = None
    first_token_ms: int | None = None
    event_name = ""
    event_count = 0
    data_line_count = 0
    line_count = 0
    done_seen = False
    error_seen = False
    first_error_ms: int | None = None
    last_event: str | None = None
    last_data: str | None = None
    try:
        async with client.stream("POST", url, headers=headers, json=body) as response:
            headers_ms = int((time.perf_counter() - started) * 1000)
            status = int(response.status_code)
            if status >= 400:
                error_body = (await response.aread()).decode("utf-8", errors="replace")
                return {
                    "ok": False,
                    "status": status,
                    "request_id": request_id,
                    "headers_ms": headers_ms,
                    "total_ms": int((time.perf_counter() - started) * 1000),
                    "error": error_body[:500],
                }
            async for raw_line in response.aiter_lines():
                line_count += 1
                line = str(raw_line or "").strip()
                if line.startswith("event:"):
                    event_name = line.split(":", 1)[1].strip()
                    last_event = event_name or last_event
                    event_count += 1
                    if first_event_ms is None:
                        first_event_ms = int((time.perf_counter() - started) * 1000)
                        first_event = event_name
                elif line.startswith("data:"):
                    data_line_count += 1
                    data = line.split(":", 1)[1].strip()
                    last_data = data[:500]
                    inferred_event, token_seen, line_done_seen, line_error_seen = _classify_sse_data_line(event_name, data)
                    last_event = inferred_event or last_event
                    if first_event_ms is None and inferred_event:
                        first_event_ms = int((time.perf_counter() - started) * 1000)
                        first_event = inferred_event
                        if not event_name:
                            event_count += 1
                    if token_seen and first_token_ms is None:
                        first_token_ms = int((time.perf_counter() - started) * 1000)
                    if line_error_seen:
                        error_seen = True
                        if first_error_ms is None:
                            first_error_ms = int((time.perf_counter() - started) * 1000)
                    if line_done_seen:
                        done_seen = True
                        break
            return {
                "ok": status == 200 and first_token_ms is not None and done_seen,
                "status": status,
                "request_id": request_id,
                "headers_ms": headers_ms,
                "first_event": first_event,
                "first_event_ms": first_event_ms,
                "first_token_ms": first_token_ms,
                "ttft_ms": first_token_ms,
                "total_ms": int((time.perf_counter() - started) * 1000),
                "event_count": event_count,
                "data_line_count": data_line_count,
                "line_count": line_count,
                "done_seen": done_seen,
                "error_seen": error_seen,
                "first_error_ms": first_error_ms,
                "last_event": last_event,
                "last_data": last_data,
            }
    except (httpx.TimeoutException, httpx.HTTPError, OSError) as exc:
        return {
            "ok": False,
            "status": None,
            "request_id": request_id,
            "total_ms": int((time.perf_counter() - started) * 1000),
            "error": str(exc),
        }


def _load_tokens(args: argparse.Namespace) -> list[str]:
    tokens: list[str] = []
    if args.auth_token_file:
        path = Path(str(args.auth_token_file))
        if path.exists():
            tokens.extend(line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    if args.auth_token:
        tokens.insert(0, args.auth_token)
    unique: list[str] = []
    for token in tokens:
        if token not in unique:
            unique.append(token)
    return unique


def _chat_smoke(args: argparse.Namespace) -> CheckResult:
    tokens = _load_tokens(args)
    if args.skip_chat_smoke:
        return CheckResult("chat_stream_smoke", "SKIP", "Skipped by flag.")
    if not tokens:
        status = "SKIP" if args.local else "FAIL"
        return CheckResult("chat_stream_smoke", status, "No auth token provided.")
    result = _chat_stream_once(
        args.base_url,
        tokens[0],
        max(float(args.timeout_seconds), 30.0),
        "Launch gate smoke. Reply with one short sentence.",
    )
    return CheckResult(
        "chat_stream_smoke",
        "PASS" if result.get("ok") else "FAIL",
        "Chat stream emitted token and done." if result.get("ok") else json.dumps(result, default=str),
        result,
    )


async def _run_chat_load_requests(args: argparse.Namespace, tokens: list[str]) -> list[dict[str, Any]]:
    request_count = int(args.chat_load_requests)
    concurrency = max(1, int(args.chat_load_concurrency))
    semaphore = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(
        timeout=30.0,
        limits=httpx.Limits(
            max_connections=None,
            max_keepalive_connections=50,
        ),
    ) as client:
        async def run_one(index: int) -> dict[str, Any]:
            async with semaphore:
                token = tokens[index % len(tokens)]
                return await _chat_stream_once_async(
                    client,
                    args.base_url,
                    token,
                    "Launch gate TTFT load probe. Reply briefly.",
                )

        return list(await asyncio.gather(*(run_one(index) for index in range(request_count))))


def _chat_load(args: argparse.Namespace) -> CheckResult:
    if int(args.chat_load_requests) <= 0:
        return CheckResult("chat_ttft_load", "SKIP", "No chat load requested.")
    tokens = _load_tokens(args)
    if not tokens:
        return CheckResult("chat_ttft_load", "FAIL", "Chat load requires --auth-token or --auth-token-file.")
    request_count = int(args.chat_load_requests)
    concurrency = max(1, int(args.chat_load_concurrency))
    results = asyncio.run(_run_chat_load_requests(args, tokens))
    ttfts = [int(item["ttft_ms"]) for item in results if item.get("ok") and item.get("ttft_ms") is not None]
    p95 = _percentile(ttfts, 95)
    failures = [item for item in results if not item.get("ok")]
    if failures:
        return CheckResult("chat_ttft_load", "FAIL", f"{len(failures)} chat load requests failed.", {"results": results})
    if p95 is None or p95 > int(args.ttft_target_ms):
        return CheckResult(
            "chat_ttft_load",
            "FAIL",
            f"TTFT p95 {p95}ms exceeds target {args.ttft_target_ms}ms.",
            {"p95_ms": p95, "request_count": request_count, "concurrency": concurrency, "results": results},
        )
    return CheckResult(
        "chat_ttft_load",
        "PASS",
        "Chat TTFT load target passed.",
        {"p95_ms": p95, "request_count": request_count, "concurrency": concurrency, "results": results},
    )


def _storage_smoke(args: argparse.Namespace) -> CheckResult:
    if not args.run_storage_smoke:
        return CheckResult("storage_signed_url_smoke", "SKIP", "Not requested.")
    if not args.auth_token:
        return CheckResult("storage_signed_url_smoke", "FAIL", "Storage smoke requires --auth-token.")
    body: dict[str, Any] = {
        "scope": args.storage_scope,
        "filename": "launch-gate-smoke.txt",
        "mime_type": "text/plain",
        "size_bytes": 12,
    }
    if args.storage_scope == "trainer_client":
        if not args.storage_client_id:
            return CheckResult("storage_signed_url_smoke", "FAIL", "trainer_client scope requires --storage-client-id.")
        body["client_id"] = args.storage_client_id
    status, response_body, duration_ms = _request(
        args.base_url,
        "/api/v1/storage/private/upload-url",
        timeout=max(float(args.timeout_seconds), 20.0),
        method="POST",
        token=args.auth_token,
        body=body,
    )
    if status != 200:
        return CheckResult("storage_signed_url_smoke", "FAIL", f"upload-url returned {status}: {response_body[:500]}")
    payload = json.loads(response_body)
    required = {"bucket", "object_path", "signed_upload_url", "upload_token", "expires_in"}
    missing = sorted(required - set(payload.keys()))
    if missing:
        return CheckResult("storage_signed_url_smoke", "FAIL", f"upload-url response missing {missing}")
    return CheckResult(
        "storage_signed_url_smoke",
        "PASS",
        "Storage signed upload URL issued.",
        {"duration_ms": duration_ms, "object_path": payload.get("object_path")},
    )


def _account_deletion_smoke(args: argparse.Namespace) -> CheckResult:
    if not args.run_account_deletion_enqueue_smoke:
        return CheckResult("account_deletion_enqueue_smoke", "SKIP", "Not requested.")
    if os.getenv("MODE_ALLOW_ACCOUNT_DELETION_SMOKE") != "1":
        return CheckResult(
            "account_deletion_enqueue_smoke",
            "FAIL",
            "Set MODE_ALLOW_ACCOUNT_DELETION_SMOKE=1 and use a sacrificial test account token.",
        )
    if not args.auth_token:
        return CheckResult("account_deletion_enqueue_smoke", "FAIL", "Account deletion smoke requires --auth-token.")
    status, body, duration_ms = _request(
        args.base_url,
        "/api/v1/account/me",
        timeout=max(float(args.timeout_seconds), 20.0),
        method="DELETE",
        token=args.auth_token,
        body={"confirmation": "DELETE"},
    )
    if status != 202:
        return CheckResult("account_deletion_enqueue_smoke", "FAIL", f"DELETE /account/me returned {status}: {body[:500]}")
    payload = json.loads(body)
    if payload.get("outcome") != "queued" or not payload.get("worker_job_id"):
        return CheckResult("account_deletion_enqueue_smoke", "FAIL", f"Unexpected response: {body[:500]}")
    return CheckResult(
        "account_deletion_enqueue_smoke",
        "PASS",
        "Account deletion request queued.",
        {"duration_ms": duration_ms, "worker_job_id": payload.get("worker_job_id")},
    )


def _print_results(results: list[CheckResult]) -> None:
    print("Launch Gate / Staging Verification")
    for result in results:
        print(f"- {result.status} {result.name}: {result.detail}")
        if result.metrics:
            print(f"  metrics={json.dumps(result.metrics, default=str)}")


def main() -> int:
    args = _build_parser().parse_args()
    args.base_url = str(args.base_url).rstrip("/")
    results = [
        _validate_sql(),
        _health_check(args),
        _route_surface(args),
        _static_security_tests(args),
        _db_security(args),
        _chat_smoke(args),
        _storage_smoke(args),
        _account_deletion_smoke(args),
        _chat_load(args),
    ]
    _print_results(results)

    failures = [result for result in results if result.status == "FAIL"]
    if failures:
        print("\nLaunch Gate / Staging Verification: NO-GO", file=sys.stderr)
        return 1
    skipped = [result.name for result in results if result.status == "SKIP"]
    if skipped:
        print("\nLaunch Gate / Staging Verification: PASS with skipped gates")
        print("Skipped: " + ", ".join(skipped))
    else:
        print("\nLaunch Gate / Staging Verification: GO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
