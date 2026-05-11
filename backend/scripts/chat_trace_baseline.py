#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from uuid import uuid4

import httpx
from supabase import create_client
from supabase.lib.client_options import SyncClientOptions

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.db.client import get_supabase_admin_client


FAST_MESSAGES = [
    "great workout today!",
    "Feeling motivated and ready for tomorrow.",
    "Can you give me a quick accountability nudge?",
    "I got my steps in today.",
    "Remind me what to focus on for consistency.",
]

DEEP_MESSAGES = [
    "Can we change my plan for a busy travel week?",
    "I feel stuck on my progress. What should we adjust?",
    "How should I think about recovery if sleep is low this week?",
    "Can you help me prioritize training days around work?",
]

SAFETY_MESSAGE = "My knee is really hurting after squats. What should I do today?"


@dataclass
class BaselineResult:
    index: int
    route_hint: str
    http_status: int
    request_id: str | None
    conversation_id: str | None
    first_event_ms: int | None
    time_to_first_token_ms: int | None
    total_response_ms: int
    status_event_count: int
    token_event_count: int
    done_seen: bool
    error_seen: bool
    persisted_event_count: int | None
    persisted_event_types: list[str]
    client_error: str | None = None


@dataclass
class Fixture:
    prefix: str
    tenant_id: str | None
    trainer_id: str | None
    client_id: str | None
    client_access_token: str
    user_ids: list[str]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run disposable staging chat streams and print latency baselines/request IDs.",
    )
    parser.add_argument("--base-url", required=True, help="Staging backend base URL, e.g. https://...onrender.com")
    parser.add_argument("--count", type=int, default=20, help="Number of non-safety baseline chat streams.")
    parser.add_argument(
        "--include-safety-check",
        action="store_true",
        help="Append one safety-escalation stream and verify trainer-review state before cleanup.",
    )
    parser.add_argument(
        "--fetch-events",
        action="store_true",
        help="Fetch persisted request events after each stream. Disabled by default to avoid chat rate-limit noise.",
    )
    parser.add_argument(
        "--continue-after-auth-failure",
        action="store_true",
        help="Continue the full baseline even after a hosted 401. By default, auth mismatch fails fast.",
    )
    parser.add_argument("--output", help="Optional JSON output path for baseline evidence.")
    parser.add_argument(
        "--allow-non-staging-host",
        action="store_true",
        help="Allow a base URL whose hostname does not contain 'staging'.",
    )
    parser.add_argument(
        "--expected-supabase-ref",
        help="Fail before creating records unless SUPABASE_URL resolves to this Supabase project ref.",
    )
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    _require_staging_guards(
        base_url,
        allow_non_staging_host=args.allow_non_staging_host,
        expected_supabase_ref=args.expected_supabase_ref,
    )

    fixture: Fixture | None = None
    cleanup_status: list[str] = []
    payload: dict[str, Any] = {}
    started_at = datetime.now(timezone.utc).isoformat()

    try:
        fixture = _create_fixture()
        _warm_health(base_url)
        results = _run_baseline(
            base_url=base_url,
            access_token=fixture.client_access_token,
            prefix=fixture.prefix,
            count=max(1, args.count),
            include_safety_check=args.include_safety_check,
            fetch_events=args.fetch_events,
            continue_after_auth_failure=args.continue_after_auth_failure,
        )
        safety_verification = (
            _verify_safety_state(results[-1], fixture)
            if args.include_safety_check and results
            else None
        )
        payload = {
            "started_at": started_at,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "base_url": base_url,
            "record_prefix": fixture.prefix,
            "count": len(results),
            "summary": _summarize(results),
            "results": [asdict(result) for result in results],
            "safety_verification": safety_verification,
            "render_log_lookup": {
                "query": '"event\\":\\"chat_trace"',
                "request_ids": [result.request_id for result in results if result.request_id],
                "required_field": "time_to_first_token_ms",
            },
        }
        _print_report(payload)
        if args.output:
            _write_json(Path(args.output), payload)
        return 0 if _is_successful(results, args.include_safety_check, safety_verification) else 1
    finally:
        if fixture is not None:
            cleanup_status = _cleanup_fixture(fixture)
            if payload:
                payload["cleanup_status"] = cleanup_status
                if args.output:
                    _write_json(Path(args.output), payload)
                print("\nCleanup:", flush=True)
                for item in cleanup_status:
                    print(f"- {item}", flush=True)


