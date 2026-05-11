#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from supabase import create_client


REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_KEYS = {"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"}


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key in ENV_KEYS and not os.getenv(key):
            os.environ[key] = value.strip().strip('"').strip("'")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only audit of trainer Coach AI check-in analytics.",
    )
    parser.add_argument(
        "--env-file",
        action="append",
        default=None,
        help="Env file to load. Defaults to .env.release then .env.",
    )
    parser.add_argument(
        "--timezone",
        default="America/Los_Angeles",
        help="Local timezone used by the mobile app date calculation.",
    )
    parser.add_argument(
        "--date",
        default=None,
        help="Selected local date in YYYY-MM-DD. Defaults to today in --timezone.",
    )
    parser.add_argument(
        "--trainer-id",
        default=None,
        help="Optional exact trainer id to filter the audit.",
    )
    return parser.parse_args()


def coerce_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def normalized_mode(value: Any) -> str:
    mode = str(value or "").strip().upper()
    return {
        "GREEN": "BEAST",
        "YELLOW": "BUILD",
        "BLUE": "RECOVER",
        "RED": "REST",
    }.get(mode, mode)


def tail(value: Any) -> str:
    text = str(value or "")
    return text[-6:] if len(text) > 6 else text


def previous_7_dates(target_date: date) -> list[date]:
    return [target_date - timedelta(days=offset) for offset in range(1, 8)]


def is_low_readiness(row: dict[str, Any]) -> bool:
    score = row.get("total_score")
    try:
        if score is not None and float(score) <= 15:
            return True
    except (TypeError, ValueError):
        pass
    return normalized_mode(row.get("assigned_mode")) in {"RECOVER", "REST"}


