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
            .execute()
        )
        return response.data or []

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self.supabase.table("trainer_knowledge_documents").insert(payload).execute()
        return result.data[0]
