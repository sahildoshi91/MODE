from typing import Any

from supabase import Client


class ConversationRepository:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_conversation(self, conversation_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("conversations")
            .select("*")
            .eq("id", conversation_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def find_active_conversation(self, client_id: str | None, trainer_id: str | None) -> dict[str, Any] | None:
        if not trainer_id:
            return None
        query = (
            self.supabase
            .table("conversations")
            .select("*")
            .eq("status", "active")
            .eq("trainer_id", trainer_id)
        )
        if client_id:
            query = query.eq("client_id", client_id)
        else:
            query = query.is_("client_id", "null")
        response = query.limit(1).execute()
        return response.data[0] if response.data else None

    def create_conversation(
        self,
        trainer_id: str,
        client_id: str | None,
        conversation_type: str,
        stage: str,
    ) -> dict[str, Any]:
        result = (
            self.supabase
            .table("conversations")
            .insert(
                {
                    "trainer_id": trainer_id,
                    "client_id": client_id,
                    "type": conversation_type,
                    "current_stage": stage,
                }
            )
            .execute()
        )
        return result.data[0]

    def save_message(
        self,
        conversation_id: str,
        role: str,
        message_text: str,
        structured_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        result = (
            self.supabase
            .table("conversation_messages")
            .insert(
                {
                    "conversation_id": conversation_id,
                    "role": role,
                    "message_text": message_text,
                    "structured_payload": structured_payload,
                }
            )
            .execute()
        )
        return result.data[0]

    def record_usage_event(
        self,
        conversation_id: str,
        message_id: str,
        provider: str,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        thoughts_tokens: int,
        route_flow: str,
        route_reason: str,
        task_type: str,
        response_mode: str,
        fallback_triggered: bool,
    ) -> dict[str, Any]:
        result = (
            self.supabase
            .table("conversation_usage_events")
            .insert(
                {
                    "conversation_id": conversation_id,
                    "message_id": message_id,
                    "provider": provider,
                    "model": model,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "thoughts_tokens": thoughts_tokens,
                    "route_flow": route_flow,
                    "route_reason": route_reason,
                    "task_type": task_type,
                    "response_mode": response_mode,
                    "fallback_triggered": fallback_triggered,
                }
            )
            .execute()
        )
        return result.data[0]

    def get_conversation_usage_summary(self, conversation_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table("conversation_usage_summary")
            .select("*")
            .eq("conversation_id", conversation_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_messages(self, conversation_id: str, limit: int = 20) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table("conversation_messages")
            .select("id, role, message_text, created_at")
            .eq("conversation_id", conversation_id)
            .order("created_at", desc=False)
            .limit(limit)
            .execute()
        )
        return response.data or []

    def update_conversation_state(self, conversation_id: str, stage: str, onboarding_complete: bool) -> None:
        (
            self.supabase
            .table("conversations")
            .update(
                {
                    "current_stage": stage,
                    "onboarding_complete": onboarding_complete,
                }
            )
            .eq("id", conversation_id)
            .execute()
        )
