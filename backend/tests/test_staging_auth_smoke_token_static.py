import importlib.util
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "staging_auth_smoke_token.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("staging_auth_smoke_token_for_tests", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_staging_auth_smoke_token_script_exists_and_has_guarded_commands() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "create-token" in source
    assert "validate-token" in source
    assert "probe-admin-create-user" in source
    assert "APP_ENV=staging" in source
    assert "MODE_STAGING_AUTH_TOKEN" in source
    assert "SUPABASE_SERVICE_ROLE_KEY" in source
    assert "bootstrap_trainer_tenant" in source
    assert "assign_client_to_trainer" in source


def test_staging_auth_smoke_token_rejects_non_staging_env(monkeypatch) -> None:
    module = _load_module()
    monkeypatch.setattr(module.settings, "app_env", "production")
    monkeypatch.setattr(module.settings, "supabase_url", "https://example.supabase.co")

    try:
        module._require_staging()
    except RuntimeError as exc:
        assert "APP_ENV=staging" in str(exc)
    else:
        raise AssertionError("Expected non-staging environment to be rejected")


def test_staging_auth_smoke_token_project_ref_guard(monkeypatch) -> None:
    module = _load_module()
    monkeypatch.setattr(module.settings, "app_env", "staging")
    monkeypatch.setattr(module.settings, "supabase_url", "https://abc123.supabase.co")

    assert module._supabase_project_ref() == "abc123"
    try:
        module._require_staging(expected_supabase_ref="wrongref")
    except RuntimeError as exc:
        assert "project ref mismatch" in str(exc)
    else:
        raise AssertionError("Expected Supabase project ref mismatch to be rejected")
