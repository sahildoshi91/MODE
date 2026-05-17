import argparse
import asyncio
import importlib.util
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
APPLY_SCRIPT = REPO_ROOT / "scripts" / "apply_launch_gate_migrations.py"
VERIFY_SCRIPT = REPO_ROOT / "scripts" / "launch_gate_staging_verification.py"
MIGRATION = REPO_ROOT / "sql" / "20260511f_retire_service_role_request_paths.sql"


def _load_launch_verify_module():
    scripts_dir = str(REPO_ROOT / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    spec = importlib.util.spec_from_file_location("launch_gate_staging_verification_for_tests", VERIFY_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_launch_gate_migration_helper_exists_and_validates_jsonb_casts() -> None:
    source = APPLY_SCRIPT.read_text(encoding="utf-8")
    migration = MIGRATION.read_text(encoding="utf-8")
    assert "20260511f_retire_service_role_request_paths.sql" in source
    assert ":a:jsonb" in source
    assert "DEFAULT '{}'::jsonb" in source
    assert "DEFAULT '{}'::jsonb" in migration
    assert ":a:jsonb" not in migration


def test_launch_gate_migration_helper_applies_storage_lifecycle_before_service_role_retirement() -> None:
    source = APPLY_SCRIPT.read_text(encoding="utf-8")
    storage_lifecycle = "20260426h_add_storage_upload_lifecycle_and_security_catalog_rpc.sql"
    service_role_retirement = "20260511f_retire_service_role_request_paths.sql"
    health_ping = "20260512a_add_health_ping_rpc.sql"
    account_deletion_job_type = "20260514a_allow_account_deletion_intelligence_jobs.sql"
    worker_job_grants = "20260514b_grant_service_role_worker_job_tables.sql"
    chat_bootstrap_context = "20260515a_add_chat_bootstrap_context_rpc.sql"
    assert "20260426e_add_distributed_rate_limits_and_rpc_execute_allowlist.sql" in source
    assert "20260426f_lockdown_storage_objects_service_signed_urls_only.sql" not in source
    assert "20260426g_add_account_deletion_audit_log.sql" in source
    assert storage_lifecycle in source
    assert "20260426i_add_storage_cleanup_job_heartbeats.sql" in source
    assert health_ping in source
    assert account_deletion_job_type in source
    assert worker_job_grants in source
    assert chat_bootstrap_context in source
    assert source.index(storage_lifecycle) < source.index(service_role_retirement)
    assert source.index(service_role_retirement) < source.index(health_ping)
    assert source.index(health_ping) < source.index(account_deletion_job_type)
    assert source.index(account_deletion_job_type) < source.index(worker_job_grants)
    assert source.index(worker_job_grants) < source.index(chat_bootstrap_context)
    assert "must be applied before" in source
    assert "public.storage_upload_grants" in source
    assert "mode_health_ping" in source
    assert "account_deletion" in source
    assert "public.worker_job_traces" in source
    assert "chat_bootstrap_context" in source


def test_launch_gate_verification_runner_covers_required_smokes() -> None:
    source = VERIFY_SCRIPT.read_text(encoding="utf-8")
    assert "/healthz" in source
    assert "preflight_runtime_route_surface.py" in source
    assert "staging_db_security_check.py" in source
    assert "test_service_role_key_not_used_in_request_handler" in source
    assert "test_storage_private_is_only_api_handler_service_role_exception" in source
    assert "/api/v1/chat/stream" in source
    assert "/api/v1/storage/private/upload-url" in source
    assert "/api/v1/account/me" in source
    assert "MODE_ALLOW_ACCOUNT_DELETION_SMOKE" in source
    assert "chat-load-requests" in source
    assert "chat-load-stop-after-first-token" in source
    assert "full-stream" in source
    assert "chat-load-max-error-rate" in source
    assert "chat-load-min-semaphore-429s" in source
    assert "semaphore_429_count" in source
    assert "ttft-target-ms" in source
    assert "server_duration_p95_ms" in source
    assert "client_p95_ms" in source
    assert "stale or legacy payload" in source


def _health_args() -> argparse.Namespace:
    return argparse.Namespace(
        base_url="https://mode-backend-staging.onrender.com",
        timeout_seconds=8.0,
        health_probes=1,
        health_target_ms=100,
        local=False,
        allow_degraded_health=False,
    )


def test_healthz_rejects_legacy_payload(monkeypatch) -> None:
    module = _load_launch_verify_module()

    def fake_request(*_args, **_kwargs):
        return 200, json.dumps({"ok": True}), 42

    monkeypatch.setattr(module, "_request", fake_request)

    result = module._health_check(_health_args())

    assert result.status == "FAIL"
    assert "stale or legacy payload" in result.detail


def test_healthz_reports_timeout_without_raising(monkeypatch) -> None:
    module = _load_launch_verify_module()

    def fake_request(*_args, **_kwargs):
        raise RuntimeError("The read operation timed out")

    monkeypatch.setattr(module, "_request", fake_request)

    result = module._health_check(_health_args())

    assert result.status == "FAIL"
    assert "The read operation timed out" in result.detail
    assert result.metrics["probe_count"] == 0


def test_request_converts_raw_timeout_to_runtime_error(monkeypatch) -> None:
    module = _load_launch_verify_module()

    def fake_urlopen(*_args, **_kwargs):
        raise TimeoutError("The read operation timed out")

    monkeypatch.setattr(module, "urlopen", fake_urlopen)

    try:
        module._request("https://mode-backend-staging.onrender.com", "/healthz", timeout=0.01)
    except RuntimeError as exc:
        assert "The read operation timed out" in str(exc)
    else:
        raise AssertionError("Expected raw TimeoutError to be converted to RuntimeError")


def test_chat_stream_once_records_stream_timing_diagnostics(monkeypatch) -> None:
    module = _load_launch_verify_module()

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def getcode(self):
            return 200

        def __iter__(self):
            return iter(
                [
                    b"event: status\n",
                    b"data: {}\n",
                    b"event: token\n",
                    b'data: {"content":"hello"}\n',
                    b"event: done\n",
                    b"data: {}\n",
                ]
            )

    monkeypatch.setattr(module, "urlopen", lambda *_args, **_kwargs: FakeResponse())

    result = module._chat_stream_once("https://mode-backend-staging.onrender.com", "token", 1.0, "hello")

    assert result["ok"] is True
    assert result["status"] == 200
    assert result["request_id"]
    assert isinstance(result["headers_ms"], int)
    assert result["first_event"] == "status"
    assert isinstance(result["first_event_ms"], int)
    assert result["first_token_ms"] == result["ttft_ms"]
    assert isinstance(result["total_ms"], int)
    assert result["event_count"] == 3
    assert result["data_line_count"] == 3
    assert result["line_count"] == 6
    assert result["done_seen"] is True
    assert result["error_seen"] is False
    assert result["first_error_ms"] is None
    assert result["last_event"] == "done"


def test_chat_stream_once_accepts_data_only_fake_provider(monkeypatch) -> None:
    module = _load_launch_verify_module()

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def getcode(self):
            return 200

        def __iter__(self):
            return iter(
                [
                    b'data: {"token":"start"}\n',
                    b"\n",
                    b'data: {"done":true}\n',
                    b"\n",
                ]
            )

    monkeypatch.setattr(module, "urlopen", lambda *_args, **_kwargs: FakeResponse())

    result = module._chat_stream_once("https://mode-backend-staging.onrender.com", "token", 1.0, "hello")

    assert result["ok"] is True
    assert result["first_event"] == "token"
    assert result["first_token_ms"] == result["ttft_ms"]
    assert result["done_seen"] is True
    assert result["last_event"] == "done"


def test_chat_stream_once_async_accepts_data_only_fake_provider() -> None:
    module = _load_launch_verify_module()

    class FakeAsyncResponse:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def aiter_lines(self):
            for line in ('data: {"token":"start"}', "", 'data: {"done":true}', ""):
                yield line

    class FakeAsyncClient:
        def stream(self, *_args, **_kwargs):
            return FakeAsyncResponse()

    result = asyncio.run(
        module._chat_stream_once_async(
            FakeAsyncClient(),
            "https://mode-backend-staging.onrender.com",
            "token",
            "hello",
        )
    )

    assert result["ok"] is True
    assert result["first_event"] == "token"
    assert result["first_token_ms"] == result["ttft_ms"]
    assert result["done_seen"] is True
    assert result["last_event"] == "done"


def test_chat_stream_once_async_can_stop_after_first_token() -> None:
    module = _load_launch_verify_module()
    yielded_lines = []
    request_bodies = []

    class FakeAsyncResponse:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def aiter_lines(self):
            for line in (
                "event: status",
                "data: {}",
                "event: token",
                'data: {"content":"hello"}',
                "event: done",
                "data: {}",
            ):
                yielded_lines.append(line)
                yield line

    class FakeAsyncClient:
        def stream(self, *_args, **kwargs):
            request_bodies.append(kwargs["json"])
            return FakeAsyncResponse()

    result = asyncio.run(
        module._chat_stream_once_async(
            FakeAsyncClient(),
            "https://mode-backend-staging.onrender.com",
            "token",
            "hello",
            stop_after_first_token=True,
        )
    )

    assert result["ok"] is True
    assert result["first_token_ms"] == result["ttft_ms"]
    assert result["done_seen"] is False
    assert result["last_event"] == "token"
    assert result["stopped_after_first_token"] is True
    assert request_bodies[0]["client_context"]["launch_gate_ttft_only"] is True
    assert yielded_lines == [
        "event: status",
        "data: {}",
        "event: token",
        'data: {"content":"hello"}',
    ]


def test_chat_stream_once_async_full_stream_does_not_send_ttft_only() -> None:
    module = _load_launch_verify_module()
    request_bodies = []

    class FakeAsyncResponse:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def aiter_lines(self):
            for line in (
                "event: token",
                'data: {"content":"hello"}',
                "event: done",
                "data: {}",
            ):
                yield line

    class FakeAsyncClient:
        def stream(self, *_args, **kwargs):
            request_bodies.append(kwargs["json"])
            return FakeAsyncResponse()

    result = asyncio.run(
        module._chat_stream_once_async(
            FakeAsyncClient(),
            "https://mode-backend-staging.onrender.com",
            "token",
            "hello",
        )
    )

    assert result["ok"] is True
    assert request_bodies[0]["client_context"] == {"launch_gate_smoke": True}


def test_parse_args_rejects_full_stream_with_stop_after_first_token() -> None:
    module = _load_launch_verify_module()

    try:
        module._parse_args(["--full-stream", "--chat-load-stop-after-first-token"])
    except SystemExit as exc:
        assert exc.code == 2
    else:
        raise AssertionError("Expected parser to reject incompatible full-stream flags")


def test_chat_stream_once_records_error_event_diagnostics(monkeypatch) -> None:
    module = _load_launch_verify_module()

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def getcode(self):
            return 200

        def __iter__(self):
            return iter(
                [
                    b"event: status\n",
                    b"data: {}\n",
                    b"event: token\n",
                    b'data: {"content":"hello"}\n',
                    b"event: error\n",
                    b'data: {"type":"error","detail":"provider_timeout"}\n',
                ]
            )

    monkeypatch.setattr(module, "urlopen", lambda *_args, **_kwargs: FakeResponse())

    result = module._chat_stream_once("https://mode-backend-staging.onrender.com", "token", 1.0, "hello")

    assert result["ok"] is False
    assert result["ttft_ms"] is not None
    assert result["done_seen"] is False
    assert result["error_seen"] is True
    assert isinstance(result["first_error_ms"], int)
    assert result["last_event"] == "error"
    assert "provider_timeout" in result["last_data"]


def test_chat_load_reuses_one_shared_async_client(monkeypatch) -> None:
    module = _load_launch_verify_module()
    clients = []
    seen_clients = []

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs
            clients.append(self)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    async def fake_chat_stream_once_async(client, *_args, **_kwargs):
        seen_clients.append(client)
        assert _kwargs["stop_after_first_token"] is False
        return {
            "ok": True,
            "status": 200,
            "request_id": "request",
            "ttft_ms": 25,
            "done_seen": True,
        }

    monkeypatch.setattr(module.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(module, "_chat_stream_once_async", fake_chat_stream_once_async)
    args = argparse.Namespace(
        base_url="https://mode-backend-staging.onrender.com",
        auth_token="token-a",
        auth_token_file=None,
        chat_load_requests=5,
        chat_load_concurrency=5,
        ttft_target_ms=2500,
        chat_load_stop_after_first_token=False,
    )

    result = module._chat_load(args)

    assert result.status == "PASS"
    assert len(clients) == 1
    assert len(seen_clients) == 5
    assert set(map(id, seen_clients)) == {id(clients[0])}
    assert clients[0].kwargs["timeout"] == 30.0
    limits = clients[0].kwargs["limits"]
    assert limits.max_connections is None
    assert limits.max_keepalive_connections == 50


def test_full_stream_chat_load_reports_percentiles(monkeypatch) -> None:
    module = _load_launch_verify_module()

    async def fake_run_chat_load_requests(_args, _tokens):
        return [
            {"ok": True, "status": 200, "ttft_ms": 10, "total_ms": 100, "done_seen": True},
            {"ok": True, "status": 200, "ttft_ms": 20, "total_ms": 200, "done_seen": True},
            {"ok": True, "status": 200, "ttft_ms": 30, "total_ms": 300, "done_seen": True},
        ]

    monkeypatch.setattr(module, "_run_chat_load_requests", fake_run_chat_load_requests)
    args = argparse.Namespace(
        base_url="https://mode-backend-staging.onrender.com",
        auth_token="token-a",
        auth_token_file=None,
        chat_load_requests=3,
        chat_load_concurrency=3,
        timeout_seconds=8.0,
        ttft_target_ms=30,
        full_stream=True,
        chat_load_stop_after_first_token=False,
        chat_load_max_error_rate=0,
        chat_load_min_semaphore_429s=0,
    )

    result = module._chat_load(args)

    assert result.status == "PASS"
    assert result.name == "chat_full_stream_load"
    assert result.metrics["ttft_p50_ms"] == 20
    assert result.metrics["ttft_p95_ms"] == 30
    assert result.metrics["ttft_p99_ms"] == 30
    assert result.metrics["total_stream_p50_ms"] == 200
    assert result.metrics["total_stream_p95_ms"] == 300
    assert result.metrics["total_stream_p99_ms"] == 300


def test_full_stream_chat_load_counts_error_rate_and_429s(monkeypatch) -> None:
    module = _load_launch_verify_module()

    async def fake_run_chat_load_requests(_args, _tokens):
        return [
            {"ok": True, "status": 200, "ttft_ms": 25, "total_ms": 100, "done_seen": True},
            {"ok": False, "status": 429, "total_ms": 3, "error": "Stream capacity exceeded. Retry shortly."},
            {"ok": False, "status": 500, "total_ms": 50, "error": "server error"},
            {"ok": False, "status": None, "total_ms": 80, "transport_error": True, "error": "disconnect"},
        ]

    monkeypatch.setattr(module, "_run_chat_load_requests", fake_run_chat_load_requests)
    args = argparse.Namespace(
        base_url="https://mode-backend-staging.onrender.com",
        auth_token="token-a",
        auth_token_file=None,
        chat_load_requests=4,
        chat_load_concurrency=4,
        timeout_seconds=8.0,
        ttft_target_ms=None,
        full_stream=True,
        chat_load_stop_after_first_token=False,
        chat_load_max_error_rate=1.0,
        chat_load_min_semaphore_429s=1,
    )

    result = module._chat_load(args)

    assert result.status == "PASS"
    assert result.metrics["error_count"] == 3
    assert result.metrics["error_rate"] == 0.75
    assert result.metrics["non_200_count"] == 2
    assert result.metrics["disconnect_or_transport_count"] == 1
    assert result.metrics["semaphore_429_count"] == 1


def test_full_stream_chat_load_fails_when_required_429_missing(monkeypatch) -> None:
    module = _load_launch_verify_module()

    async def fake_run_chat_load_requests(_args, _tokens):
        return [{"ok": True, "status": 200, "ttft_ms": 25, "total_ms": 100, "done_seen": True}]

    monkeypatch.setattr(module, "_run_chat_load_requests", fake_run_chat_load_requests)
    args = argparse.Namespace(
        base_url="https://mode-backend-staging.onrender.com",
        auth_token="token-a",
        auth_token_file=None,
        chat_load_requests=1,
        chat_load_concurrency=1,
        timeout_seconds=8.0,
        ttft_target_ms=None,
        full_stream=True,
        chat_load_stop_after_first_token=False,
        chat_load_max_error_rate=None,
        chat_load_min_semaphore_429s=1,
    )

    result = module._chat_load(args)

    assert result.status == "FAIL"
    assert "semaphore 429 count 0 below required 1" in result.detail


def test_healthz_uses_server_duration_for_latency_gate(monkeypatch) -> None:
    module = _load_launch_verify_module()

    def fake_request(*_args, **_kwargs):
        payload = {
            "status": "ok",
            "ok": True,
            "db": "ok",
            "redis": "ok",
            "queue": "ok",
            "duration_ms": 12,
            "cache_age_ms": 100,
            "checks": {"db": {}, "redis": {}, "queue": {}},
        }
        return 200, json.dumps(payload), 220

    monkeypatch.setattr(module, "_request", fake_request)

    result = module._health_check(_health_args())

    assert result.status == "PASS"
    assert result.metrics["client_p95_ms"] == 220
    assert result.metrics["server_duration_p95_ms"] == 12
    assert "client round-trip p95 220ms exceeds target" in result.detail
