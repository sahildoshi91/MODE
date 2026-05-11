from __future__ import annotations

from typing import Any

from supabase import Client


class TrainerCoachRepository:
    _CLIENT_QUEUE_SOURCE_TYPES = ("chat", "generated_checkin_plan")

    def __init__(self, supabase: Client):
        self.supabase = supabase

    def list_queue(
        self,
        trainer_id: str,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("ai_generated_outputs")
            .select(
                "id, trainer_id, client_id, source_type, review_status, queue_state, priority_tier, "
                "queue_priority, delivery_state, output_text, output_json, reviewed_output_text, "
                "reviewed_output_json, created_at, updated_at"
            )
            .eq("trainer_id", trainer_id)
            .in_("review_status", ["open"])
            .in_("source_type", self._CLIENT_QUEUE_SOURCE_TYPES)
            .not_.is_("client_id", None)
            .order("queue_priority", desc=True)
            .order("created_at", desc=True)
            .range(max(0, offset), max(0, offset) + max(1, limit) - 1)
            .execute()
        )
        return response.data or []

    def count_open_queue(self, trainer_id: str) -> int:
        rows = (
            self.supabase
            .table("ai_generated_outputs")
            .select("id")
            .eq("trainer_id", trainer_id)
            .eq("review_status", "open")
            .in_("source_type", self._CLIENT_QUEUE_SOURCE_TYPES)
            .not_.is_("client_id", None)
            .execute()
        ).data or []
        return len(rows)

    def list_system_events(
        self,
        trainer_id: str,
        *,
        limit: int = 80,
    ) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_system_events")
            .select("*")
            .eq("trainer_id", trainer_id)
            .order("created_at", desc=True)
            .limit(max(1, limit))
            .execute()
        )
        return response.data or []

    def get_system_event_by_key(self, trainer_id: str, event_key: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_system_events")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("event_key", event_key)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def insert_system_event(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        response = self.supabase.table("trainer_system_events").insert(payload).execute()
        return (response.data or [None])[0]

    def list_client_names(
        self,
        trainer_id: str,
        client_ids: list[str],
    ) -> dict[str, str]:
        unique_ids = sorted({str(client_id) for client_id in client_ids if client_id})
        if not unique_ids:
            return {}
        response = (
            self.supabase
            .table("clients")
            .select("id, client_name")
            .eq("assigned_trainer_id", trainer_id)
            .in_("id", unique_ids)
            .execute()
        )
        rows = response.data or []
        return {
            str(row.get("id")): str(row.get("client_name") or "").strip()
            for row in rows
            if row.get("id") and str(row.get("client_name") or "").strip()
        }

    def client_exists_for_trainer(self, trainer_id: str, client_id: str) -> bool:
        response = (
            self.supabase
            .table("clients")
            .select("id")
            .eq("id", client_id)
            .eq("assigned_trainer_id", trainer_id)
            .limit(1)
            .execute()
        )
        return bool(response.data)

    def output_exists_for_trainer(self, trainer_id: str, output_id: str) -> bool:
        response = (
            self.supabase
            .table("ai_generated_outputs")
            .select("id")
            .eq("id", output_id)
            .eq("trainer_id", trainer_id)
            .limit(1)
            .execute()
        )
        return bool(response.data)

    def count_sync_operations(self, trainer_id: str) -> tuple[int, int]:
        rows = (
            self.supabase
            .table("trainer_mutation_operations")
            .select("status")
            .eq("trainer_id", trainer_id)
            .execute()
        ).data or []
        pending = 0
        failed = 0
        for row in rows:
            status = str(row.get("status") or "").strip().lower()
            if status == "pending":
                pending += 1
            elif status == "failed":
                failed += 1
        return pending, failed

    def approve_output_transaction(
        self,
        *,
        output_id: str,
        idempotency_key: str,
        edited_output_text: str | None,
        edited_output_json: dict[str, Any] | None,
        apply_bundle: dict[str, Any],
    ) -> dict[str, Any]:
        response = self.supabase.rpc(
            "trainer_coach_approve_output",
            {
                "p_output_id": output_id,
                "p_idempotency_key": idempotency_key,
                "p_edited_output_text": edited_output_text,
                "p_edited_output_json": edited_output_json,
                "p_apply_bundle": apply_bundle or {},
            },
        ).execute()
        payload = response.data
        if isinstance(payload, list):
            return payload[0] if payload else {}
        if isinstance(payload, dict):
            return payload
        return {}