def main() -> int:
    args = parse_args()
    env_files = args.env_file or [".env.release", ".env"]
    for env_file in env_files:
        load_env_file((REPO_ROOT / env_file).resolve())

    supabase_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")

    selected_date = date.fromisoformat(args.date) if args.date else datetime.now(ZoneInfo(args.timezone)).date()
    utc_date = datetime.now(timezone.utc).date()
    recent_start = selected_date - timedelta(days=7)
    week_start = selected_date - timedelta(days=6)
    client = create_client(supabase_url, service_key)

    trainer_query = client.table("trainers").select("id, user_id, created_at").order("created_at", desc=True)
    if args.trainer_id:
        trainer_query = trainer_query.eq("id", args.trainer_id)
    trainers = trainer_query.execute().data or []
    trainer_ids = [row["id"] for row in trainers if row.get("id")]

    client_rows: list[dict[str, Any]] = []
    if trainer_ids:
        client_rows = (
            client.table("clients")
            .select("id, assigned_trainer_id, created_at")
            .in_("assigned_trainer_id", trainer_ids)
            .execute()
            .data or []
        )
    client_ids = [row["id"] for row in client_rows if row.get("id")]

    checkins: list[dict[str, Any]] = []
    if client_ids:
        checkins = (
            client.table("daily_checkins")
            .select("client_id, date, total_score, assigned_mode")
            .in_("client_id", client_ids)
            .gte("date", recent_start.isoformat())
            .lte("date", selected_date.isoformat())
            .order("date", desc=True)
            .execute()
            .data or []
        )

    sessions: list[dict[str, Any]] = []
    if trainer_ids:
        sessions = (
            client.table("chat_sessions")
            .select("id, trainer_id, session_date, created_at")
            .in_("trainer_id", trainer_ids)
            .eq("role", "trainer")
            .eq("session_type", "coach_ai")
            .order("created_at", desc=True)
            .limit(50)
            .execute()
            .data or []
        )
    session_ids = [row["id"] for row in sessions if row.get("id")]
    opening_messages: list[dict[str, Any]] = []
    if session_ids:
        opening_messages = (
            client.table("chat_messages")
            .select("session_id, metadata, content, created_at")
            .in_("session_id", session_ids)
            .contains("metadata", {"auto_generated_opening_summary": True})
            .execute()
            .data or []
        )

    checkins_by_client: dict[str, list[dict[str, Any]]] = {}
    for row in checkins:
        checkins_by_client.setdefault(str(row.get("client_id")), []).append(row)

    clients_by_trainer: dict[str, list[dict[str, Any]]] = {}
    for row in client_rows:
        clients_by_trainer.setdefault(str(row.get("assigned_trainer_id")), []).append(row)

    openings_by_trainer: dict[str, list[dict[str, Any]]] = {}
    session_by_id = {str(row.get("id")): row for row in sessions}
    for row in opening_messages:
        session = session_by_id.get(str(row.get("session_id"))) or {}
        trainer_id = str(session.get("trainer_id") or "")
        openings_by_trainer.setdefault(trainer_id, []).append({**row, "session": session})

    print(f"audit_local_date={selected_date.isoformat()} audit_utc_date={utc_date.isoformat()}")
    print(f"trainers={len(trainers)} assigned_clients={len(client_rows)} checkin_rows={len(checkins)} coach_ai_openings={len(opening_messages)}")

    for trainer in trainers:
        trainer_id = str(trainer.get("id"))
        roster = clients_by_trainer.get(trainer_id, [])
        print(f"\ntrainer_tail={tail(trainer_id)} assigned_clients={len(roster)}")
        trainer_recent_missed_days = 0
        trainer_clients_with_recent_misses = 0
        trainer_today_missing = 0
        trainer_clients_with_recent_low = 0

        for row in roster:
            client_id = str(row.get("id"))
            created_date = coerce_date(row.get("created_at"))
            rows = checkins_by_client.get(client_id, [])
            completed_dates = {
                parsed
                for item in rows
                if (parsed := coerce_date(item.get("date"))) is not None
            }
            expected_dates = [
                day for day in previous_7_dates(selected_date)
                if created_date is None or day >= created_date
            ]
            missed_dates = [day for day in expected_dates if day not in completed_dates]
            recent_low_dates = sorted({
                row_date
                for item in rows
                if (row_date := coerce_date(item.get("date"))) is not None
                and week_start <= row_date <= selected_date
                and is_low_readiness(item)
            }, reverse=True)

            if selected_date not in completed_dates:
                trainer_today_missing += 1
            if missed_dates:
                trainer_clients_with_recent_misses += 1
            if recent_low_dates:
                trainer_clients_with_recent_low += 1
            trainer_recent_missed_days += len(missed_dates)

            print(
                "  "
                f"client_tail={tail(client_id)} "
                f"checkin_dates={[day.isoformat() for day in sorted(completed_dates, reverse=True)]} "
                f"missed_prev7={[day.isoformat() for day in missed_dates]} "
                f"recent_low_dates={[day.isoformat() for day in recent_low_dates]}"
            )

        print(
            "  "
            f"computed_counts today_missing_checkins={trainer_today_missing} "
            f"clients_with_recent_missed_checkins={trainer_clients_with_recent_misses} "
            f"recent_missed_checkin_days={trainer_recent_missed_days} "
            f"clients_with_recent_low_readiness={trainer_clients_with_recent_low}"
        )
        for opening in openings_by_trainer.get(trainer_id, [])[:3]:
            metadata = opening.get("metadata") if isinstance(opening.get("metadata"), dict) else {}
            session = opening.get("session") if isinstance(opening.get("session"), dict) else {}
            print(
                "  "
                f"opening_session_date={session.get('session_date')} "
                f"summary_source={metadata.get('summary_source')} "
                f"today_missing_checkins={metadata.get('today_missing_checkins')} "
                f"recent_missed_checkin_days={metadata.get('recent_missed_checkin_days')} "
                f"clients_with_recent_low_readiness={metadata.get('clients_with_recent_low_readiness')} "
                f"fingerprint={metadata.get('analytics_fingerprint')}"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
