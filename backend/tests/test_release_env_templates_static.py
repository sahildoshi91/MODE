import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RELEASE_TEMPLATE = REPO_ROOT / ".env.release.example"
STAGING_TEMPLATE = REPO_ROOT / ".env.staging.example"
GITIGNORE_PATH = REPO_ROOT / ".gitignore"

BANNED_SECRET_PATTERNS = [
    re.compile(r"\bsb_secret_[A-Za-z0-9._-]{10,}\b"),
    re.compile(r"\bsk_live_[A-Za-z0-9]{10,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b"),
]


def _assert_placeholder_only_template(path: Path) -> None:
    assert path.exists(), f"Expected template file to exist: {path}"
    source = path.read_text(encoding="utf-8")
    assert source.strip(), f"Template file is empty: {path}"

    for pattern in BANNED_SECRET_PATTERNS:
        assert not pattern.search(source), f"Potential real secret detected in template {path}: {pattern.pattern}"

    for line_number, raw_line in enumerate(source.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        assert "=" in line, f"{path}:{line_number} must use KEY=VALUE format"
        key, value = line.split("=", 1)
        assert key.strip(), f"{path}:{line_number} has empty key"
        assert value.strip(), f"{path}:{line_number} has empty placeholder value"
        assert "<" in value and ">" in value, f"{path}:{line_number} must use placeholder-only values"


def test_release_env_templates_are_placeholder_only_and_secret_safe() -> None:
    _assert_placeholder_only_template(RELEASE_TEMPLATE)
    _assert_placeholder_only_template(STAGING_TEMPLATE)


def test_release_env_files_are_gitignored() -> None:
    source = GITIGNORE_PATH.read_text(encoding="utf-8")
    assert ".env.release" in source
    assert ".env.staging" in source
