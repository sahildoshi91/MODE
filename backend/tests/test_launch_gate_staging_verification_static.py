import argparse
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
    assert "20260426e_add_distributed_rate_limits_and_rpc_execute_allowlist.sql" in source
    assert "20260426f_lockdown_storage_objects_service_signed_urls_only.sql" not in source
    assert "20260426g_add_account_deletion_audit_log.sql" in source
    assert storage_lifecycle in source
    assert "20260426i_add_storage_cleanup_job_heartbeats.sql" in source
    assert source.index(storage_lifecycle) < source.index(service_role_retirement)
    assert "must be applied before" in source
    assert "public.storage_upload_grants" in source


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
            "checks": {"db": {}, "redis": {}, "queue": {}},
        }
        return 200, json.dumps(payload), 220

    monkeypatch.setattr(module, "_request", fake_request)

    result = module._health_check(_health_args())

    assert result.status == "PASS"
    assert result.metrics["client_p95_ms"] == 220
    assert result.metrics["server_duration_p95_ms"] == 12
    assert "client round-trip p95 220ms exceeds target" in result.detail
