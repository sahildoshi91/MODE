from __future__ import annotations

import re
from dataclasses import dataclass


FLUFF_PATTERNS = (
    r"\btired today\b",
    r"\brough day\b",
    r"\bjoke\b",
    r"\bpizza\b",
    r"\bskipped a meal\b",
)

LONG_LIVED_PATTERNS = (
    ("injury", r"\b(chronic|recurring|ongoing|history of|tendinopathy|knee pain|back pain|shoulder pain|injury)\b"),
    ("preference", r"\b(train best|prefer|preference|morning|evening|6[- ]?9am|travel|work schedule)\b"),
    ("goal", r"\b(primary motivation|my why|goal is|for my kids|long[- ]?term)\b"),
    ("constraint", r"\b(no equipment|limited equipment|work travel|cannot|can't|avoid)\b"),
)


@dataclass(frozen=True)
class MemoryWriteCandidate:
    should_write: bool
    memory_type: str = "behavioral_note"
    category: str = "other"
    text: str = ""
    reason: str = ""


def evaluate_memory_write(text: str) -> MemoryWriteCandidate:
    normalized = " ".join(str(text or "").split())
    lowered = normalized.lower()
    if len(normalized) < 12:
        return MemoryWriteCandidate(False, reason="too_short")
    if any(re.search(pattern, lowered, flags=re.IGNORECASE) for pattern in FLUFF_PATTERNS):
        return MemoryWriteCandidate(False, reason="fluff")
    for category, pattern in LONG_LIVED_PATTERNS:
        if re.search(pattern, lowered, flags=re.IGNORECASE):
            return MemoryWriteCandidate(
                True,
                memory_type="safety" if category == "injury" else "behavioral_note",
                category=category,
                text=normalized[:500],
                reason="long_lived_coaching_relevant",
            )
    return MemoryWriteCandidate(False, reason="not_long_lived")
