import subprocess
import sys
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
LINT_SCRIPT = REPO_ROOT / "scripts" / "ios_hardening_lint.py"
ARTIFACT_SCRIPT = REPO_ROOT / "scripts" / "ios_artifact_scan.py"
SECRET_SCAN_SCRIPT = REPO_ROOT / "scripts" / "security_scan_secrets.sh"


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
    assert "stale_expo_metadata" in source
    assert "sdkVersion" in source
    assert "debug_flags_or_verbose_logs" in source
    assert "NSAllowsArbitraryLoads" in source
    assert "CFBundleURLTypes" in source
    assert "STREAM_CHUNK_BYTES" in source
    assert "TEXT_SCAN_OVERLAP_BYTES" in source
    assert ".jsbundle" in source


def test_ios_artifact_scan_streams_large_jsbundle_members(tmp_path) -> None:
    ipa_path = tmp_path / "mode-large.ipa"
    fake_key = "sk-proj-" + ("A" * 24)
    payload = (b"safe-prefix\n" * 256) + (b"x" * (6 * 1024 * 1024)) + b"\n" + fake_key.encode("utf-8")

    with zipfile.ZipFile(ipa_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("Payload/MODE.app/main.jsbundle", payload)

    completed = subprocess.run(
        [sys.executable, str(ARTIFACT_SCRIPT), "--ipa", str(ipa_path)],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 1
    assert "private_api_keys:Payload/MODE.app/main.jsbundle" in completed.stdout
    assert fake_key not in completed.stdout


def test_secret_scan_script_reports_redacted_matches_only() -> None:
    assert SECRET_SCAN_SCRIPT.exists(), "Expected scripts/security_scan_secrets.sh"
    source = SECRET_SCAN_SCRIPT.read_text(encoding="utf-8")
    assert "_redact_stream" in source
    assert "--help" in source
    assert "MODE_SECURITY_SCAN_USE_EXTERNAL_TOOLS" in source
    assert "MODE_SECURITY_SCAN_INCLUDE_ENV" in source
    assert "--no-ignore" in source
    assert "including ignored local env files with redacted output" in source
    assert "_run_tool_with_redaction gitleaks detect" in source
    assert "_run_tool_with_redaction trufflehog filesystem" in source
    assert "!.env.release" in source
    assert "!.env.staging" in source
    assert "tracked_risky_env_file" in source
    assert "suspicious_secret_path" in source
    assert "git ls-files --others --exclude-standard" in source
    assert "temp_token.txt" in source
    assert "--only-matching" in source
    assert "--replace" in source
    assert "[redacted]" in source
    assert "redacted matches above" in source
