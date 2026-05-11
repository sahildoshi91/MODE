from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta
from typing import Any


CHECKIN_SIGNAL_SUMMARY_VERSION = "checkin_signals_v1"

CHECKIN_SIGNAL_QUESTIONS = (
    {"key": "sleep", "label": "Sleep"},
    {"key": "stress", "label": "Stress"},
    {"key": "soreness", "label": "Soreness"},
    {"key": "nutrition", "label": "Nutrition"},
    {"key": "motivation", "label": "Motivation"},
)


def build_checkin_question_summaries(
    checkins: list[dict[str, Any]],
    target_date: date,
) -> list[dict[str, Any]]:
    dates = [target_date - timedelta(days=offset) for offset in range(7)]
    checkins_by_date: dict[date, dict[str, Any]] = {}
    for row in checkins:
        row_date = _coerce_date(row.get("date"))
        if row_date is None or row_date not in dates:
            continue
        checkins_by_date[row_date] = row

    summaries: list[dict[str, Any]] = []
    for question in CHECKIN_SIGNAL_QUESTIONS:
        key = question["key"]
        daily_responses: list[dict[str, Any]] = []
        scores: list[int] = []
        latest_score: int | None = None
        latest_date: date | None = None
        low_days = 0

        for response_date in dates:
            row = checkins_by_date.get(response_date)
            inputs = _coerce_inputs((row or {}).get("inputs"))
            score = _coerce_score(inputs.get(key)) if inputs else None
            if score is not None:
                scores.append(score)
                if score <= 2:
                    low_days += 1
                if latest_score is None:
                    latest_score = score
                    latest_date = response_date
            daily_responses.append(
                {
                    "date": response_date,
                    "score": score,
                }
            )

        average = round(sum(scores) / len(scores), 2) if scores else None
        summaries.append(
            {
                "key": key,
                "label": question["label"],
                "average_7d": average,
                "responses_7d": len(scores),
                "low_days_7d": low_days,
                "latest_score": latest_score,
                "latest_date": latest_date,
                "status": _signal_status(average),
                "daily_responses": daily_responses,
            }
        )

    return summaries


def build_signal_fingerprint(question_summaries: list[Any]) -> str:
    normalized = []
    for summary in question_summaries:
        getter = summary.get if isinstance(summary, dict) else lambda name, default=None: getattr(summary, name, default)
        normalized.append(
            {
                "key": getter("key"),
                "average_7d": getter("average_7d"),
                "responses_7d": getter("responses_7d"),
                "low_days_7d": getter("low_days_7d"),
                "latest_score": getter("latest_score"),
                "latest_date": _json_date(getter("latest_date")),
                "status": getter("status"),
            }
        )
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _signal_status(average: float | None) -> str:
    if average is None:
        return "no_data"
    if average <= 2.5:
        return "low"
    if average <= 3.4:
        return "watch"
    return "steady"


def _coerce_inputs(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _coerce_score(value: Any) -> int | None:
    try:
        score = int(value)
    except (TypeError, ValueError):
        return None
    if score < 1 or score > 5:
        return None
    return score


def _coerce_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _json_date(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if value is None:
        return None
    return str(value)
