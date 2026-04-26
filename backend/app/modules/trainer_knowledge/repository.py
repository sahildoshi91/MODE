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

    def get_document(self, trainer_id: str, document_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_knowledge_documents")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("id", document_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def update_document(self, trainer_id: str, document_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase
            .table("trainer_knowledge_documents")
            .update(payload)
            .eq("trainer_id", trainer_id)
            .eq("id", document_id)
            .execute()
        )
        return (response.data or [None])[0] or {}

    def delete_document(self, trainer_id: str, document_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_knowledge_documents")
            .delete()
            .eq("trainer_id", trainer_id)
            .eq("id", document_id)
            .execute()
        )
        return response.data or []

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

    def list_rules_by_document(
        self,
        trainer_id: str,
        document_id: str,
        *,
        include_archived: bool = False,
    ) -> list[dict[str, Any]]:
        query = (
            self.supabase
            .table("trainer_rules")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("document_id", document_id)
        )
        if not include_archived:
            query = query.eq("is_archived", False)
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

    def delete_rules_by_document(self, trainer_id: str, document_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_rules")
            .delete()
            .eq("trainer_id", trainer_id)
            .eq("document_id", document_id)
            .execute()
        )
        return response.data or []

    def create_rule_version(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("trainer_rule_versions").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def list_entries_by_trainer(
        self,
        trainer_id: str,
        *,
        include_archived: bool = False,
        scope: str | None = None,
        ai_enabled: bool | None = None,
        limit: int = 120,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        query = (
            self.supabase
            .table("trainer_knowledge_entries")
            .select("*")
            .eq("trainer_id", trainer_id)
        )
        if not include_archived:
            query = query.eq("status", "active")
        if isinstance(scope, str) and scope:
            normalized_scope = scope.strip().lower().replace("-", "_").replace(" ", "_")
            if normalized_scope in {"client", "client_specific", "clientspecific"}:
                query = query.in_("scope", ["client", "client_specific"])
            elif normalized_scope == "global":
                query = query.eq("scope", "global")
        if isinstance(ai_enabled, bool):
            query = query.eq("ai_enabled", ai_enabled)
        response = (
            query
            .order("updated_at", desc=True)
            .order("created_at", desc=True)
            .range(max(0, int(offset)), max(0, int(offset)) + max(1, min(int(limit), 500)) - 1)
            .execute()
        )
        return response.data or []

    def list_active_entries_for_retrieval(self, trainer_id: str, *, limit: int = 120) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_knowledge_entries")
            .select(
                "id, trainer_id, client_id, title, raw_content, structured_summary, knowledge_type, scope, "
                "tags, ai_enabled, status, confidence_score, embedding_status, last_embedded_at, "
                "usage_count, last_used_at, updated_at, created_at, source, source_message_id"
            )
            .eq("trainer_id", trainer_id)
            .eq("status", "active")
            .eq("ai_enabled", True)
            .order("updated_at", desc=True)
            .limit(max(1, min(limit, 500)))
            .execute()
        )
        return response.data or []

    def create_entry(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("trainer_knowledge_entries").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def get_entry(self, trainer_id: str, entry_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("trainer_knowledge_entries")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("id", entry_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def update_entry(self, trainer_id: str, entry_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.supabase
            .table("trainer_knowledge_entries")
            .update(payload)
            .eq("trainer_id", trainer_id)
            .eq("id", entry_id)
            .execute()
        )
        return (response.data or [None])[0] or {}

    def create_entry_version(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.supabase.table("trainer_knowledge_versions").insert(payload).execute()
        return (response.data or [None])[0] or {}

    def list_entry_versions(
        self,
        trainer_id: str,
        knowledge_entry_id: str,
        *,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_knowledge_versions")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("knowledge_entry_id", knowledge_entry_id)
            .order("version_number", desc=True)
            .limit(max(1, min(limit, 200)))
            .execute()
        )
        return response.data or []

    def create_usage_logs(self, payload: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not payload:
            return []
        response = self.supabase.table("trainer_knowledge_usage_logs").insert(payload).execute()
        return response.data or []

    def list_conflict_candidates(self, trainer_id: str, *, limit: int = 120) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("trainer_knowledge_entries")
            .select("id, client_id, title, raw_content, structured_summary, knowledge_type, scope, tags, updated_at")
            .eq("trainer_id", trainer_id)
            .eq("status", "active")
            .order("updated_at", desc=True)
            .limit(max(1, min(limit, 400)))
            .execute()
        )
        return response.data or []

    def increment_usage_counts(
        self,
        trainer_id: str,
        *,
        entry_ids: list[str],
        timestamp_iso: str,
    ) -> None:
        for entry_id in entry_ids:
            existing = self.get_entry(trainer_id, entry_id)
            if not existing:
                continue
            next_usage = int(existing.get("usage_count") or 0) + 1
            (
                self.supabase
                .table("trainer_knowledge_entries")
                .update(
                    {
                        "usage_count": next_usage,
                        "last_used_at": timestamp_iso,
                        "updated_at": timestamp_iso,
                    }
                )
                .eq("trainer_id", trainer_id)
                .eq("id", entry_id)
                .execute()
            )
