import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RELEASE_TEMPLATE = REPO_ROOT / ".env.release.example"
STAGING_TEMPLATE = REPO_ROOT / ".env.staging.example"
SHARED_TEMPLATE = REPO_ROOT / ".env.example"
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
    _assert_placeholder_only_template(SHARED_TEMPLATE)
    _assert_placeholder_only_template(RELEASE_TEMPLATE)
    _assert_placeholder_only_template(STAGING_TEMPLATE)


def test_chat_stream_semaphore_env_documented() -> None:
    shared = SHARED_TEMPLATE.read_text(encoding="utf-8")
    staging = STAGING_TEMPLATE.read_text(encoding="utf-8")
    release = RELEASE_TEMPLATE.read_text(encoding="utf-8")

    assert "MAX_ACTIVE_CHAT_STREAMS_PER_INSTANCE=<15_for_staging_or_10_for_production>" in shared
    assert "MAX_ACTIVE_CHAT_STREAMS_PER_INSTANCE=<15>" in staging
    assert "MAX_ACTIVE_CHAT_STREAMS_PER_INSTANCE=<10>" in release
    assert "USE_FAKE_PROVIDER=<false>" in staging
    assert "USE_FAKE_PROVIDER=<false>" in release
    assert "CHAT_STREAM_PROVIDER_WORKER_THREADS=<50>" in staging
    assert "CHAT_STREAM_PROVIDER_WORKER_THREADS=<50>" in release
    assert "CHAT_STAGING_OPENAI_ONLY=<false>" in staging
    assert "CHAT_STAGING_OPENAI_ONLY=<false>" in release


def test_release_env_templates_document_redis_chat_rate_controls() -> None:
    staging = STAGING_TEMPLATE.read_text(encoding="utf-8")
    release = RELEASE_TEMPLATE.read_text(encoding="utf-8")

    required_placeholders = [
        "RATE_LIMIT_BACKEND=<redis>",
        "RATE_LIMIT_ENABLED=<true>",
        "RATE_LIMIT_WINDOW_SECONDS=<60>",
        "RATE_LIMIT_CHAT_PER_WINDOW=<30>",
        "RATE_LIMIT_CHAT_CLIENT_PER_WINDOW=<20>",
        "RATE_LIMIT_CHAT_TRAINER_PER_WINDOW=<200>",
        "RATE_LIMIT_CHAT_IP_PER_WINDOW=<500>",
        "RATE_LIMIT_IP_PER_WINDOW=<1000>",
    ]
    for placeholder in required_placeholders:
        assert placeholder in staging
        assert placeholder in release


def test_env_templates_document_launch_chat_controls_and_legal_urls() -> None:
    shared = SHARED_TEMPLATE.read_text(encoding="utf-8")
    staging = STAGING_TEMPLATE.read_text(encoding="utf-8")
    release = RELEASE_TEMPLATE.read_text(encoding="utf-8")

    required_keys = [
        "EXPO_PUBLIC_PRIVACY_POLICY_URL=",
        "EXPO_PUBLIC_TERMS_URL=",
        "EXPO_PUBLIC_SUPPORT_URL=",
        "CHAT_ENABLED=",
        "STREAMING_ENABLED=",
        "LLM_PROVIDER_ENABLED=",
        "MEMORY_WRITES_ENABLED=",
        "CHAT_PROVIDER_TIMEOUT_SECONDS=",
        "CHAT_MAX_OUTPUT_TOKENS=",
        "GLOBAL_CHAT_RATE_LIMIT=",
        "PER_USER_CHAT_RATE_LIMIT=",
    ]
    for key in required_keys:
        assert key in shared
        assert key in staging
        assert key in release


def test_release_env_files_are_gitignored() -> None:
    source = GITIGNORE_PATH.read_text(encoding="utf-8")
    assert ".env.release" in source
    assert ".env.staging" in source
