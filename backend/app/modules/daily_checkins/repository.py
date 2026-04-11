from datetime import date
from typing import Any

from supabase import Client


class DailyCheckinRepositoryError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        code: str | None = None,
        hint: str | None = None,
        details: str | None = None,
        original: Exception | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.hint = hint
        self.details = details
        self.original = original

    @classmethod
    def from_exception(cls, message: str, exc: Exception):
        response = getattr(exc, "response", None)
        data = getattr(response, "json", None)

        payload = data() if callable(data) else {}
        if not isinstance(payload, dict):
            payload = {}

        if not payload and getattr(exc, "args", None):
            first_arg = exc.args[0]
            if isinstance(first_arg, dict):
                payload = first_arg

        if not payload:
            extracted_payload = {}
            for key in ("message", "code", "hint", "details"):
                value = getattr(exc, key, None)
                if value is not None:
                    extracted_payload[key] = value
            payload = extracted_payload

        return cls(
            payload.get("message") or message,
            status_code=getattr(response, "status_code", None),
            code=payload.get("code"),
            hint=payload.get("hint"),
            details=payload.get("details"),
            original=exc,
        )


class DailyCheckinRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_by_client_and_id(self, client_id: str, checkin_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("*")
            .eq("client_id", client_id)
            .eq("id", checkin_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_by_client_and_date(self, client_id: str, checkin_date: date) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("*")
            .eq("client_id", client_id)
            .eq("date", checkin_date.isoformat())
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_previous_checkin(self, client_id: str, before_date: date) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("*")
            .eq("client_id", client_id)
            .lt("date", before_date.isoformat())
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_checkin_dates_on_or_before(self, client_id: str, on_or_before: date) -> list[date]:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("date")
            .eq("client_id", client_id)
            .lte("date", on_or_before.isoformat())
            .order("date", desc=True)
            .execute()
        )
        return [date.fromisoformat(row["date"]) for row in response.data or [] if row.get("date")]

    def list_checkins_on_or_before(self, client_id: str, on_or_before: date) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("date,total_score,assigned_mode")
            .eq("client_id", client_id)
            .lte("date", on_or_before.isoformat())
            .order("date", desc=True)
            .execute()
        )
        return response.data or []

    def upsert_checkin(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = (
                self.supabase
                .table("daily_checkins")
                .upsert(payload, on_conflict="client_id,date")
                .execute()
            )
        except Exception as exc:
            raise DailyCheckinRepositoryError.from_exception("Failed to save daily check-in", exc) from exc

        if response.data:
            return response.data[0]

        record = self.get_by_client_and_date(payload["client_id"], date.fromisoformat(payload["date"]))
        if record:
            return record

        raise DailyCheckinRepositoryError(
            "Daily check-in save completed without a readable row",
            details="The write returned no row and a follow-up lookup by client and date found no daily_checkins record.",
        )

    def upsert_generated_plan(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = (
                self.supabase
                .table("generated_checkin_plans")
                .upsert(payload, on_conflict="client_id,checkin_id,plan_type")
                .execute()
            )
        except Exception as exc:
            raise DailyCheckinRepositoryError.from_exception("Failed to save generated check-in plan", exc) from exc

        if response.data:
            return response.data[0]

        raise DailyCheckinRepositoryError(
            "Generated plan save completed without a readable row",
            details=(
                "The write returned no row for generated_checkin_plans. "
                "This can happen when table policies reject visibility after insert/update."
            ),
        )

    def insert_generated_plan(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = (
                self.supabase
                .table("generated_checkin_plans")
                .insert(payload)
                .execute()
            )
        except Exception as exc:
            raise DailyCheckinRepositoryError.from_exception("Failed to save generated check-in plan", exc) from exc

        if response.data:
            return response.data[0]

        raise DailyCheckinRepositoryError(
            "Generated plan save completed without a readable row",
            details=(
                "The insert returned no row for generated_checkin_plans. "
                "This can happen when table policies reject visibility after insert."
            ),
        )

    def get_latest_generated_plan_variant(
        self,
        client_id: str,
        checkin_id: str,
        plan_type: str,
        request_fingerprint: str,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("generated_checkin_plans")
            .select("*")
            .eq("client_id", client_id)
            .eq("checkin_id", checkin_id)
            .eq("plan_type", plan_type)
            .eq("request_fingerprint", request_fingerprint)
            .order("revision_number", desc=True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_latest_generated_plan_from_other_fingerprints(
        self,
        client_id: str,
        checkin_id: str,
        plan_type: str,
        request_fingerprint: str,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("generated_checkin_plans")
            .select("*")
            .eq("client_id", client_id)
            .eq("checkin_id", checkin_id)
            .eq("plan_type", plan_type)
            .neq("request_fingerprint", request_fingerprint)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_generated_plan_by_id(self, generated_plan_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("generated_checkin_plans")
            .select("*")
            .eq("id", generated_plan_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_latest_workout_session(self, user_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("workouts")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def insert_workout_plan(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase
            .table("workout_plans")
            .insert(payload)
            .execute()
        )
        return response.data[0]

    def insert_workout_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase
            .table("workouts")
            .insert(payload)
            .execute()
        )
        return response.data[0]
