from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client


class ConversationRepository:
    _AI_REQUESTS_TABLE = 'conversation_ai_requests'
    _AI_REQUEST_EVENTS_TABLE = 'conversation_ai_request_events'

    def __init__(self, supabase: Client):
        self.supabase = supabase

    def get_conversation(self, conversation_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table('conversations')
            .select('*')
            .eq('id', conversation_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def find_active_conversation(
        self,
        client_id: str | None,
        trainer_id: str | None,
        preferred_types: list[str] | None = None,
        fallback_to_any: bool = True,
    ) -> dict[str, Any] | None:
        if not trainer_id:
            return None

        def query_active(conversation_type: str | None = None) -> dict[str, Any] | None:
            query = (
                self.supabase
                .table('conversations')
                .select('*')
                .eq('status', 'active')
                .eq('trainer_id', trainer_id)
            )
            if client_id:
                query = query.eq('client_id', client_id)
            else:
                query = query.is_('client_id', 'null')
            if conversation_type:
                query = query.eq('type', conversation_type)
            response = (
                query
                .order('updated_at', desc=True)
                .order('created_at', desc=True)
                .limit(1)
                .execute()
            )
            return response.data[0] if response.data else None

        for conversation_type in preferred_types or []:
            candidate = query_active(conversation_type)
            if candidate:
                return candidate

        if fallback_to_any:
            return query_active()
        return None

    def create_conversation(
        self,
        trainer_id: str,
        client_id: str | None,
        conversation_type: str,
        stage: str,
    ) -> dict[str, Any]:
        result = (
            self.supabase
            .table('conversations')
            .insert(
                {
                    'trainer_id': trainer_id,
                    'client_id': client_id,
                    'type': conversation_type,
                    'current_stage': stage,
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
        *,
        client_message_id: str | None = None,
        idempotency_key: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        row_payload: dict[str, Any] = {
            'conversation_id': conversation_id,
            'role': role,
            'message_text': message_text,
            'structured_payload': structured_payload,
        }
        if client_message_id:
            row_payload['client_message_id'] = client_message_id
        if idempotency_key:
            row_payload['idempotency_key'] = idempotency_key
        if request_id:
            row_payload['request_id'] = request_id

        try:
            result = (
                self.supabase
                .table('conversation_messages')
                .insert(row_payload)
                .execute()
            )
            return result.data[0]
        except Exception as exc:
            if not self._is_chat_ai_schema_mismatch(exc):
                raise

            fallback_structured_payload = structured_payload if isinstance(structured_payload, dict) else {}
            client_delivery = fallback_structured_payload.get('client_delivery')
            if not isinstance(client_delivery, dict):
                client_delivery = {}
            if client_message_id:
                client_delivery['client_message_id'] = client_message_id
            if idempotency_key:
                client_delivery['idempotency_key'] = idempotency_key
            if request_id:
                client_delivery['request_id'] = request_id
            if client_delivery:
                fallback_structured_payload = {
                    **fallback_structured_payload,
                    'client_delivery': client_delivery,
                }

            result = (
                self.supabase
                .table('conversation_messages')
                .insert(
                    {
                        'conversation_id': conversation_id,
                        'role': role,
                        'message_text': message_text,
                        'structured_payload': fallback_structured_payload,
                    }
                )
                .execute()
            )
            return result.data[0]

    def find_message_by_client_message_id(
        self,
        conversation_id: str,
        client_message_id: str,
    ) -> dict[str, Any] | None:
        if not client_message_id:
            return None
        try:
            response = (
                self.supabase
                .table('conversation_messages')
                .select('*')
                .eq('conversation_id', conversation_id)
                .eq('client_message_id', client_message_id)
                .limit(1)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            if self._is_chat_ai_schema_mismatch(exc):
                return None
            raise

    def create_ai_request(
        self,
        *,
        request_id: str | None,
        conversation_id: str,
        trainer_id: str,
        client_id: str | None,
        request_status: str,
        client_message_id: str | None,
        idempotency_key: str | None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        try:
            response = (
                self.supabase
                .table(self._AI_REQUESTS_TABLE)
                .insert(
                    {
                        **({'id': request_id} if request_id else {}),
                        'conversation_id': conversation_id,
                        'trainer_id': trainer_id,
                        'client_id': client_id,
                        'request_status': request_status,
                        'client_message_id': client_message_id,
                        'idempotency_key': idempotency_key,
                        'metadata': metadata or {},
                    }
                )
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            if request_id:
                try:
                    existing = (
                        self.supabase
                        .table(self._AI_REQUESTS_TABLE)
                        .select('*')
                        .eq('id', request_id)
                        .limit(1)
                        .execute()
                    )
                    if existing.data:
                        return existing.data[0]
                except Exception:
                    pass
            if self._is_chat_ai_schema_mismatch(exc):
                return None
            raise

    def get_ai_request_by_idempotency(
        self,
        *,
        conversation_id: str,
        idempotency_key: str,
    ) -> dict[str, Any] | None:
        if not idempotency_key:
            return None
        try:
            response = (
                self.supabase
                .table(self._AI_REQUESTS_TABLE)
                .select('*')
                .eq('conversation_id', conversation_id)
                .eq('idempotency_key', idempotency_key)
                .order('created_at', desc=True)
                .limit(1)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            if self._is_chat_ai_schema_mismatch(exc):
                return None
            raise

    def list_ai_request_events(
        self,
        request_id: str,
        *,
        since_seq: int = 0,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        try:
            query = (
                self.supabase
                .table(self._AI_REQUEST_EVENTS_TABLE)
                .select('request_id, seq, event_type, stage, payload, created_at')
                .eq('request_id', request_id)
                .gt('seq', max(0, int(since_seq or 0)))
                .order('seq', desc=False)
                .limit(max(1, min(limit, 500)))
            )
            response = query.execute()
            return response.data or []
        except Exception as exc:
            if self._is_chat_ai_schema_mismatch(exc):
                return []
            raise

    def append_ai_request_event(
        self,
        *,
        request_id: str,
        seq: int,
        event_type: str,
        stage: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        try:
            response = (
                self.supabase
                .table(self._AI_REQUEST_EVENTS_TABLE)
                .insert(
                    {
                        'request_id': request_id,
                        'seq': seq,
                        'event_type': event_type,
                        'stage': stage,
                        'payload': payload or {},
                    }
                )
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            if self._is_chat_ai_schema_mismatch(exc):
                return None
            raise

    def update_ai_request_status(
        self,
        *,
        request_id: str,
        status: str,
        latest_event_seq: int | None = None,
        completed_message_id: str | None = None,
        error_detail: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            'request_status': status,
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }
        if latest_event_seq is not None:
            payload['latest_event_seq'] = int(latest_event_seq)
        if completed_message_id:
            payload['completed_message_id'] = completed_message_id
        if error_detail:
            payload['error_detail'] = error_detail

        try:
            (
                self.supabase
                .table(self._AI_REQUESTS_TABLE)
                .update(payload)
                .eq('id', request_id)
                .execute()
            )
        except Exception as exc:
            if self._is_chat_ai_schema_mismatch(exc):
                return
            raise

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
            .table('conversation_usage_events')
            .insert(
                {
                    'conversation_id': conversation_id,
                    'message_id': message_id,
                    'provider': provider,
                    'model': model,
                    'prompt_tokens': prompt_tokens,
                    'completion_tokens': completion_tokens,
                    'total_tokens': total_tokens,
                    'thoughts_tokens': thoughts_tokens,
                    'route_flow': route_flow,
                    'route_reason': route_reason,
                    'task_type': task_type,
                    'response_mode': response_mode,
                    'fallback_triggered': fallback_triggered,
                }
            )
            .execute()
        )
        return result.data[0]

    def get_conversation_usage_summary(self, conversation_id: str) -> dict[str, Any] | None:
        response = (
            self.supabase
            .table('conversation_usage_summary')
            .select('*')
            .eq('conversation_id', conversation_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def list_messages(self, conversation_id: str, limit: int = 20) -> list[dict[str, Any]]:
        response = (
            self.supabase
            .table('conversation_messages')
            .select('id, role, message_text, created_at')
            .eq('conversation_id', conversation_id)
            .order('created_at', desc=False)
            .limit(limit)
            .execute()
        )
        return response.data or []

    def list_messages_with_payload(
        self,
        conversation_id: str,
        limit: int = 80,
        *,
        before_created_at: str | None = None,
    ) -> list[dict[str, Any]]:
        query = (
            self.supabase
            .table('conversation_messages')
            .select('id, role, message_text, structured_payload, created_at')
            .eq('conversation_id', conversation_id)
        )
        if before_created_at:
            query = query.lt('created_at', before_created_at)

        response = (
            query
            .order('created_at', desc=True)
            .order('id', desc=True)
            .limit(limit)
            .execute()
        )
        rows = response.data or []
        rows.reverse()
        return rows

    def update_conversation_state(self, conversation_id: str, stage: str, onboarding_complete: bool) -> None:
        (
            self.supabase
            .table('conversations')
            .update(
                {
                    'current_stage': stage,
                    'onboarding_complete': onboarding_complete,
                    'updated_at': datetime.now(timezone.utc).isoformat(),
                }
            )
            .eq('id', conversation_id)
            .execute()
        )

    @classmethod
    def _error_text(cls, exc: Exception) -> str:
        parts: list[str] = []
        current: BaseException | None = exc
        while current is not None:
            parts.append(str(current))
            current = current.__cause__
        return ' '.join(parts).lower()

    @classmethod
    def _error_codes(cls, exc: Exception) -> set[str]:
        codes: set[str] = set()
        current: BaseException | None = exc
        while current is not None:
            current_code = getattr(current, 'code', None)
            if current_code:
                codes.add(str(current_code).upper())
            for arg in getattr(current, 'args', ()):  # type: ignore[attr-defined]
                if isinstance(arg, dict):
                    arg_code = arg.get('code')
                    if arg_code:
                        codes.add(str(arg_code).upper())
            current = current.__cause__
        return codes

    @classmethod
    def _is_chat_ai_schema_mismatch(cls, exc: Exception) -> bool:
        error_codes = cls._error_codes(exc)
        if {'42P01', '42703', 'PGRST205'}.intersection(error_codes):
            return True
        text = cls._error_text(exc)
        return (
            cls._AI_REQUESTS_TABLE in text
            or cls._AI_REQUEST_EVENTS_TABLE in text
            or 'client_message_id' in text
            or 'idempotency_key' in text
            or ('request_id' in text and 'conversation_messages' in text)
        )
