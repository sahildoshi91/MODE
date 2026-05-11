from typing import Any


MOTIVATION_BASELINE_FALLBACK = "general fitness"


def clean_motivation_text(value: Any, *, limit: int = 500) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.strip().split())
    if not normalized:
        return None
    return normalized[:limit]


def resolve_motivation_baseline(
    profile: dict[str, Any] | None,
    *,
    fallback: str = MOTIVATION_BASELINE_FALLBACK,
    limit: int = 500,
) -> str:
    payload = profile if isinstance(profile, dict) else {}
    for key in ("user_why", "primary_goal"):
        value = clean_motivation_text(payload.get(key), limit=limit)
        if value:
            return value
    return fallback


def build_mindset_why_cue(
    base_cue: Any,
    user_why: Any,
    *,
    why_word_limit: int = 24,
) -> str:
    cue = clean_motivation_text(base_cue, limit=180) or "Show up with disciplined reps."
    why = clean_motivation_text(user_why, limit=500)
    if not why:
        return _punctuate(cue)

    if why_word_limit > 0:
        words = why.split()
        if len(words) > why_word_limit:
            why = f"{' '.join(words[:why_word_limit]).rstrip('.,;:')}..."

    return f"{_punctuate(cue)} Remember why: {_punctuate(why)}"


def _punctuate(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text[-1] in ".!?":
        return text
    return f"{text}."
