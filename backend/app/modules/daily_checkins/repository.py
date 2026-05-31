from datetime import date, datetime, timezone
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

    def get_client_name(self, client_id: str) -> str | None:
        response = (
            self.supabase
            .table("clients")
            .select("client_name")
            .eq("id", client_id)
            .limit(1)
            .execute()
        )
        row = response.data[0] if response.data else None
        name = row.get("client_name") if isinstance(row, dict) else None
        return name.strip() if isinstance(name, str) and name.strip() else None

    def get_default_trainer_persona(self, trainer_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_personas")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_active_trainer_knowledge_entries(self, trainer_id: str, *, limit: int = 12) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_knowledge_entries")
            .select("title, raw_content, structured_summary, knowledge_type, tags")
            .eq("trainer_id", trainer_id)
            .eq("status", "active")
            .eq("ai_enabled", True)
            .order("updated_at", desc=True)
            .limit(max(1, min(int(limit), 50)))
            .execute()
        )
        return response.data or []

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

    def update_checkin_response(
        self,
        *,
        client_id: str,
        checkin_id: str,
        checkin_response: dict[str, Any],
    ) -> dict[str, Any]:
        try:
            response = (
                self.supabase
                .table("daily_checkins")
                .update(
                    {
                        "checkin_response": checkin_response,
                        "checkin_response_attempted": True,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                .eq("client_id", client_id)
                .eq("id", checkin_id)
                .execute()
            )
        except Exception as exc:
            raise DailyCheckinRepositoryError.from_exception("Failed to persist check-in response", exc) from exc

        if response.data:
            return response.data[0]

        raise DailyCheckinRepositoryError(
            "Check-in response update completed without a readable row",
            details="The update returned no row for daily_checkins.checkin_response.",
        )

    def mark_checkin_response_attempted(
        self,
        *,
        client_id: str,
        checkin_id: str,
    ) -> dict[str, Any]:
        try:
            response = (
                self.supabase
                .table("daily_checkins")
                .update(
                    {
                        "checkin_response_attempted": True,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                .eq("client_id", client_id)
                .eq("id", checkin_id)
                .execute()
            )
        except Exception as exc:
            raise DailyCheckinRepositoryError.from_exception("Failed to mark check-in response attempted", exc) from exc

        if response.data:
            return response.data[0]

        raise DailyCheckinRepositoryError(
            "Check-in response attempted marker completed without a readable row",
            details="The update returned no row for daily_checkins.checkin_response_attempted.",
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

    def get_latest_training_setup(
        self,
        client_id: str,
        *,
        exclude_checkin_id: str | None = None,
    ) -> dict[str, Any] | None:
        query = (
            self.supabase
            .table("generated_checkin_plans")
            .select("id, environment, time_available, created_at, checkin_id")
            .eq("client_id", client_id)
            .eq("plan_type", "training")
            .not_.is_("environment", None)
            .not_.is_("time_available", None)
        )
        if exclude_checkin_id:
            query = query.neq("checkin_id", exclude_checkin_id)
        response = (
            query
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_latest_nutrition_setup(
        self,
        client_id: str,
        *,
        exclude_checkin_id: str | None = None,
    ) -> dict[str, Any] | None:
        query = (
            self.supabase
            .table("generated_checkin_plans")
            .select("id, nutrition_day_note, created_at, checkin_id")
            .eq("client_id", client_id)
            .eq("plan_type", "nutrition")
        )
        if exclude_checkin_id:
            query = query.neq("checkin_id", exclude_checkin_id)
        response = (
            query
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_client_coach_memory(
        self,
        trainer_id: str,
        client_id: str,
        *,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("coach_memory")
            .select("id, memory_type, memory_key, value_json, updated_at")
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .order("updated_at", desc=True)
            .limit(max(1, limit))
            .execute()
        )
        return response.data or []

    def get_generated_plan_by_id(
        self,
        generated_plan_id: str,
        *,
        client_id: str | None = None,
    ) -> dict[str, Any] | None:
        query = (
            self.supabase
            .table("generated_checkin_plans")
            .select("*")
            .eq("id", generated_plan_id)
        )
        if client_id:
            query = query.eq("client_id", client_id)
        response = query.limit(1).execute()
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
