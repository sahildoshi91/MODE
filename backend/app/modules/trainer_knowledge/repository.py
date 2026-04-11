from typing import Any

from supabase import Client


class TrainerKnowledgeRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def list_by_trainer(self, trainer_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_knowledge_documents")
            .select("*")
            .eq("trainer_id", trainer_id)
            .order("created_at", desc=True)
            .execute()
        )
        return response.data or []

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self.supabase.table("trainer_knowledge_documents").insert(payload).execute()
        return (result.data or [None])[0] or {}

    def list_rules_by_trainer(
        self,
        trainer_id: str,
        *,
        include_archived: bool = False,
        category: str | None = None,
    ) -> list[dict[str, Any]]:
        query = (
            self.supabase
            .table("trainer_rules")
            .select("*")
            .eq("trainer_id", trainer_id)
        )
        if not include_archived:
            query = query.eq("is_archived", False)
        if category:
            query = query.eq("category", category)
        response = query.order("updated_at", desc=True).order("id").execute()
        return response.data or []

    def get_rule(self, trainer_id: str, rule_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_rules")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("id", rule_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def create_rule(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("trainer_rules").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def update_rule(self, trainer_id: str, rule_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase
            .table("trainer_rules")
            .update(payload)
            .eq("trainer_id", trainer_id)
            .eq("id", rule_id)
            .execute()
        )
        return (response.data or [None])[0] or {}

    def create_rule_version(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("trainer_rule_versions").insert(payload).execute()
        return (response.data or [None])[0] or {}
