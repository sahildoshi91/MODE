#!/usr/bin/env python3
"""
Runtime API surface preflight for trainer coach/chat QA.

Usage:
  cd backend
  ./venv/bin/python scripts/preflight_runtime_route_surface.py --base-url http://127.0.0.1:8000
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


REQUIRED_ROUTE_PATHS = {
    "/api/v1/chat/history",
    "/api/v1/chat/sessions",
    "/api/v1/chat/sessions/today",
    "/api/v1/chat/sessions/{session_id}",
    "/api/v1/chat/sessions/{session_id}/continue",
    "/api/v1/chat/sessions/{session_id}/messages",
    "/api/v1/chat/sessions/{session_id}/messages/stream",
    "/api/v1/trainer-home/command-center",
    "/api/v1/trainer-clients/{client_id}/detail",
    "/api/v1/trainer-clients/{client_id}/memory",
    "/api/v1/trainer-clients/{client_id}/memory/{memory_id}",
    "/api/v1/trainer-clients/{client_id}/ai-context",
    "/api/v1/trainer-clients/{client_id}/meeting-location",
    "/api/v1/trainer-clients/{client_id}/schedule-preferences",
    "/api/v1/trainer-clients/{client_id}/schedule-exceptions",
    "/api/v1/trainer-clients/{client_id}/schedule-exceptions/{session_date}",
    "/api/v1/trainer-settings/me",
    "/api/v1/profiles/me/trainer-schedule",
    "/api/v1/trainer-assistant/bootstrap",
    "/api/v1/trainer-assistant/execute",
    "/api/v1/trainer-assistant/drafts/{draft_id}/edit",
    "/api/v1/trainer-assistant/drafts/{draft_id}/approve",
    "/api/v1/trainer-assistant/drafts/{draft_id}/reject",
    "/api/v1/trainer-assistant/background/run",
    "/api/v1/trainer-coach/workspace",
    "/api/v1/trainer-coach/queue",
    "/api/v1/trainer-coach/events",
    "/api/v1/trainer-coach/queue/{output_id}/approve",
    "/api/v1/trainer-coach/queue/{output_id}/edit",
    "/api/v1/trainer-coach/queue/{output_id}/reject",
    "/api/v1/trainer-programs/templates",
    "/api/v1/trainer-programs/templates/{template_id}",
    "/api/v1/trainer-programs/templates/{template_id}/archive",
}

@dataclass(frozen=True)
class RuntimeRouteCheck:
    method: str
    path: str
    expected_statuses: set[int]
    body: dict[str, Any] | None = None
    headers: dict[str, str] = field(default_factory=dict)


UNAUTH_ROUTE_CHECKS = (
    RuntimeRouteCheck("GET", "/api/v1/trainer-coach/workspace", {401, 403}),
    RuntimeRouteCheck("GET", "/api/v1/chat/history", {401, 403}),
    RuntimeRouteCheck(
        "POST",
        "/api/v1/chat/sessions/today",
        {401, 403},
        body={
            "role": "client",
            "session_type": "client_chat",
            "metadata": {"preflight": True},
        },
    ),
)


def _request(
    url: str,
    *,
    timeout: float,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, str]:
    request_headers = {
        "Accept": "application/json",
        **(headers or {}),
    }
    data = None
    if body is not None:
        request_headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers=request_headers, method=method.upper())
    try:
        with urlopen(req, timeout=timeout) as response:
            status = int(response.getcode())
            body = response.read().decode("utf-8", errors="replace")
            return status, body
    except HTTPError as exc:
        status = int(exc.code)
        body = exc.read().decode("utf-8", errors="replace")
        return status, body
    except URLError as exc:
        raise RuntimeError(f"Request failed for {url}: {exc}") from exc


def _parse_openapi_paths(body: str) -> set[str]:
    try:
        payload: Any = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"/openapi.json was not valid JSON: {exc}") from exc
    paths = payload.get("paths")
    if not isinstance(paths, dict):
        raise RuntimeError("/openapi.json payload missing object field: paths")
    return set(str(path) for path in paths.keys())


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Verify that the running backend route surface includes required trainer/chat routes "
            "before QA smoke runs."
        )
    )
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8000",
        help="Backend origin to probe. Default: http://127.0.0.1:8000",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=8.0,
        help="HTTP timeout per request. Default: 8.0",
    )
    parser.add_argument(
        "--auth-token",
        default=None,
        help=(
            "Optional bearer token used for an authenticated chat session history smoke check. "
            "When provided, /api/v1/chat/sessions must return 200."
        ),
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    base_url = str(args.base_url).rstrip("/")
    timeout = float(args.timeout_seconds)
    failures: list[str] = []

    try:
        health_status, _ = _request(urljoin(f"{base_url}/", "healthz"), timeout=timeout)
    except RuntimeError as exc:
        print(f"Runtime preflight failed: {exc}", file=sys.stderr)
        return 1
    if health_status != 200:
        failures.append(f"/healthz expected 200, got {health_status}")

    try:
        openapi_status, openapi_body = _request(urljoin(f"{base_url}/", "openapi.json"), timeout=timeout)
    except RuntimeError as exc:
        print(f"Runtime preflight failed: {exc}", file=sys.stderr)
        return 1
    if openapi_status != 200:
        failures.append(f"/openapi.json expected 200, got {openapi_status}")
        advertised_paths: set[str] = set()
    else:
        try:
            advertised_paths = _parse_openapi_paths(openapi_body)
        except RuntimeError as exc:
            print(f"Runtime preflight failed: {exc}", file=sys.stderr)
            return 1

    missing_paths = sorted(REQUIRED_ROUTE_PATHS.difference(advertised_paths))
    if missing_paths:
        failures.append(
            "Missing required trainer/chat route paths in /openapi.json:\n  - "
            + "\n  - ".join(missing_paths)
        )

    for check in UNAUTH_ROUTE_CHECKS:
        try:
            status, _ = _request(
                urljoin(f"{base_url}/", check.path.lstrip("/")),
                timeout=timeout,
                method=check.method,
                body=check.body,
                headers=check.headers,
            )
        except RuntimeError as exc:
            failures.append(str(exc))
            continue
        if status not in check.expected_statuses:
            if status == 404:
                failures.append(
                    f"{check.method} {check.path} returned 404 (stale runtime likely). "
                    f"Expected {sorted(check.expected_statuses)} without auth."
                )
            else:
                failures.append(
                    f"{check.method} {check.path} expected {sorted(check.expected_statuses)} without auth, got {status}"
                )

    authenticated_history_checked = False
    if args.auth_token:
        authenticated_history_checked = True
        history_path = "/api/v1/chat/sessions?role=client&session_type=client_chat&limit=1"
        try:
            status, body = _request(
                urljoin(f"{base_url}/", history_path.lstrip("/")),
                timeout=timeout,
                headers={"Authorization": f"Bearer {args.auth_token}"},
            )
        except RuntimeError as exc:
            failures.append(str(exc))
        else:
            if status == 404:
                failures.append(
                    f"GET {history_path} returned 404 (chat session history route is missing in runtime)."
                )
            elif status != 200:
                failures.append(
                    f"GET {history_path} expected 200 with auth token, got {status}: {body[:240]}"
                )

    if failures:
        print("Runtime route surface preflight: FAILED", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("Runtime route surface preflight: PASSED")
    print(f"Base URL: {base_url}")
    print(f"Verified {len(REQUIRED_ROUTE_PATHS)} required route paths.")
    print("Verified unauth route behavior for trainer coach and chat history endpoints.")
    if authenticated_history_checked:
        print("Verified authenticated chat session history endpoint.")
    else:
        print("Skipped authenticated chat session history endpoint; pass --auth-token to verify it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
