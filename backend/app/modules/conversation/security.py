from __future__ import annotations

import re
from typing import Any


INJECTION_PATTERNS: tuple[tuple[str, str], ...] = (
    ("ignore_previous_instructions", r"ignore (previous|above|all) instructions"),
    ("role_reassignment", r"\byou are now\b"),
    ("prompt_reveal", r"reveal (your|the) (system|prompt|instructions)"),
    ("pretend_instruction", r"\bpretend you\b"),
    ("act_as_if_instruction", r"\bact as if\b"),
    ("dan_jailbreak", r"\bDAN\b"),
    ("developer_mode", r"\bdeveloper mode\b"),
)

OUTPUT_BLOCK_PATTERNS: tuple[tuple[str, str], ...] = (
    ("schema_tenant_leakage", r"\b(trainer_id|client_id|org_id)\s*[:=]\s*['\"]?[A-Za-z0-9_-]+"),
    ("prompt_reflection", r"\b(system prompt|instructions say|I am instructed)\b"),
    ("sql_in_output", r"\b(SELECT|INSERT|UPDATE|DELETE)\s+[A-Za-z_][A-Za-z0-9_]*\b"),
)

REDACT_FROM_LOGS = {
    "message_content",
    "response_content",
    "safety_flag_description",
    "client_name",
    "injury_description",
}

_REDACTION = "[redacted]"


def sanitize_user_input(text: str) -> tuple[str, list[str]]:
    """Return normalized text plus prompt-injection flags for logging/routing."""
    sanitized = str(text or "").strip()
    flags: list[str] = []
    for flag, pattern in INJECTION_PATTERNS:
        if re.search(pattern, sanitized, flags=re.IGNORECASE):
            flags.append(flag)
    return sanitized, sorted(set(flags))


def validate_llm_output(text: str, trainer_id: str | None, client_id: str | None) -> tuple[str, list[str]]:
    """Redact unsafe model output before the app acts on it or streams it."""
    safe_text = str(text or "")
    flags: list[str] = []

    for flag, pattern in OUTPUT_BLOCK_PATTERNS:
        if re.search(pattern, safe_text, flags=re.IGNORECASE):
            flags.append(flag)
            safe_text = re.sub(pattern, _REDACTION, safe_text, flags=re.IGNORECASE)

    for scope, value in (("trainer_id", trainer_id), ("client_id", client_id)):
        normalized = str(value or "").strip()
        if normalized and normalized in safe_text:
            flags.append(f"{scope}_echo")
            safe_text = safe_text.replace(normalized, _REDACTION)

    return safe_text, sorted(set(flags))


def redact_log_payload(payload: dict[str, Any]) -> dict[str, Any]:
    redacted: dict[str, Any] = {}
    for key, value in payload.items():
        key_text = str(key)
        if key_text in REDACT_FROM_LOGS:
            redacted[key_text] = _REDACTION
        elif isinstance(value, dict):
            redacted[key_text] = redact_log_payload(value)
        elif isinstance(value, list):
            redacted[key_text] = [
                redact_log_payload(item) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            redacted[key_text] = value
    return redacted
