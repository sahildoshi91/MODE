from __future__ import annotations

from typing import Any

from supabase import Client


class AtlasRepository:
    def __init__(self, supabase_admin: Client):
        self.supabase = supabase_admin

    def get_trainer_identity(self, trainer_id: str | None) -> dict[str, Any] | None:
        if not trainer_id:
            return None
        response = (
            self.supabase
            .table("trainers")
            .select("id, tenant_id, user_id, display_name")
            .eq("id", trainer_id)
            .limit(1)
            .execute()
        )
        return (response.data or [None])[0]

    def get_client_identity(self, client_id: str | None) -> dict[str, Any] | None:
        if not client_id:
            return None
        response = (
            self.supabase
            .table("clients")
            .select("id, tenant_id, user_id, client_name")
            .eq("id", client_id)
            .limit(1)
            .execute()
        )
        return (response.data or [None])[0]

    def insert_audit_log(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("atlas_audit_logs").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def insert_atlas_learning_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("atlas_learning_events").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def insert_atlas_review_queue(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("atlas_review_queue").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def list_atlas_review_queue(
        self,
        *,
        reviewer_status: str | None = "pending",
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        query = self.supabase.table("atlas_review_queue").select("*")
        if reviewer_status:
            query = query.eq("reviewer_status", reviewer_status)
        response = (
            query
            .order("created_at", desc=True)
            .limit(max(1, min(int(limit), 250)))
            .execute()
        )
        return response.data or []

    def get_atlas_review_queue_item(self, queue_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("atlas_review_queue")
            .select("*")
            .eq("id", queue_id)
            .limit(1)
            .execute()
        )
        return (response.data or [None])[0]

    def update_atlas_review_queue(self, queue_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase
            .table("atlas_review_queue")
            .update(payload)
            .eq("id", queue_id)
            .execute()
        )
        return (response.data or [None])[0] or {}

    def insert_atlas_knowledge(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("atlas_knowledge").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def list_atlas_knowledge(
        self,
        *,
        status: str | None = "approved",
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        query = self.supabase.table("atlas_knowledge").select("*")
        if status:
            query = query.eq("status", status)
        response = (
            query
            .order("updated_at", desc=True)
            .limit(max(1, min(int(limit), 250)))
            .execute()
        )
        return response.data or []

    def insert_trainer_ai_learning_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("trainer_ai_learning_events").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def insert_trainer_ai_review_queue(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("trainer_ai_review_queue").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def list_trainer_ai_review_queue(
        self,
        trainer_id: str,
        *,
        reviewer_status: str | None = "pending",
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        query = (
            self.supabase
            .table("trainer_ai_review_queue")
            .select("*")
            .eq("trainer_id", trainer_id)
        )
        if reviewer_status:
            query = query.eq("reviewer_status", reviewer_status)
        response = (
            query
            .order("created_at", desc=True)
            .limit(max(1, min(int(limit), 250)))
            .execute()
        )
        return response.data or []

    def get_trainer_ai_review_queue_item(self, trainer_id: str, queue_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_ai_review_queue")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("id", queue_id)
            .limit(1)
            .execute()
        )
        return (response.data or [None])[0]

    def update_trainer_ai_review_queue(
        self,
        trainer_id: str,
        queue_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        response = (
            self.supabase
            .table("trainer_ai_review_queue")
            .update(payload)
            .eq("trainer_id", trainer_id)
            .eq("id", queue_id)
            .execute()
        )
        return (response.data or [None])[0] or {}

    def delete_trainer_ai_review_queue(self, trainer_id: str, queue_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_ai_review_queue")
            .delete()
            .eq("trainer_id", trainer_id)
            .eq("id", queue_id)
            .execute()
        )
        return response.data or []

    def insert_trainer_ai_knowledge(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("trainer_ai_knowledge").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def list_trainer_ai_knowledge(
        self,
        trainer_id: str,
        *,
        status: str | None = "approved",
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        query = (
            self.supabase
            .table("trainer_ai_knowledge")
            .select("*")
            .eq("trainer_id", trainer_id)
        )
        if status:
            query = query.eq("status", status)
        response = (
            query
            .order("updated_at", desc=True)
            .limit(max(1, min(int(limit), 250)))
            .execute()
        )
        return response.data or []

    def update_trainer_ai_knowledge(
        self,
        trainer_id: str,
        knowledge_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        response = (
            self.supabase
            .table("trainer_ai_knowledge")
            .update(payload)
            .eq("trainer_id", trainer_id)
            .eq("id", knowledge_id)
            .execute()
        )
        return (response.data or [None])[0] or {}

    def list_trainer_ai_knowledge_for_trainers(self, trainer_ids: list[str], *, limit: int = 200) -> list[dict[str, Any]]:
        normalized = [str(item).strip() for item in trainer_ids if str(item).strip()]
        if not normalized:
            return []
        response = (
            self.supabase
            .table("trainer_ai_knowledge")
            .select("*")
            .in_("trainer_id", normalized)
            .eq("status", "approved")
            .order("updated_at", desc=True)
            .limit(max(1, min(int(limit), 500)))
            .execute()
        )
        return response.data or []
