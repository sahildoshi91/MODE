from __future__ import annotations

from typing import Any

from supabase import Client


class TrainerOnboardingStorageUnavailableError(RuntimeError):
    """Raised when trainer onboarding storage tables are unavailable."""


class TrainerOnboardingRepository:
    _ONBOARDING_STORAGE_TABLES = (
        "trainer_onboarding_profiles",
        "trainer_onboarding_events",
    )

    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_profile(self, trainer_id: str) -> dict[str, Any] | None:
        response = self._with_storage_guard(
            lambda: (
                self.supabase
                .table("trainer_onboarding_profiles")
                .select("*")
                .eq("trainer_id", trainer_id)
                .limit(1)
                .execute()
            )
        )
        return response.data[0] if response.data else None

    def create_profile(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._with_storage_guard(
            lambda: self.supabase.table("trainer_onboarding_profiles").insert(payload).execute()
        )
        return (response.data or [None])[0] or {}

    def upsert_profile(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._with_storage_guard(
            lambda: (
                self.supabase
                .table("trainer_onboarding_profiles")
                .upsert(payload, on_conflict="trainer_id")
                .execute()
            )
        )
        return (response.data or [None])[0] or {}

    def update_profile(self, trainer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._with_storage_guard(
            lambda: (
                self.supabase
                .table("trainer_onboarding_profiles")
                .update(payload)
                .eq("trainer_id", trainer_id)
                .execute()
            )
        )
        return (response.data or [None])[0] or {}

    def create_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._with_storage_guard(
            lambda: self.supabase.table("trainer_onboarding_events").insert(payload).execute()
        )
        return (response.data or [None])[0] or {}

    def storage_preflight(self) -> dict[str, Any]:
        missing_tables: list[str] = []
        errors: dict[str, str] = {}
        for table_name in self._ONBOARDING_STORAGE_TABLES:
            try:
                (
                    self.supabase
                    .table(table_name)
                    .select("id")
                    .limit(1)
                    .execute()
                )
            except Exception as exc:
                if self._is_storage_unavailable_error(exc):
                    missing_tables.append(table_name)
                else:
                    errors[table_name] = str(exc)

        return {
            "healthy": not missing_tables and not errors,
            "missing_tables": missing_tables,
            "errors": errors,
        }

    def _with_storage_guard(self, operation):
        try:
            return operation()
        except Exception as exc:
            if self._is_storage_unavailable_error(exc):
                raise TrainerOnboardingStorageUnavailableError(
                    "Trainer onboarding storage tables are unavailable."
                ) from exc
            raise

    @classmethod
    def _is_storage_unavailable_error(cls, exc: Exception) -> bool:
        error_text = cls._error_text(exc)
        error_codes = cls._error_codes(exc)
        storage_table_mentioned = any(
            table_name in error_text for table_name in cls._ONBOARDING_STORAGE_TABLES
        )
        relation_missing_signal = (
            "relation" in error_text and "does not exist" in error_text
        )
        missing_storage_signal = (
            storage_table_mentioned
            or "schema cache" in error_text
            or relation_missing_signal
        )
        if "PGRST205" in error_codes:
            return True
        return (
            "42P01" in error_codes
            or (missing_storage_signal and storage_table_mentioned)
        )

    @classmethod
    def _error_text(cls, exc: Exception) -> str:
        parts: list[str] = []
        current: BaseException | None = exc
        while current is not None:
            parts.append(str(current))
            current = current.__cause__
        return " ".join(parts).lower()

    @classmethod
    def _error_codes(cls, exc: Exception) -> set[str]:
        codes: set[str] = set()
        current: BaseException | None = exc
        while current is not None:
            current_code = getattr(current, "code", None)
            if current_code:
                codes.add(str(current_code).upper())
            for arg in getattr(current, "args", ()):
                if isinstance(arg, dict):
                    arg_code = arg.get("code")
                    if arg_code:
                        codes.add(str(arg_code).upper())
            current = current.__cause__
        return codes
