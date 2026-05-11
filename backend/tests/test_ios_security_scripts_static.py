from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
LINT_SCRIPT = REPO_ROOT / "scripts" / "ios_hardening_lint.py"
ARTIFACT_SCRIPT = REPO_ROOT / "scripts" / "ios_artifact_scan.py"


def test_ios_hardening_lint_script_exists_with_required_checks() -> None:
    assert LINT_SCRIPT.exists(), "Expected scripts/ios_hardening_lint.py"
    source = LINT_SCRIPT.read_text(encoding="utf-8")
    assert "NSAppTransportSecurity" in source
    assert "associatedDomains" in source
    assert "EXPO_PUBLIC_SUPABASE_REDIRECT_URL" in source
    assert "Sensitive logging patterns detected" in source


def test_ios_artifact_scan_script_exists_with_required_patterns() -> None:
    assert ARTIFACT_SCRIPT.exists(), "Expected scripts/ios_artifact_scan.py"
    source = ARTIFACT_SCRIPT.read_text(encoding="utf-8")
    assert "MODE_IOS_IPA_PATH" in source
    assert "SUPABASE_SERVICE_ROLE_KEY" in source
    assert "staging_or_local_urls" in source
    assert "debug_flags_or_verbose_logs" in source
    assert "NSAllowsArbitraryLoads" in source
    assert "CFBundleURLTypes" in source