def _require_staging_guards(
    base_url: str,
    *,
    allow_non_staging_host: bool,
    expected_supabase_ref: str | None = None,
) -> None:
    if os.getenv("MODE_RUN_STAGING_SUPABASE_TESTS") != "1":
        raise RuntimeError("Refusing to run without MODE_RUN_STAGING_SUPABASE_TESTS=1.")
    if settings.app_env != "staging":
        raise RuntimeError(f"Refusing to run unless APP_ENV resolves to staging; got {settings.app_env!r}.")
    missing = [
        name
        for name, value in {
            "SUPABASE_URL": settings.supabase_url,
            "SUPABASE_ANON_KEY": settings.supabase_anon_key,
            "SUPABASE_SERVICE_ROLE_KEY": settings.supabase_service_role_key,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(f"Missing required staging env var(s): {', '.join(missing)}")

    host = urlparse(base_url).hostname or ""
    if not host:
        raise RuntimeError("Base URL must include a hostname.")
    if not allow_non_staging_host and "staging" not in host:
        raise RuntimeError("Base URL hostname must contain 'staging' unless --allow-non-staging-host is set.")

    supabase_host = urlparse(settings.supabase_url).hostname or ""
    if not supabase_host.endswith(".supabase.co"):
        raise RuntimeError("SUPABASE_URL does not look like a Supabase project URL.")
    supabase_ref = supabase_host.split(".", 1)[0]
    if expected_supabase_ref and supabase_ref != expected_supabase_ref:
        raise RuntimeError(
            "SUPABASE_URL project ref mismatch: "
            f"expected {expected_supabase_ref!r}, got {supabase_ref!r}. "
            "Supabase auth tokens are project-scoped; local baseline env must match Render staging."
        )


def _create_fixture() -> Fixture:
    admin = get_supabase_admin_client()
    anon = create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
        options=SyncClientOptions(auto_refresh_token=False, persist_session=False),
    )
    run_timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    run_id = uuid4().hex
    prefix = f"smoke_test_{run_timestamp}_{run_id[:8]}"
    password = f"ModeStage!{run_id[:12]}"
    user_ids: list[str] = []

    trainer_user = _create_auth_user(admin, f"{prefix}_baseline_trainer@example.com", password, user_ids)
    client_user = _create_auth_user(admin, f"{prefix}_baseline_client@example.com", password, user_ids)

    bootstrap_response = admin.rpc(
        "bootstrap_trainer_tenant",
        {
            "trainer_user_id": trainer_user["id"],
            "tenant_name": f"{prefix}_tenant",
            "tenant_slug": f"{prefix}_tenant",
            "trainer_display_name": f"{prefix}_trainer",
            "default_persona_name": f"{prefix}_persona",
            "tone_description": "Warm, concise, and practical.",
            "coaching_philosophy": "Use staging baseline requests to validate chat latency and safety.",
        },
    ).execute()
    bootstrap_row = bootstrap_response.data[0]

    assignment_response = admin.rpc(
        "assign_client_to_trainer",
        {
            "client_user_id": client_user["id"],
            "trainer_record_id": bootstrap_row["trainer_id"],
        },
    ).execute()
    assignment_row = assignment_response.data[0]

    sign_in_response = anon.auth.sign_in_with_password(
        {
            "email": client_user["email"],
            "password": password,
        }
    )
    session = getattr(sign_in_response, "session", None)
    if not session or not session.access_token:
        raise RuntimeError("Failed to sign in disposable staging baseline client.")

    return Fixture(
        prefix=prefix,
        tenant_id=bootstrap_row["tenant_id"],
        trainer_id=bootstrap_row["trainer_id"],
        client_id=assignment_row["client_id"],
        client_access_token=session.access_token,
        user_ids=user_ids,
    )


def _create_auth_user(admin: Any, email: str, password: str, user_ids: list[str]) -> dict[str, str]:
    response = _retry(
        lambda: admin.auth.admin.create_user(
            {
                "email": email,
                "password": password,
                "email_confirm": True,
            }
        )
    )
    user = response.user
    user_ids.append(user.id)
    return {"id": user.id, "email": email}


def _warm_health(base_url: str) -> None:
    with httpx.Client(timeout=httpx.Timeout(20.0, connect=10.0)) as client:
        response = client.get(urljoin(f"{base_url}/", "healthz"))
    if response.status_code != 200:
        raise RuntimeError(f"Health check failed: {response.status_code}")


def _run_baseline(
    *,
    base_url: str,
    access_token: str,
    prefix: str,
    count: int,
    include_safety_check: bool,
    fetch_events: bool,
    continue_after_auth_failure: bool,
) -> list[BaselineResult]:
    results: list[BaselineResult] = []
    conversation_id: str | None = None
    messages = _baseline_messages(count)
    if include_safety_check:
        messages.append(("SAFETY_ESCALATION_CHECK", SAFETY_MESSAGE))

    for index, (route_hint, message) in enumerate(messages, start=1):
        request_id = str(uuid4())
        result = _stream_chat(
            base_url=base_url,
            access_token=access_token,
            request_id=request_id,
            conversation_id=conversation_id,
            index=index,
            route_hint=route_hint,
            message=message,
            prefix=prefix,
        )
        if result.conversation_id:
            conversation_id = result.conversation_id
        if fetch_events:
            result.persisted_event_count, result.persisted_event_types = _fetch_persisted_events(
                base_url=base_url,
                access_token=access_token,
                request_id=result.request_id,
            )
        results.append(result)
        print(
            json.dumps(
                {
                    "index": result.index,
                    "route_hint": result.route_hint,
                    "status": result.http_status,
                    "request_id": result.request_id,
                    "ttft_ms": result.time_to_first_token_ms,
                    "total_ms": result.total_response_ms,
                    "error_seen": result.error_seen,
                    "client_error": result.client_error if result.http_status >= 400 else None,
                },
                default=str,
            ),
            flush=True,
        )
        if result.http_status == 401 and not continue_after_auth_failure:
            print("Stopping baseline after hosted 401; check Render Supabase auth env alignment.", flush=True)
            break
    return results


def _baseline_messages(count: int) -> list[tuple[str, str]]:
    messages: list[tuple[str, str]] = []
    for index in range(count):
        if index % 4 == 3:
            messages.append(("DEEP_PATH_EXPECTED", DEEP_MESSAGES[(index // 4) % len(DEEP_MESSAGES)]))
        else:
            messages.append(("FAST_PATH_EXPECTED", FAST_MESSAGES[index % len(FAST_MESSAGES)]))
    return messages


def _stream_chat(
    *,
    base_url: str,
    access_token: str,
    request_id: str,
    conversation_id: str | None,
    index: int,
    route_hint: str,
    message: str,
    prefix: str,
) -> BaselineResult:
    endpoint = urljoin(f"{base_url}/", "api/v1/chat/stream")
    payload: dict[str, Any] = {
        "request_id": request_id,
        "message": message,
        "client_context": {
            "platform": "chat-trace-baseline",
            "record_prefix": prefix,
            "route_hint": route_hint,
        },
        "client_message_id": f"{prefix}_{index}_client_msg",
        "idempotency_key": f"{prefix}_{index}_{uuid4().hex[:8]}",
    }
    if conversation_id:
        payload["conversation_id"] = conversation_id

    started = time.perf_counter()
    first_event_at: float | None = None
    first_token_at: float | None = None
    token_events = 0
    status_events = 0
    done_seen = False
    error_seen = False
    seen_request_id: str | None = request_id
    seen_conversation_id: str | None = conversation_id
    client_error: str | None = None
    status_code = 0

    try:
        with httpx.Client(timeout=httpx.Timeout(90.0, connect=20.0, read=90.0)) as client:
            with client.stream(
                "POST",
                endpoint,
                json=payload,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "text/event-stream",
                },
            ) as response:
                status_code = response.status_code
                if status_code >= 400:
                    client_error = response.read().decode("utf-8", errors="replace")[:500]
                else:
                    for event_type, event_payload in _iter_sse(response):
                        observed_at = time.perf_counter()
                        first_event_at = first_event_at or observed_at
                        payload_type = str(event_payload.get("type") or event_type)
                        seen_request_id = str(event_payload.get("request_id") or seen_request_id)
                        seen_conversation_id = str(event_payload.get("conversation_id") or seen_conversation_id or "")
                        if payload_type == "status":
                            status_events += 1
                        elif payload_type == "token":
                            content = event_payload.get("content")
                            if isinstance(content, str) and content:
                                token_events += 1
                                first_token_at = first_token_at or observed_at
                        elif payload_type == "done":
                            done_seen = True
                        elif payload_type == "error":
                            error_seen = True
                            client_error = str(
                                event_payload.get("detail")
                                or event_payload.get("message")
                                or "structured stream error"
                            )
    except Exception as exc:
        client_error = f"{type(exc).__name__}: {exc}"

    finished = time.perf_counter()
    return BaselineResult(
        index=index,
        route_hint=route_hint,
        http_status=status_code,
        request_id=seen_request_id,
        conversation_id=seen_conversation_id or None,
        first_event_ms=_elapsed_ms(started, first_event_at),
        time_to_first_token_ms=_elapsed_ms(started, first_token_at),
        total_response_ms=int((finished - started) * 1000),
        status_event_count=status_events,
        token_event_count=token_events,
        done_seen=done_seen,
        error_seen=error_seen,
        persisted_event_count=None,
        persisted_event_types=[],
        client_error=client_error,
    )


def _iter_sse(response: httpx.Response):
    event_type = "message"
    data_lines: list[str] = []
    for line in response.iter_lines():
        if line == "":
            if data_lines:
                data = "\n".join(data_lines)
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    payload = {"type": event_type, "raw": data}
                yield event_type, payload
            event_type = "message"
            data_lines = []
            continue
        if line.startswith("event:"):
            event_type = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data_lines.append(line.split(":", 1)[1].lstrip())
    if data_lines:
        data = "\n".join(data_lines)
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            payload = {"type": event_type, "raw": data}
        yield event_type, payload


def _fetch_persisted_events(
    *,
    base_url: str,
    access_token: str,
    request_id: str | None,
) -> tuple[int | None, list[str]]:
    if not request_id:
        return None, []
    endpoint = urljoin(f"{base_url}/", f"api/v1/chat/requests/{request_id}/events")
    try:
        with httpx.Client(timeout=httpx.Timeout(20.0, connect=10.0)) as client:
            response = client.get(endpoint, headers={"Authorization": f"Bearer {access_token}"})
        if response.status_code != 200:
            return None, []
        events = response.json().get("events") or []
        event_types = [str(event.get("event_type") or "") for event in events if isinstance(event, dict)]
        return len(event_types), event_types
    except Exception:
        return None, []


def _verify_safety_state(result: BaselineResult, fixture: Fixture) -> dict[str, Any]:
    admin = get_supabase_admin_client()
    metadata: dict[str, Any] = {}
    if result.conversation_id:
        rows = (
            admin.table("conversations")
            .select("metadata")
            .eq("id", result.conversation_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if rows and isinstance(rows[0].get("metadata"), dict):
            metadata = rows[0]["metadata"]
    event_rows = (
        admin.table("trainer_system_events")
        .select("id, event_type, payload")
        .eq("trainer_id", fixture.trainer_id)
        .eq("client_id", fixture.client_id)
        .eq("event_type", "safety_escalation")
        .limit(10)
        .execute()
        .data
        or []
    )
    return {
        "conversation_id": result.conversation_id,
        "trainer_review_pending": bool(metadata.get("trainer_review_pending")),
        "active_safety_flags_count": len(metadata.get("active_safety_flags") or []),
        "trainer_system_event_count": len(event_rows),
    }


def _summarize(results: list[BaselineResult]) -> dict[str, Any]:
    valid_ttft = [
        result.time_to_first_token_ms
        for result in results
        if result.time_to_first_token_ms is not None and not result.error_seen and result.http_status == 200
    ]
    valid_total = [
        result.total_response_ms
        for result in results
        if not result.error_seen and result.http_status == 200
    ]
    return {
        "successful_streams": sum(1 for result in results if result.http_status == 200 and result.done_seen and not result.error_seen),
        "error_streams": sum(1 for result in results if result.error_seen or result.http_status >= 400),
        "missing_first_token": sum(1 for result in results if result.time_to_first_token_ms is None),
        "time_to_first_token_ms": _percentiles(valid_ttft),
        "total_response_ms": _percentiles(valid_total),
        "by_route_hint": {
            route_hint: _summarize(
                [result for result in results if result.route_hint == route_hint]
            )
            for route_hint in sorted({result.route_hint for result in results})
        }
        if len({result.route_hint for result in results}) > 1
        else {},
    }


def _percentiles(values: list[int]) -> dict[str, int | None]:
    if not values:
        return {"p50": None, "p95": None, "p99": None, "max": None}
    return {
        "p50": _percentile(values, 50),
        "p95": _percentile(values, 95),
        "p99": _percentile(values, 99),
        "max": max(values),
    }


def _percentile(values: list[int], percentile: int) -> int:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil((percentile / 100) * len(ordered)) - 1))
    return ordered[index]


def _elapsed_ms(started: float, observed: float | None) -> int | None:
    if observed is None:
        return None
    return int((observed - started) * 1000)


def _is_successful(
    results: list[BaselineResult],
    include_safety_check: bool,
    safety_verification: dict[str, Any] | None,
) -> bool:
    if any(result.http_status != 200 or result.error_seen or not result.done_seen for result in results):
        return False
    if any(result.time_to_first_token_ms is None for result in results):
        return False
    if include_safety_check:
        return bool(
            safety_verification
            and safety_verification.get("trainer_review_pending")
            and safety_verification.get("active_safety_flags_count")
            and safety_verification.get("trainer_system_event_count")
        )
    return True


def _print_report(payload: dict[str, Any]) -> None:
    summary = payload["summary"]
    print("\nChat trace baseline summary", flush=True)
    print("===========================", flush=True)
    print(f"Base URL: {payload['base_url']}", flush=True)
    print(f"Record prefix: {payload['record_prefix']}", flush=True)
    print(f"Streams: {summary['successful_streams']} successful, {summary['error_streams']} errors", flush=True)
    print(f"Missing first token: {summary['missing_first_token']}", flush=True)
    print(f"TTFT ms: {summary['time_to_first_token_ms']}", flush=True)
    print(f"Total ms: {summary['total_response_ms']}", flush=True)
    if payload.get("safety_verification"):
        print(f"Safety verification: {payload['safety_verification']}", flush=True)
    print("Render log lookup:", flush=True)
    print(json.dumps(payload["render_log_lookup"], indent=2, default=str), flush=True)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")


def _cleanup_fixture(fixture: Fixture) -> list[str]:
    admin = get_supabase_admin_client()
    status: list[str] = []
    if fixture.tenant_id:
        try:
            admin.table("tenants").delete().eq("id", fixture.tenant_id).execute()
            status.append(f"deleted tenant {fixture.tenant_id}")
        except Exception as exc:
            status.append(f"tenant cleanup failed: {type(exc).__name__}")
    for user_id in fixture.user_ids:
        try:
            admin.auth.admin.delete_user(user_id)
            status.append(f"deleted auth user {user_id}")
        except Exception as exc:
            status.append(f"auth user cleanup failed for {user_id}: {type(exc).__name__}")
    return status


def _retry(fn):
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            return fn()
        except Exception as exc:
            last_error = exc
            if attempt == 3:
                raise
            time.sleep(0.45 * attempt)
    if last_error:
        raise last_error
    raise RuntimeError("Retry helper exhausted without result.")


if __name__ == "__main__":
    raise SystemExit(main())
