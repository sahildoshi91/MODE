from __future__ import annotations

import logging
from typing import Any

from supabase import Client


logger = logging.getLogger(__name__)


class TrainerAssistantRepository:
    _LAST_CLIENT_COLUMN = "assistant_last_client_id"
    _ROUTER_EVENTS_TABLE = "trainer_assistant_router_events"
    _TRAINERS_TABLE = "trainers"

    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_last_selected_client_id(self, trainer_id: str) -> str | None:
        try:
            response = (
                self.supabase
                .table(self._TRAINERS_TABLE)
                .select(self._LAST_CLIENT_COLUMN)
                .eq("id", trainer_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            if self._is_last_selected_client_schema_mismatch(exc):
                logger.warning(
                    "Trainer assistant schema mismatch: missing %s.%s while reading persisted client; "
                    "continuing without persisted selection trainer_id=%s",
                    self._TRAINERS_TABLE,
                    self._LAST_CLIENT_COLUMN,
                    trainer_id,
                )
                return None
            raise
        row = (response.data or [None])[0]
        if not isinstance(row, dict):
            return None
        value = row.get(self._LAST_CLIENT_COLUMN)
        return str(value).strip() if value else None

    def set_last_selected_client_id(self, trainer_id: str, client_id: str | None) -> None:
        try:
            (
                self.supabase
                .table(self._TRAINERS_TABLE)
                .update({self._LAST_CLIENT_COLUMN: client_id})
                .eq("id", trainer_id)
                .execute()
            )
        except Exception as exc:
            if self._is_last_selected_client_schema_mismatch(exc):
                logger.warning(
                    "Trainer assistant schema mismatch: missing %s.%s while persisting active client; "
                    "continuing without persistence trainer_id=%s client_id=%s",
                    self._TRAINERS_TABLE,
                    self._LAST_CLIENT_COLUMN,
                    trainer_id,
                    client_id,
                )
                return
            raise

    def insert_router_event(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        try:
            response = (
                self.supabase
                .table(self._ROUTER_EVENTS_TABLE)
                .insert(payload)
                .execute()
            )
        except Exception as exc:
            if self._is_router_events_schema_mismatch(exc):
                logger.warning(
                    "Trainer assistant schema mismatch: missing %s storage; skipping router event persistence",
                    self._ROUTER_EVENTS_TABLE,
                )
                return None
            raise
        return (response.data or [None])[0]

    def get_generated_output(self, trainer_id: str, draft_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("ai_generated_outputs")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("id", draft_id)
            .limit(1)
            .execute()
        )
        return (response.data or [None])[0]

    def storage_preflight(self) -> dict[str, Any]:
        missing: list[str] = []
        errors: dict[str, str] = {}
        checks = (
            ("trainers.assistant_last_client_id", self._check_last_client_column),
            ("trainer_assistant_router_events", self._check_router_events_table),
        )

        for primitive, operation in checks:
            try:
                operation()
            except Exception as exc:
                if primitive == "trainers.assistant_last_client_id" and self._is_last_selected_client_schema_mismatch(exc):
                    missing.append(primitive)
                    continue
                if primitive == "trainer_assistant_router_events" and self._is_router_events_schema_mismatch(exc):
                    missing.append(primitive)
                    continue
                errors[primitive] = str(exc)

        return {
            "healthy": not missing and not errors,
            "missing": missing,
            "errors": errors,
        }

    def _check_last_client_column(self) -> None:
        (
            self.supabase
            .table(self._TRAINERS_TABLE)
            .select(self._LAST_CLIENT_COLUMN)
            .limit(1)
            .execute()
        )

    def _check_router_events_table(self) -> None:
        (
            self.supabase
            .table(self._ROUTER_EVENTS_TABLE)
            .select("id")
            .limit(1)
            .execute()
        )

    @classmethod
    def _is_last_selected_client_schema_mismatch(cls, exc: Exception) -> bool:
        error_text = cls._error_text(exc)
        error_codes = cls._error_codes(exc)
        if "42703" in error_codes:
            return True
        if ("42P01" in error_codes or "PGRST205" in error_codes) and cls._TRAINERS_TABLE in error_text:
            return True
        return (
            cls._LAST_CLIENT_COLUMN in error_text
            and (
                ("column" in error_text and "does not exist" in error_text)
                or "schema cache" in error_text
            )
        )

    @classmethod
    def _is_router_events_schema_mismatch(cls, exc: Exception) -> bool:
        error_text = cls._error_text(exc)
        error_codes = cls._error_codes(exc)
        if "PGRST205" in error_codes or "42P01" in error_codes or "42703" in error_codes:
            return True
        return (
            cls._ROUTER_EVENTS_TABLE in error_text
            and (
                "schema cache" in error_text
                or ("relation" in error_text and "does not exist" in error_text)
            )
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
