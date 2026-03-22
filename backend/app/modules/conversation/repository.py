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

    def find_active_conversation(self, client_id: str, trainer_id: str | None) -> dict[str, Any] | None:
        if not client_id:
            return None
        query = (
            self.supabase
            .table("conversations")
            .select("*")
            .eq("client_id", client_id)
            .eq("status", "active")
        )
        if trainer_id:
            query = query.eq("trainer_id", trainer_id)
        response = query.limit(1).execute()
        return response.data[0] if response.data else None

    def create_conversation(self, trainer_id: str, client_id: str, conversation_type: str, stage: str) -> dict[str, Any]:
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
