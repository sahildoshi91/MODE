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
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


REQUIRED_ROUTE_PATHS = {
    "/api/v1/chat/history",
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

UNAUTH_ROUTE_CHECKS = (
    "/api/v1/trainer-coach/workspace",
    "/api/v1/chat/history",
)


def _request(url: str, *, timeout: float) -> tuple[int, str]:
    req = Request(url, headers={"Accept": "application/json"})
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

    for route_path in UNAUTH_ROUTE_CHECKS:
        try:
            status, _ = _request(urljoin(f"{base_url}/", route_path.lstrip("/")), timeout=timeout)
        except RuntimeError as exc:
            failures.append(str(exc))
            continue
        if status not in {401, 403}:
            if status == 404:
                failures.append(
                    f"{route_path} returned 404 (stale runtime likely). Expected 401/403 without auth."
                )
            else:
                failures.append(f"{route_path} expected 401/403 without auth, got {status}")

    if failures:
        print("Runtime route surface preflight: FAILED", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("Runtime route surface preflight: PASSED")
    print(f"Base URL: {base_url}")
    print(f"Verified {len(REQUIRED_ROUTE_PATHS)} required route paths.")
    print("Verified unauth route behavior for trainer coach and chat history endpoints.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
