#!/usr/bin/env python3
"""Generate chat load against staging for launch-gate baselines.

This script intentionally reports client-side response rate and observed TTFT only.
Gate decisions should use server ChatTrace fields pulled from staging logs.
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError


FAST_MESSAGE = "Quick check: what should I focus on for today's workout?"
DEEP_MESSAGE = "Build me a thoughtful 4-week progression with recovery constraints and rationale."
MIXED_MESSAGES = [FAST_MESSAGE, DEEP_MESSAGE, "I slept poorly and feel sore. Adjust today's plan safely."]


@dataclass(frozen=True)
class Result:
    ok: bool
    ttft_ms: int | None
    status_code: int | None
    error: str | None = None


def load_tokens(path: Path) -> list[str]:
    payload = json.loads(path.read_text())
    if isinstance(payload, list):
        tokens = [str(item.get("access_token") if isinstance(item, dict) else item).strip() for item in payload]
    elif isinstance(payload, dict):
        raw_tokens = payload.get("tokens") or payload.get("access_tokens") or []
        tokens = [str(item.get("access_token") if isinstance(item, dict) else item).strip() for item in raw_tokens]
    else:
        tokens = []
    tokens = [token for token in tokens if token]
    if not tokens:
        raise SystemExit("Token file must contain at least one access token.")
    return tokens


def percentile(values: list[int], pct: float) -> int | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    index = min(len(values) - 1, max(0, round((pct / 100) * (len(values) - 1))))
    return sorted(values)[index]


def post_stream(base_url: str, token: str, message: str, *, timeout: float) -> Result:
    body = json.dumps({"message": message, "client_context": {"load_test": True}}).encode("utf-8")
    req = urllib_request.Request(
        f"{base_url.rstrip('/')}/api/v1/chat/stream",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    started_at = time.perf_counter()
    try:
        with urllib_request.urlopen(req, timeout=timeout) as response:
            status_code = int(getattr(response, "status", 0) or 0)
            while True:
                line = response.readline()
                if not line:
                    break
                decoded = line.decode("utf-8", errors="replace").strip()
                if decoded.startswith("event: token"):
                    return Result(ok=True, ttft_ms=int((time.perf_counter() - started_at) * 1000), status_code=status_code)
                if decoded.startswith("event: error"):
                    return Result(ok=False, ttft_ms=None, status_code=status_code, error="sse_error")
            return Result(ok=True, ttft_ms=None, status_code=status_code)
    except HTTPError as exc:
        return Result(ok=False, ttft_ms=None, status_code=exc.code, error=exc.__class__.__name__)
    except (TimeoutError, URLError) as exc:
        return Result(ok=False, ttft_ms=None, status_code=None, error=exc.__class__.__name__)


def run_wave(*, base_url: str, tokens: list[str], users: int, duration_seconds: int, interval_seconds: int, scenario: str) -> list[Result]:
    deadline = time.monotonic() + duration_seconds
    results: list[Result] = []

    def worker(worker_index: int) -> list[Result]:
        local: list[Result] = []
        token = tokens[worker_index % len(tokens)]
        while time.monotonic() < deadline:
            if scenario == "deep":
                message = DEEP_MESSAGE
            elif scenario == "mixed":
                message = random.choice(MIXED_MESSAGES)
            else:
                message = FAST_MESSAGE
            local.append(post_stream(base_url, token, message, timeout=max(20, interval_seconds + 15)))
            sleep_for = min(interval_seconds, max(0, deadline - time.monotonic()))
            if sleep_for:
                time.sleep(sleep_for)
        return local

    with ThreadPoolExecutor(max_workers=users) as executor:
        futures = [executor.submit(worker, index) for index in range(users)]
        for future in as_completed(futures):
            results.extend(future.result())
    return results


def summarize(results: list[Result]) -> dict[str, Any]:
    ttfts = [result.ttft_ms for result in results if result.ttft_ms is not None]
    ok_count = sum(1 for result in results if result.ok)
    return {
        "requests": len(results),
        "ok": ok_count,
        "error_rate": round((len(results) - ok_count) / max(len(results), 1), 4),
        "client_ttft_p50_ms": int(statistics.median(ttfts)) if ttfts else None,
        "client_ttft_p95_ms": percentile(ttfts, 95),
        "client_ttft_p99_ms": percentile(ttfts, 99),
        "status_codes": {
            str(code): sum(1 for result in results if result.status_code == code)
            for code in sorted({result.status_code for result in results if result.status_code is not None})
        },
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--auth-token-file", required=True, type=Path)
    parser.add_argument("--scenario", choices=("fast", "deep", "mixed"), required=True)
    parser.add_argument("--users", type=int, required=True)
    parser.add_argument("--duration-seconds", type=int, required=True)
    parser.add_argument("--interval-seconds", type=int, required=True)
    args = parser.parse_args(argv)

    tokens = load_tokens(args.auth_token_file)
    results = run_wave(
        base_url=args.base_url,
        tokens=tokens,
        users=max(1, args.users),
        duration_seconds=max(1, args.duration_seconds),
        interval_seconds=max(1, args.interval_seconds),
        scenario=args.scenario,
    )
    print(json.dumps(summarize(results), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
