from __future__ import annotations

import re


INJECTION_PATTERNS: tuple[tuple[str, str], ...] = (
    ("ignore_previous_instructions", r"ignore (previous|above|all) instructions"),
    ("role_reassignment", r"\byou are now\b"),
    ("prompt_reveal", r"reveal (your|the) (system|prompt|instructions)"),
    ("pretend_instruction", r"\bpretend you\b"),
    ("act_as_if_instruction", r"\bact as if\b"),
    ("dan_jailbreak", r"\bDAN\b"),
    ("developer_mode", r"\bdeveloper mode\b"),
)


def sanitize_user_input(text: str) -> tuple[str, list[str]]:
    """Return normalized text plus prompt-injection flags for logging/routing."""
    sanitized = str(text or "").strip()
    flags: list[str] = []
    for flag, pattern in INJECTION_PATTERNS:
        if re.search(pattern, sanitized, flags=re.IGNORECASE):
            flags.append(flag)
    return sanitized, sorted(set(flags))
