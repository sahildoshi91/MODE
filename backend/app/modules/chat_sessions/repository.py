from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any

from supabase import Client

from app.db.postgrest import authenticated_postgrest_get


class ChatSessionRepository:
    _SESSIONS_TABLE = "chat_sessions"
    _MESSAGES_TABLE = "chat_messages"

    def __init__(self, supabase: Client, admin_supabase: Client | None = None):
        self.supabase = supabase
        self.admin_supabase = admin_supabase

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table(self._SESSIONS_TABLE)
            .select("*")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def find_session(
        self,
        *,
        user_id: str,
        trainer_id: str | None,
        client_id: str | None,
        role: str,
        session_type: str,
        session_date: date,
    ) -> dict[str, Any] | None:
        query = (
            self.supabase
            .table(self._SESSIONS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("role", role)
            .eq("session_type", session_type)
            .eq("session_date", session_date.isoformat())
        )
        if trainer_id:
            query = query.eq("trainer_id", trainer_id)
        else:
            query = query.is_("trainer_id", "null")
        if client_id:
            query = query.eq("client_id", client_id)
        else:
            query = query.is_("client_id", "null")
        response = query.limit(1).execute()
        return response.data[0] if response.data else None

    def create_session(
        self,
        *,
        user_id: str,
        trainer_id: str | None,
        client_id: str | None,
        role: str,
        session_type: str,
        session_date: date,
        title: str | None = None,
        summary: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "user_id": user_id,
            "trainer_id": trainer_id,
            "client_id": client_id,
            "role": role,
            "session_type": session_type,
            "session_date": session_date.isoformat(),
            "title": title,
            "summary": summary,
            "metadata": metadata or {},
        }
        try:
            response = self.supabase.table(self._SESSIONS_TABLE).insert(payload).execute()
            return response.data[0]
        except Exception:
            existing = self.find_session(
                user_id=user_id,
                trainer_id=trainer_id,
                client_id=client_id,
                role=role,
                session_type=session_type,
                session_date=session_date,
            )
            if existing:
                return existing
            raise

    def update_session(self, session_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        payload = {
            **fields,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        response = (
            self.supabase
            .table(self._SESSIONS_TABLE)
            .update(payload)
            .eq("id", session_id)
            .execute()
        )
        return response.data[0] if response.data else None

    def archive_older_sessions(
        self,
        *,
        user_id: str,
        trainer_id: str | None,
        client_id: str | None,
        role: str,
        session_type: str,
        before_date: date,
    ) -> None:
        query = (
            self.supabase
            .table(self._SESSIONS_TABLE)
            .select("id, metadata")
            .eq("user_id", user_id)
            .eq("role", role)
            .eq("session_type", session_type)
            .lt("session_date", before_date.isoformat())
        )
        if trainer_id:
            query = query.eq("trainer_id", trainer_id)
        else:
            query = query.is_("trainer_id", "null")
        if client_id:
            query = query.eq("client_id", client_id)
        else:
            query = query.is_("client_id", "null")
        response = query.limit(25).execute()
        now_iso = datetime.now(timezone.utc).isoformat()
        for row in response.data or []:
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            if metadata.get("archived_at"):
                continue
            self.update_session(
                str(row.get("id")),
                {
                    "metadata": {
                        **metadata,
                        "archived_at": now_iso,
                        "archive_reason": "new_daily_session_started",
                    },
                },
            )

    def list_sessions(
        self,
        *,
        user_id: str,
        trainer_id: str | None,
        role: str,
        session_type: str | None = None,
        limit: int = 80,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        normalized_limit = max(1, min(int(limit), 200))
        normalized_offset = max(0, int(offset))
        query = (
            self.supabase
            .table(self._SESSIONS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("role", role)
        )
        if trainer_id:
            query = query.eq("trainer_id", trainer_id)
        else:
            query = query.is_("trainer_id", "null")
        if session_type:
            query = query.eq("session_type", session_type)
        response = (
            query
            .order("session_date", desc=True)
            .order("last_message_at", desc=True, nullsfirst=False)
            .order("created_at", desc=True)
            .range(normalized_offset, normalized_offset + normalized_limit - 1)
            .execute()
        )
        rows = response.data or []
        client_ids = sorted({str(row.get("client_id")) for row in rows if row.get("client_id")})
        if not client_ids:
            return rows
        names = self.get_client_names(trainer_id=trainer_id, client_ids=client_ids)
        return [
            {
                **row,
                "client_name": names.get(str(row.get("client_id"))) if row.get("client_id") else None,
            }
            for row in rows
        ]

    def list_messages(self, session_id: str, limit: int = 200, offset: int = 0) -> list[dict[str, Any]]:
        normalized_limit = max(1, min(int(limit), 500))
        normalized_offset = max(0, int(offset))
        response = (
            self.supabase
            .table(self._MESSAGES_TABLE)
            .select("*")
            .eq("session_id", session_id)
            .order("message_index", desc=False)
            .order("created_at", desc=False)
            .range(normalized_offset, normalized_offset + normalized_limit - 1)
            .execute()
        )
        return response.data or []

    def get_opening_summary_message(self, session_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table(self._MESSAGES_TABLE)
            .select("*")
            .eq("session_id", session_id)
            .contains("metadata", {"auto_generated_opening_summary": True})
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def update_opening_summary_message(
        self,
        *,
        session_id: str,
        content: str,
        metadata: dict[str, Any],
    ) -> dict[str, Any] | None:
        client = self.admin_supabase or self.supabase
        response = (
            client
            .table(self._MESSAGES_TABLE)
            .update({
                "content": content,
                "metadata": metadata,
            })
            .eq("session_id", session_id)
            .contains("metadata", {"auto_generated_opening_summary": True})
            .execute()
        )
        if response.data:
            return response.data[0]
        return self.get_opening_summary_message(session_id)

    def append_message(
        self,
        *,
        session_id: str,
        sender_type: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_metadata = metadata or {}
        try:
            response = (
                self.supabase
                .rpc(
                    "append_chat_message",
                    {
                        "p_session_id": session_id,
                        "p_sender_type": sender_type,
                        "p_content": content,
                        "p_metadata": normalized_metadata,
                    },
                )
                .execute()
            )
            if isinstance(response.data, dict):
                return response.data
            if isinstance(response.data, list) and response.data:
                return response.data[0]
        except Exception:
            if normalized_metadata.get("auto_generated_opening_summary"):
                existing = self.get_opening_summary_message(session_id)
                if existing:
                    return existing
            raise

        latest_response = (
            self.supabase
            .table(self._MESSAGES_TABLE)
            .select("message_index")
            .eq("session_id", session_id)
            .order("message_index", desc=True)
            .limit(1)
            .execute()
        )
        latest_row = latest_response.data[0] if latest_response.data else {}
        next_index = int(latest_row.get("message_index", -1)) + 1
        response = (
            self.supabase
            .table(self._MESSAGES_TABLE)
            .insert(
                {
                    "session_id": session_id,
                    "sender_type": sender_type,
                    "content": content,
                    "message_index": next_index,
                    "metadata": normalized_metadata,
                }
            )
            .execute()
        )
        row = response.data[0]
        self.update_session(session_id, {"last_message_at": row.get("created_at")})
        return row

    def get_client_for_trainer(self, *, trainer_id: str, client_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("clients")
            .select("id, tenant_id, user_id, client_name, assigned_trainer_id")
            .eq("id", client_id)
            .eq("assigned_trainer_id", trainer_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def get_client_by_id(self, client_id: str) -> dict[str, Any] | None:
        client = self.admin_supabase or self.supabase
        response = (
            client
            .table("clients")
            .select("id, tenant_id, user_id, client_name, assigned_trainer_id, created_at")
            .eq("id", client_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_active_trainers_for_tenant(self, tenant_id: str) -> list[dict[str, Any]]:
        client = self.admin_supabase or self.supabase
        trainers = (
            client
            .table("trainers")
            .select("id, tenant_id, user_id, display_name, is_active")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .execute()
        ).data or []
        user_ids = [
            str(row.get("user_id") or "").strip()
            for row in trainers
            if str(row.get("user_id") or "").strip()
        ]
        email_by_user_id: dict[str, str] = {}
        if user_ids:
            account_rows = (
                client
                .table("user_accounts")
                .select("auth_user_id, email")
                .in_("auth_user_id", user_ids)
                .execute()
            ).data or []
            email_by_user_id = {
                str(row.get("auth_user_id")): str(row.get("email") or "")
                for row in account_rows
                if row.get("auth_user_id")
            }
        return [
            {
                **row,
                "email": email_by_user_id.get(str(row.get("user_id") or ""), ""),
            }
            for row in trainers
        ]

    def find_pending_connection_request(self, *, client_id: str, trainer_id: str) -> dict[str, Any] | None:
        client = self.admin_supabase or self.supabase
        response = (
            client
            .table("client_trainer_connection_requests")
            .select("*")
            .eq("client_id", client_id)
            .eq("trainer_id", trainer_id)
            .eq("status", "pending")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def create_connection_request(self, payload: dict[str, Any]) -> dict[str, Any]:
        client = self.admin_supabase or self.supabase
        response = client.table("client_trainer_connection_requests").insert(payload).execute()
        return response.data[0]

    def get_client_names(self, *, trainer_id: str | None, client_ids: list[str]) -> dict[str, str]:
        if not client_ids:
            return {}
        query = (
            self.supabase
            .table("clients")
            .select("id, client_name")
            .in_("id", client_ids)
        )
        if trainer_id:
            query = query.eq("assigned_trainer_id", trainer_id)
        response = query.execute()
        return {
            str(row.get("id")): str(row.get("client_name") or "").strip()
            for row in response.data or []
            if row.get("id")
        }

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


    def get_checkin_by_date(self, client_id: str, session_date: date) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("*")
            .eq("client_id", client_id)
            .eq("date", session_date.isoformat())
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_recent_checkins(self, client_id: str, *, end_date: date, limit: int = 7) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("daily_checkins")
            .select("client_id, date, inputs, total_score, assigned_mode")
            .eq("client_id", client_id)
            .lte("date", end_date.isoformat())
            .order("date", desc=True)
            .limit(max(1, min(limit, 14)))
            .execute()
        )
        return response.data or []

    def list_client_memory(self, *, trainer_id: str, client_id: str, limit: int = 20) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("coach_memory")
            .select("id, memory_type, memory_key, value_json, updated_at")
            .eq("trainer_id", trainer_id)
            .eq("client_id", client_id)
            .order("updated_at", desc=True)
            .limit(max(1, min(limit, 50)))
            .execute()
        )
        return response.data or []

    def count_completed_workouts(
        self,
        *,
        user_id: str | None,
        start_date: date,
        end_date: date,
    ) -> int:
        if not user_id:
            return 0
        start_time = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
        end_time = datetime.combine(end_date, time.max, tzinfo=timezone.utc)
        response = (
            self.supabase
            .table("workouts")
            .select("id")
            .eq("user_id", user_id)
            .eq("completed", True)
            .gte("created_at", start_time.isoformat())
            .lte("created_at", end_time.isoformat())
            .execute()
        )
        return len(response.data or [])


class ChatSessionHistoryRepository:
    _SESSIONS_TABLE = "chat_sessions"
    _CLIENTS_TABLE = "clients"

    def __init__(self, access_token: str):
        self.access_token = access_token

    def list_sessions(
        self,
        *,
        user_id: str,
        trainer_id: str | None,
        role: str,
        session_type: str | None = None,
        limit: int = 80,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        normalized_limit = max(1, min(int(limit), 200))
        normalized_offset = max(0, int(offset))
        params: list[tuple[str, str]] = [
            ("select", "*"),
            ("user_id", f"eq.{user_id}"),
            ("role", f"eq.{role}"),
            ("order", "session_date.desc,last_message_at.desc.nullslast,created_at.desc"),
            ("limit", str(normalized_limit)),
            ("offset", str(normalized_offset)),
        ]
        if trainer_id:
            params.append(("trainer_id", f"eq.{trainer_id}"))
        else:
            params.append(("trainer_id", "is.null"))
        if session_type:
            params.append(("session_type", f"eq.{session_type}"))

        rows = authenticated_postgrest_get(
            self._SESSIONS_TABLE,
            access_token=self.access_token,
            params=params,
        )
        client_ids = sorted({str(row.get("client_id")) for row in rows if row.get("client_id")})
        if not client_ids:
            return rows
        names = self.get_client_names(trainer_id=trainer_id, client_ids=client_ids)
        return [
            {
                **row,
                "client_name": names.get(str(row.get("client_id"))) if row.get("client_id") else None,
            }
            for row in rows
        ]

    def get_client_names(self, *, trainer_id: str | None, client_ids: list[str]) -> dict[str, str]:
        if not client_ids:
            return {}
        params: list[tuple[str, str]] = [
            ("select", "id,client_name"),
            ("id", f"in.({','.join(client_ids)})"),
        ]
        if trainer_id:
            params.append(("assigned_trainer_id", f"eq.{trainer_id}"))
        rows = authenticated_postgrest_get(
            self._CLIENTS_TABLE,
            access_token=self.access_token,
            params=params,
        )
        return {
            str(row.get("id")): str(row.get("client_name") or "").strip()
            for row in rows
            if row.get("id")
        }
