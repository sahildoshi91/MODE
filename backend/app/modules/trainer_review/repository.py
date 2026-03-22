from typing import Any

from supabase import Client


class TrainerReviewRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def queue_item(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self.supabase.table("unanswered_question_queue").insert(payload).execute()
        return result.data[0]

    def list_open(self, trainer_id: str) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("unanswered_question_queue")
            .select("*")
            .eq("trainer_id", trainer_id)
            .eq("status", "open")
            .execute()
        )
        return response.data or []

    def create_approval(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self.supabase.table("trainer_response_approvals").insert(payload).execute()
        return result.data[0]

    def mark_resolved(self, queue_id: str) -> None:
        (
            self.supabase
            .table("unanswered_question_queue")
            .update({"status": "resolved"})
            .eq("id", queue_id)
            .execute()
        )
