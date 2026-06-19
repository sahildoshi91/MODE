from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "storage_orphan_cleanup.py"
RENDER_YAML_PATH = REPO_ROOT.parent / "render.yaml"


def test_storage_orphan_cleanup_script_exists() -> None:
    assert SCRIPT_PATH.exists(), "Expected storage_orphan_cleanup.py to exist"


def test_storage_orphan_cleanup_script_has_required_keywords() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "dry-run" in source
    assert "Storage orphan cleanup: PASSED" in source
    assert "run_cleanup" in source
    assert "record_cleanup_heartbeat" in source
    assert "run-source" in source
    assert "expected-interval-minutes" in source
    assert "release_gate" in source
    assert "scheduled" in source


def test_render_yaml_has_storage_cleanup_cron_with_run_source_scheduled() -> None:
    assert RENDER_YAML_PATH.exists(), "Expected render.yaml to exist"
    payload = yaml.safe_load(RENDER_YAML_PATH.read_text(encoding="utf-8"))
    services = payload.get("services", [])
    cron_services = [s for s in services if s.get("type") == "cron"]
    assert cron_services, "No cron service found in render.yaml"
    cleanup_crons = [
        s for s in cron_services
        if "--run-source scheduled" in str(s.get("startCommand", ""))
    ]
    assert cleanup_crons, (
        "No cron service in render.yaml uses --run-source scheduled in startCommand"
    )
    cron = cleanup_crons[0]
    assert "--expected-interval-minutes" in str(cron.get("startCommand", "")), (
        "Storage cleanup cron must pass --expected-interval-minutes"
    )
    assert cron.get("plan") == "starter", "Storage cleanup cron must use plan: starter"


def test_render_yaml_does_not_trust_all_forwarded_proxy_headers() -> None:
    assert RENDER_YAML_PATH.exists(), "Expected render.yaml to exist"
    payload = yaml.safe_load(RENDER_YAML_PATH.read_text(encoding="utf-8"))
    services = payload.get("services", [])
    wildcard_proxy_services = [
        s.get("name", "<unnamed>")
        for s in services
        if '--forwarded-allow-ips="*"' in str(s.get("startCommand", ""))
        or "--forwarded-allow-ips=*" in str(s.get("startCommand", ""))
    ]
    assert not wildcard_proxy_services, (
        "Render services must not use wildcard forwarded proxy trust: "
        f"{wildcard_proxy_services}"
    )
