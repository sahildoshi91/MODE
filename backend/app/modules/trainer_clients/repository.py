from __future__ import annotations

from datetime import date, datetime, timezone
import re
from typing import Any

from supabase import Client


UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class TrainerClientRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def list_clients_for_trainer(self, trainer_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("clients")
            .select("id, tenant_id, user_id, client_name, assigned_trainer_id, created_at")
            .eq("assigned_trainer_id", trainer_id)
            .order("created_at", desc=True)
            .execute()
        )
        return response.data or []

    def list_clients_for_trainer_page(
        self,
        trainer_id: str,
        tenant_id: str,
        *,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        normalized_limit = max(1, min(int(limit), 200))
        normalized_offset = max(0, int(offset))
        normalized_search = str(search or "").strip()
        query = (
            self.supabase
            .table("clients")
            .select("id, tenant_id, user_id, client_name, assigned_trainer_id, created_at", count="exact")
            .eq("assigned_trainer_id", trainer_id)
            .eq("tenant_id", tenant_id)
        )
        if normalized_search:
            if UUID_PATTERN.match(normalized_search):
                query = query.or_(
                    f"client_name.ilike.%{normalized_search}%,id.eq.{normalized_search},user_id.eq.{normalized_search}"
                )
            else:
                query = query.ilike("client_name", f"%{normalized_search}%")
        response = (
            query
            .order("created_at", desc=True)
            .range(normalized_offset, normalized_offset + normalized_limit - 1)
            .execute()
        )
        rows = response.data or []
        count = response.count if response.count is not None else len(rows)
        return {"items": rows, "count": int(count)}

    def get_client_for_trainer(self, trainer_id: str, client_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("clients")
            .select("id, tenant_id, user_id, client_name, assigned_trainer_id, created_at")
            .eq("assigned_trainer_id", trainer_id)
            .eq("id", client_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def update_client_for_trainer(
        self,
        trainer_id: str,
        client_id: str,
        fields: dict[str, Any],
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("clients")
            .update(fields)
            .eq("assigned_trainer_id", trainer_id)
            .eq("id", client_id)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_client_by_id(self, client_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("clients")
            .select("id, tenant_id, user_id, client_name, assigned_trainer_id, created_at")
            .eq("id", client_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def update_client_assignment(
        self,
        *,
        client_id: str,
        tenant_id: str,
        trainer_id: str,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("clients")
            .update({"assigned_trainer_id": trainer_id})
            .eq("id", client_id)
            .eq("tenant_id", tenant_id)
            .execute()
        )
        return response.data[0] if response.data else None

    def insert_assignment_history(self, *, client_id: str, trainer_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("client_trainer_assignments")
            .insert({
                "client_id": client_id,
                "trainer_id": trainer_id,
            })
            .execute()
        )
        return response.data[0] if response.data else None

    def list_connection_requests_for_trainer(
        self,
        *,
        trainer_id: str,
        status: str | None = "pending",
    ) -> list[dict[str, Any]]:
        query = (
            self.supabase
            .table("client_trainer_connection_requests")
            .select("*")
            .eq("trainer_id", trainer_id)
        )
        if status:
            query = query.eq("status", status)
        response = query.order("created_at", desc=True).execute()
        return response.data or []

    def get_connection_request_for_trainer(
        self,
        *,
        trainer_id: str,
        request_id: str,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("client_trainer_connection_requests")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("id", request_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def update_connection_request(
        self,
        *,
        request_id: str,
        trainer_id: str,
        fields: dict[str, Any],
    ) -> dict[str, Any] | None:
        payload = {
            **fields,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        response = (
            self.supabase
            .table("client_trainer_connection_requests")
            .update(payload)
            .eq("id", request_id)
            .eq("trainer_id", trainer_id)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_latest_active_assignment(
        self,
        trainer_id: str,
        client_id: str,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("client_trainer_assignments")
            .select("id, client_id, trainer_id, assigned_at, unassigned_at")
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .is_("unassigned_at", "null")
            .order("assigned_at", desc=True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def mark_assignment_unassigned(
        self,
        assignment_id: str,
        *,
        unassigned_at: str,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("client_trainer_assignments")
            .update({"unassigned_at": unassigned_at})
            .eq("id", assignment_id)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_invite_codes_for_trainer(
        self,
        trainer_id: str,
        tenant_id: str,
    ) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_invite_codes")
            .select("id, trainer_id, tenant_id, is_active, expires_at, used_at, revoked_at, created_at")
            .eq("trainer_id", trainer_id)
            .eq("tenant_id", tenant_id)
            .not_.is_("hmac_pepper_id", "null")
            .order("is_active", desc=True)
            .order("created_at", desc=True)
            .execute()
        )
        return response.data or []

    def get_invite_code_for_trainer(
        self,
        trainer_id: str,
        tenant_id: str,
        invite_id: str,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_invite_codes")
            .select("id, trainer_id, tenant_id, is_active, expires_at, used_at, revoked_at, created_at")
            .eq("trainer_id", trainer_id)
            .eq("tenant_id", tenant_id)
            .eq("id", invite_id)
            .not_.is_("hmac_pepper_id", "null")
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_invite_code_by_hash(
        self,
        *,
        code_hash: str,
    ) -> dict[str, Any] | None:
        """Look up an active invite by HMAC hash. Used only to check uniqueness at creation time."""
        if not code_hash:
            return None
        rows = (
            self.supabase
            .table("trainer_invite_codes")
            .select("id")
            .eq("code_hash", code_hash)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def create_invite_code(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        response = self.supabase.table("trainer_invite_codes").insert(payload).execute()
        return (response.data or [None])[0]

    def revoke_invite_code_for_trainer(
        self,
        trainer_id: str,
        tenant_id: str,
        invite_id: str,
    ) -> dict[str, Any] | None:
        now = datetime.now(timezone.utc).isoformat()
        response = (
            self.supabase
            .table("trainer_invite_codes")
            .update({"is_active": False, "revoked_at": now, "updated_at": now})
            .eq("trainer_id", trainer_id)
            .eq("tenant_id", tenant_id)
            .eq("id", invite_id)
            .eq("is_active", True)
            .is_("used_at", "null")
            .is_("revoked_at", "null")
            .execute()
        )
        return response.data[0] if response.data else None

    def get_trainer_settings(self, trainer_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainers")
            .select("id, display_name, default_meeting_location, auto_fill_meeting_location")
            .eq("id", trainer_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_profile(self, client_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("user_fitness_profiles")
            .select("*")
            .eq("client_id", client_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_profile_onboarding_status_for_clients(self, client_ids: list[str]) -> dict[str, str | None]:
        normalized_client_ids = [
            str(client_id).strip()
            for client_id in client_ids
            if str(client_id).strip()
        ]
        if not normalized_client_ids:
            return {}

        response = (
            self.supabase
            .table("user_fitness_profiles")
            .select("client_id, onboarding_status")
            .in_("client_id", normalized_client_ids)
            .execute()
        )
        rows = response.data or []

        status_by_client_id: dict[str, str | None] = {}
        for row in rows:
            client_id = str(row.get("client_id") or "").strip()
            if not client_id:
                continue
            raw_status = row.get("onboarding_status")
            if isinstance(raw_status, str):
                status_by_client_id[client_id] = raw_status.strip().lower() or None
            elif raw_status is None:
                status_by_client_id[client_id] = None
            else:
                status_by_client_id[client_id] = str(raw_status).strip().lower() or None
        return status_by_client_id

    def create_empty_profile(self, client_id: str) -> dict[str, Any]:
        response = self.supabase.table("user_fitness_profiles").insert({"client_id": client_id}).execute()
        return (response.data or [None])[0] or {"client_id": client_id}

    def list_checkins_between(self, client_id: str, start_date: date, end_date: date) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("client_id, date, inputs, total_score, assigned_mode")
            .eq("client_id", client_id)
            .gte("date", start_date.isoformat())
            .lte("date", end_date.isoformat())
            .order("date", desc=True)
            .execute()
        )
        return response.data or []

    def get_latest_checkin(self, client_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("client_id, date, inputs, total_score, assigned_mode")
            .eq("client_id", client_id)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_completed_workouts_between(
        self,
        user_id: str,
        start_time: datetime,
        end_time: datetime,
    ) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("workouts")
            .select("id, user_id, completed, created_at")
            .eq("user_id", user_id)
            .eq("completed", True)
            .gte("created_at", start_time.isoformat())
            .lte("created_at", end_time.isoformat())
            .execute()
        )
        return response.data or []

    def get_schedule_for_day(
        self,
        trainer_id: str,
        client_id: str,
        session_date: date,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_daily_schedule")
            .select(
                "id, trainer_id, client_id, session_date, session_start_at, session_end_at, "
                "session_type, status, notes, meeting_location"
            )
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .eq("session_date", session_date.isoformat())
            .order("session_start_at")
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_schedule_preferences(
        self,
        trainer_id: str,
        client_id: str,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_client_schedule_preferences")
            .select(
                "id, trainer_id, client_id, recurring_weekdays, preferred_meeting_location, "
                "auto_use_trainer_default_location, created_at, updated_at"
            )
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_schedule_preferences_for_clients(
        self,
        trainer_id: str,
        client_ids: list[str],
    ) -> list[dict[str, Any]]:
        if not client_ids:
            return []
        response = (
            self.supabase
            .table("trainer_client_schedule_preferences")
            .select(
                "id, trainer_id, client_id, recurring_weekdays, preferred_meeting_location, "
                "auto_use_trainer_default_location, created_at, updated_at"
            )
            .eq("trainer_id", trainer_id)
            .in_("client_id", client_ids)
            .execute()
        )
        return response.data or []

    def upsert_schedule_preferences(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_client_schedule_preferences")
            .upsert(payload, on_conflict="trainer_id,client_id")
            .execute()
        )
        return (response.data or [None])[0]

    def get_schedule_exception_for_day(
        self,
        trainer_id: str,
        client_id: str,
        session_date: date,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_client_schedule_exceptions")
            .select(
                "id, trainer_id, client_id, session_date, exception_type, "
                "meeting_location_override, created_at, updated_at"
            )
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .eq("session_date", session_date.isoformat())
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_schedule_exceptions_between(
        self,
        trainer_id: str,
        *,
        start_date: date,
        end_date: date,
        client_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        query = (
            self.supabase
            .table("trainer_client_schedule_exceptions")
            .select(
                "id, trainer_id, client_id, session_date, exception_type, "
                "meeting_location_override, created_at, updated_at"
            )
            .eq("trainer_id", trainer_id)
            .gte("session_date", start_date.isoformat())
            .lte("session_date", end_date.isoformat())
            .order("session_date")
            .order("created_at")
        )
        if client_ids:
            query = query.in_("client_id", client_ids)
        response = query.execute()
        return response.data or []

    def upsert_schedule_exception(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_client_schedule_exceptions")
            .upsert(payload, on_conflict="trainer_id,client_id,session_date")
            .execute()
        )
        return (response.data or [None])[0]

    def delete_schedule_exception_for_day(
        self,
        trainer_id: str,
        client_id: str,
        session_date: date,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_client_schedule_exceptions")
            .delete()
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .eq("session_date", session_date.isoformat())
            .execute()
        )
        return (response.data or [None])[0]

    def update_schedule_meeting_location(
        self,
        schedule_id: str,
        *,
        meeting_location: str | None,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_daily_schedule")
            .update(
                {
                    "meeting_location": meeting_location,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            .eq("id", schedule_id)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_memory(
        self,
        trainer_id: str,
        client_id: str,
        *,
        include_archived: bool = False,
    ) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("coach_memory")
            .select("id, trainer_id, client_id, memory_type, memory_key, value_json, created_at, updated_at")
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .order("updated_at", desc=True)
            .execute()
        )
        rows = response.data or []
        if include_archived:
            return rows
        filtered = []
        for row in rows:
            value_json = row.get("value_json")
            value = value_json if isinstance(value_json, dict) else {}
            if bool(value.get("is_archived")):
                continue
            filtered.append(row)
        return filtered

    def get_memory(
        self,
        trainer_id: str,
        client_id: str,
        memory_id: str,
    ) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("coach_memory")
            .select("id, trainer_id, client_id, memory_type, memory_key, value_json, created_at, updated_at")
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .eq("id", memory_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def insert_memory(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("coach_memory").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def update_memory(
        self,
        trainer_id: str,
        client_id: str,
        memory_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        response = (
            self.supabase
            .table("coach_memory")
            .update(payload)
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .eq("id", memory_id)
            .execute()
        )
        return (response.data or [None])[0] or {}

    def list_active_trainer_rules(self, trainer_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_rules")
            .select("category, rule_text")
            .eq("trainer_id", trainer_id)
            .eq("is_archived", False)
            .order("updated_at", desc=True)
            .execute()
        )
        return response.data or []
