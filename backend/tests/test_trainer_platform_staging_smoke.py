import os
import sys
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from supabase import create_client
from supabase.lib.client_options import SyncClientOptions

from app.ai.client import GeminiCompletion, TextCompletion, TokenUsage
from app.core.config import settings
from app.db.client import get_supabase_admin_client, get_supabase_user_client
from app.main import app


def _staging_env_ready() -> bool:
    return bool(
        os.getenv("MODE_RUN_STAGING_SUPABASE_TESTS") == "1"
        and settings.supabase_url
        and settings.supabase_anon_key
        and settings.supabase_service_role_key
    )


class FakeLLMClient:
    def _build_token_usage(self) -> TokenUsage:
        return TokenUsage(
            prompt_tokens=21,
            completion_tokens=9,
            total_tokens=30,
            thoughts_tokens=0,
        )

    def create_chat_completion(self, *args, **kwargs):
        del args, kwargs
        return GeminiCompletion(
            text="Trainer platform staging smoke response",
            token_usage=self._build_token_usage(),
        )

    def create_chat_completion_with_usage(self, *args, **kwargs):
        del args, kwargs
        return TextCompletion(
            text='{"headline":"Draft Ready","summary":"Trainer platform staging smoke response","sections":[{"title":"Draft","text":"Trainer platform staging smoke response"}]}',
            token_usage=self._build_token_usage(),
        )

    def stream_chat_completion(self, prompt):
        del prompt
        yield "Trainer "
        yield "platform "
        yield "staging "
        yield "smoke "
        yield "response"


@unittest.skipUnless(
    _staging_env_ready(),
    "Set MODE_RUN_STAGING_SUPABASE_TESTS=1 with real SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY to run.",
)
class TrainerPlatformStagingSmokeTests(unittest.TestCase):
    RETRY_ATTEMPTS = 4

    @classmethod
    def setUpClass(cls):
        cls.admin = get_supabase_admin_client()
        cls.anon = create_client(
            settings.supabase_url,
            settings.supabase_anon_key,
            options=SyncClientOptions(
                auto_refresh_token=False,
                persist_session=False,
            ),
        )
        cls.client = TestClient(app)
        cls.run_timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        cls.run_id = uuid4().hex
        cls.record_prefix = f"smoke_test_{cls.run_timestamp}_{cls.run_id[:8]}"
        cls.password = f"ModeStage!{cls.run_id[:12]}"
        cls.user_ids = []
        cls.tenant_ids = []

        cls.trainer_1_user = cls._create_auth_user(f"{cls.record_prefix}_trainer1@example.com")
        cls.trainer_2_user = cls._create_auth_user(f"{cls.record_prefix}_trainer2@example.com")
        cls.client_1_user = cls._create_auth_user(f"{cls.record_prefix}_client1@example.com")
        cls.client_2_user = cls._create_auth_user(f"{cls.record_prefix}_client2@example.com")
        cls.outsider_user = cls._create_auth_user(f"{cls.record_prefix}_outsider@example.com")

        cls.tenant_1_id, cls.trainer_1_id = cls._bootstrap_trainer_tenant(
            trainer_user_id=cls.trainer_1_user["id"],
            tenant_name=f"{cls.record_prefix}_tenant_a",
            tenant_slug=f"{cls.record_prefix}_tenant_a",
            trainer_display_name=f"{cls.record_prefix}_trainer_a",
        )
        cls.tenant_2_id, cls.trainer_2_id = cls._bootstrap_trainer_tenant(
            trainer_user_id=cls.trainer_2_user["id"],
            tenant_name=f"{cls.record_prefix}_tenant_b",
            tenant_slug=f"{cls.record_prefix}_tenant_b",
            trainer_display_name=f"{cls.record_prefix}_trainer_b",
        )
        cls.tenant_ids.extend([cls.tenant_1_id, cls.tenant_2_id])

        cls.client_1_id = cls._assign_client_to_trainer(
            client_user_id=cls.client_1_user["id"],
            trainer_record_id=cls.trainer_1_id,
        )
        cls.client_2_id = cls._assign_client_to_trainer(
            client_user_id=cls.client_2_user["id"],
            trainer_record_id=cls.trainer_2_id,
        )
        cls.outsider_client_id = cls._assign_client_to_trainer(
            client_user_id=cls.outsider_user["id"],
            trainer_record_id=cls.trainer_2_id,
        )

        cls.trainer_1_access_token = cls._sign_in_and_get_access_token(cls.trainer_1_user["email"])
        cls.trainer_2_access_token = cls._sign_in_and_get_access_token(cls.trainer_2_user["email"])
        cls.client_1_access_token = cls._sign_in_and_get_access_token(cls.client_1_user["email"])
        cls.client_2_access_token = cls._sign_in_and_get_access_token(cls.client_2_user["email"])
        cls.outsider_access_token = cls._sign_in_and_get_access_token(cls.outsider_user["email"])

    @classmethod
    def tearDownClass(cls):
        for tenant_id in cls.tenant_ids:
            try:
                cls.admin.table("tenants").delete().eq("id", tenant_id).execute()
            except Exception:
                pass

        for user_id in cls.user_ids:
            try:
                cls.admin.auth.admin.delete_user(user_id)
            except Exception:
                pass

    @classmethod
    def _create_auth_user(cls, email: str) -> dict[str, str]:
        response = cls._run_with_retries(
            lambda: cls.admin.auth.admin.create_user(
                {
                    "email": email,
                    "password": cls.password,
                    "email_confirm": True,
                }
            ),
            label=f"create_auth_user:{email}",
        )
        user = response.user
        cls.user_ids.append(user.id)
        return {"id": user.id, "email": email}

    @classmethod
    def _bootstrap_trainer_tenant(
        cls,
        *,
        trainer_user_id: str,
        tenant_name: str,
        tenant_slug: str,
        trainer_display_name: str,
    ) -> tuple[str, str]:
        response = cls._run_with_retries(
            lambda: cls.admin.rpc(
                "bootstrap_trainer_tenant",
                {
                    "trainer_user_id": trainer_user_id,
                    "tenant_name": tenant_name,
                    "tenant_slug": tenant_slug,
                    "trainer_display_name": trainer_display_name,
                    "default_persona_name": f"{tenant_slug}_persona",
                    "tone_description": "Clear and practical.",
                    "coaching_philosophy": "Protect isolation and consistency.",
                },
            ).execute(),
            label=f"bootstrap_trainer_tenant:{tenant_slug}",
        )
        row = response.data[0]
        return row["tenant_id"], row["trainer_id"]

    @classmethod
    def _assign_client_to_trainer(cls, *, client_user_id: str, trainer_record_id: str) -> str:
        response = cls._run_with_retries(
            lambda: cls.admin.rpc(
                "assign_client_to_trainer",
                {
                    "client_user_id": client_user_id,
                    "trainer_record_id": trainer_record_id,
                },
            ).execute(),
            label=f"assign_client_to_trainer:{client_user_id}",
        )
        row = response.data[0]
        return row["client_id"]

    @classmethod
    def _sign_in_and_get_access_token(cls, email: str) -> str:
        response = cls._run_with_retries(
            lambda: cls.anon.auth.sign_in_with_password(
                {
                    "email": email,
                    "password": cls.password,
                }
            ),
            label=f"sign_in_with_password:{email}",
        )
        session = getattr(response, "session", None)
        if not session or not session.access_token:
            raise RuntimeError(f"Failed to sign in staging test user {email}")
        return session.access_token

    @classmethod
    def _run_with_retries(cls, fn, *, label: str):
        last_error = None
        for attempt in range(1, cls.RETRY_ATTEMPTS + 1):
            try:
                return fn()
            except Exception as exc:  # pragma: no cover - staging-only reliability helper
                last_error = exc
                if attempt >= cls.RETRY_ATTEMPTS:
                    raise
                time.sleep(0.45 * attempt)
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"Retry helper exhausted without result for {label}")

    def _headers(self, access_token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {access_token}"}

    def _assert_schedule_schema_preflight(self) -> None:
        try:
            self.admin.table("trainer_daily_schedule").select("id, meeting_location").limit(1).execute()
        except Exception as exc:  # pragma: no cover - only runs in staging integration mode
            self.fail(
                "Staging schema preflight failed: trainer_daily_schedule.meeting_location is missing. "
                "Apply backend/sql/20260417_add_meeting_location_to_trainer_daily_schedule.sql before signoff. "
                f"Underlying error: {exc}"
            )

    def _assert_trainer_assistant_storage_preflight(self) -> None:
        try:
            self.admin.table("trainers").select("assistant_last_client_id").limit(1).execute()
            self.admin.table("trainer_assistant_router_events").select("id").limit(1).execute()
        except Exception as exc:  # pragma: no cover - only runs in staging integration mode
            self.fail(
                "Staging schema preflight failed for trainer assistant storage. "
                "Apply backend/sql/20260418b_add_trainer_assistant_last_client_and_router_events.sql before signoff. "
                f"Underlying error: {exc}"
            )

    def _latest_queue_item_for_client(self, trainer_access_token: str, client_id: str) -> dict:
        queue_response = self.client.get(
            "/api/v1/trainer-coach/queue?limit=120",
            headers=self._headers(trainer_access_token),
        )
        self.assertEqual(queue_response.status_code, 200, queue_response.text)
        queue_items = queue_response.json().get("items", [])
        for item in queue_items:
            if item.get("client_id") == client_id:
                return item
        self.fail(f"Expected at least one queue item for client_id={client_id}.")

    def _send_chat(self, access_token: str, message: str) -> dict:
        with (
            patch("app.modules.conversation.service.get_cached_gemini_client", return_value=FakeLLMClient()),
            patch("app.modules.conversation.service.get_cached_openai_client", return_value=FakeLLMClient()),
            patch("app.modules.conversation.service.get_cached_anthropic_client", return_value=FakeLLMClient()),
        ):
            response = self.client.post(
                "/api/v1/chat",
                json={
                    "message": message,
                    "client_context": {"platform": "trainer-platform-staging-smoke"},
                },
                headers=self._headers(access_token),
            )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_staging_preflight_schedule_schema_has_meeting_location(self):
        self._assert_schedule_schema_preflight()

    def test_trainer_actor_can_access_own_command_center_and_client_detail(self):
        self._assert_schedule_schema_preflight()
        command_center_response = self.client.get(
            "/api/v1/trainer-home/command-center",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(command_center_response.status_code, 200, command_center_response.text)

        own_client_response = self.client.get(
            f"/api/v1/trainer-clients/{self.client_1_id}/detail",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(own_client_response.status_code, 200, own_client_response.text)
        self.assertEqual(own_client_response.json()["client"]["client_id"], self.client_1_id)

    def test_trainer_coach_workspace_and_queue_routes_return_for_owner(self):
        self._assert_schedule_schema_preflight()

        workspace_response = self.client.get(
            "/api/v1/trainer-coach/workspace",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(workspace_response.status_code, 200, workspace_response.text)
        workspace_payload = workspace_response.json()
        self.assertIn("summary", workspace_payload)
        self.assertIn("queue", workspace_payload)
        self.assertIn("events", workspace_payload)
        self.assertIn("sync", workspace_payload)

        queue_response = self.client.get(
            "/api/v1/trainer-coach/queue?limit=50",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(queue_response.status_code, 200, queue_response.text)
        queue_payload = queue_response.json()
        self.assertIn("count", queue_payload)
        self.assertIn("items", queue_payload)

    def test_trainer_assistant_execute_route_is_non_500_for_owner(self):
        self._assert_schedule_schema_preflight()
        self._assert_trainer_assistant_storage_preflight()

        with (
            patch("app.modules.trainer_assistant.service.GeminiClient", return_value=FakeLLMClient()),
            patch("app.modules.trainer_assistant.service.OpenAIClient", return_value=FakeLLMClient()),
            patch("app.modules.trainer_assistant.service.AnthropicClient", return_value=FakeLLMClient()),
        ):
            response = self.client.post(
                "/api/v1/trainer-assistant/execute",
                json={
                    "client_id": self.client_1_id,
                    "action_type": "message_client",
                    "message": "Draft a short accountability follow-up.",
                },
                headers=self._headers(self.trainer_1_access_token),
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertTrue(payload.get("draft_id"), response.text)
        self.assertEqual(payload.get("output", {}).get("action_type"), "message_client")

    def test_trainer_coach_events_are_idempotent_and_trainer_scoped(self):
        event_key = f"{self.record_prefix}_coach_event_{uuid4().hex[:8]}"
        payload = {
            "event_key": event_key,
            "event_type": "rule_updated",
            "message": f"{self.record_prefix}_rule_updated",
            "severity": "success",
            "visibility": "system",
            "status": "confirmed",
            "client_id": self.client_1_id,
            "payload": {"source": self.record_prefix},
        }

        create_response = self.client.post(
            "/api/v1/trainer-coach/events",
            json=payload,
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(create_response.status_code, 200, create_response.text)
        created = create_response.json()
        self.assertEqual(created.get("event_type"), "rule_updated")
        self.assertEqual(created.get("client_id"), self.client_1_id)

        replay_response = self.client.post(
            "/api/v1/trainer-coach/events",
            json=payload,
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(replay_response.status_code, 200, replay_response.text)
        replayed = replay_response.json()
        self.assertEqual(replayed.get("id"), created.get("id"))

        cross_trainer_response = self.client.post(
            "/api/v1/trainer-coach/events",
            json=payload,
            headers=self._headers(self.trainer_2_access_token),
        )
        self.assertEqual(cross_trainer_response.status_code, 404, cross_trainer_response.text)

    def test_trainer_program_templates_crud_and_cross_trainer_denied(self):
        create_response = self.client.post(
            "/api/v1/trainer-programs/templates",
            json={
                "name": f"{self.record_prefix}_program_template",
                "goal_type": "strength",
                "experience_level": "intermediate",
                "equipment_access": "full_gym",
                "frequency": 3,
                "template_json": {"blocks": [{"day": 1, "focus": "lower"}]},
                "metadata": {"source": self.record_prefix},
            },
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(create_response.status_code, 200, create_response.text)
        created_template = create_response.json()
        template_id = created_template.get("id")
        self.assertTrue(template_id)

        list_response = self.client.get(
            "/api/v1/trainer-programs/templates?limit=120",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(list_response.status_code, 200, list_response.text)
        listed_ids = [item.get("id") for item in list_response.json().get("items", [])]
        self.assertIn(template_id, listed_ids)

        patch_response = self.client.patch(
            f"/api/v1/trainer-programs/templates/{template_id}",
            json={
                "name": f"{self.record_prefix}_program_template_updated",
                "frequency": 4,
                "metadata": {"source": f"{self.record_prefix}_patch"},
            },
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(patch_response.status_code, 200, patch_response.text)
        self.assertEqual(patch_response.json().get("frequency"), 4)

        cross_patch_response = self.client.patch(
            f"/api/v1/trainer-programs/templates/{template_id}",
            json={"name": "Cross tenant patch should fail"},
            headers=self._headers(self.trainer_2_access_token),
        )
        self.assertEqual(cross_patch_response.status_code, 404, cross_patch_response.text)

        cross_archive_response = self.client.post(
            f"/api/v1/trainer-programs/templates/{template_id}/archive",
            headers=self._headers(self.trainer_2_access_token),
        )
        self.assertEqual(cross_archive_response.status_code, 404, cross_archive_response.text)

        archive_response = self.client.post(
            f"/api/v1/trainer-programs/templates/{template_id}/archive",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(archive_response.status_code, 200, archive_response.text)
        self.assertTrue(archive_response.json().get("is_archived"))

    def test_trainer_coach_approve_bundle_applies_program_memory_delivery_and_idempotency(self):
        prompt = f"{self.record_prefix}_adjust_plan_{uuid4().hex[:6]}"
        self._send_chat(self.client_1_access_token, prompt)
        queue_item = self._latest_queue_item_for_client(self.trainer_1_access_token, self.client_1_id)
        output_id = queue_item.get("output_id")
        self.assertTrue(output_id)

        idempotency_key = f"{self.record_prefix}_approve_{uuid4().hex[:8]}"
        approve_payload = {
            "edited_output_text": f"{self.record_prefix}_approved_output",
            "edited_output_json": {
                "summary": f"{self.record_prefix}_approved_summary",
                "action_type": "adjust_plan",
            },
            "idempotency_key": idempotency_key,
            "apply_bundle": {
                "memory_deltas": [
                    {
                        "memory_key": f"{self.record_prefix}_memory",
                        "text": "Client responds well to concise weekly accountability nudges.",
                        "memory_type": "note",
                        "visibility": "ai_usable",
                        "tags": ["staging", "smoke", self.record_prefix],
                    }
                ],
                "program_template": {
                    "name": f"{self.record_prefix}_approved_program",
                    "goal_type": "fat_loss",
                    "experience_level": "beginner",
                    "equipment_access": "minimal",
                    "frequency": 3,
                    "template_json": {
                        "blocks": [
                            {"day": 1, "focus": "full_body"},
                            {"day": 3, "focus": "conditioning"},
                        ]
                    },
                    "metadata": {"source": f"{self.record_prefix}_approve_bundle"},
                },
                "delivery": {
                    "mode": "send_client_message",
                    "message_text": f"{self.record_prefix}_client_delivery",
                },
            },
        }

        approve_response = self.client.post(
            f"/api/v1/trainer-coach/queue/{output_id}/approve",
            json=approve_payload,
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(approve_response.status_code, 200, approve_response.text)
        approve_body = approve_response.json()
        event_types = {event.get("event_type") for event in approve_body.get("events", [])}
        self.assertIn("draft_approved", event_types)
        self.assertIn("memory_saved", event_types)
        self.assertIn("program_updated", event_types)
        self.assertIn("client_message_sent", event_types)
        self.assertEqual(approve_body.get("delivery", {}).get("mode"), "sent")
        self.assertTrue(approve_body.get("program_template", {}).get("applied"))
        conversation_id = approve_body.get("delivery", {}).get("conversation_id")
        message_id = approve_body.get("delivery", {}).get("message_id")
        self.assertTrue(conversation_id)
        self.assertTrue(message_id)

        replay_response = self.client.post(
            f"/api/v1/trainer-coach/queue/{output_id}/approve",
            json=approve_payload,
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(replay_response.status_code, 200, replay_response.text)
        replay_body = replay_response.json()
        self.assertEqual(replay_body.get("delivery", {}).get("conversation_id"), conversation_id)
        self.assertEqual(replay_body.get("delivery", {}).get("message_id"), message_id)

        history_response = self.client.get(
            f"/api/v1/chat/history?conversation_id={conversation_id}",
            headers=self._headers(self.client_1_access_token),
        )
        self.assertEqual(history_response.status_code, 200, history_response.text)
        history_items = history_response.json().get("items", [])
        self.assertTrue(
            any(
                item.get("kind") == "client_message_sent" and item.get("visibility") == "client_public"
                for item in history_items
            )
        )

    def test_client_and_outsider_cannot_access_trainer_only_routes(self):
        client_response = self.client.get(
            "/api/v1/trainer-home/command-center",
            headers=self._headers(self.client_1_access_token),
        )
        self.assertEqual(client_response.status_code, 403, client_response.text)

        outsider_response = self.client.get(
            "/api/v1/trainer-home/command-center",
            headers=self._headers(self.outsider_access_token),
        )
        self.assertEqual(outsider_response.status_code, 403, outsider_response.text)

    def test_cross_trainer_client_detail_access_is_blocked(self):
        trainer_1_cross_response = self.client.get(
            f"/api/v1/trainer-clients/{self.client_2_id}/detail",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(trainer_1_cross_response.status_code, 404, trainer_1_cross_response.text)

        trainer_2_cross_response = self.client.get(
            f"/api/v1/trainer-clients/{self.client_1_id}/detail",
            headers=self._headers(self.trainer_2_access_token),
        )
        self.assertEqual(trainer_2_cross_response.status_code, 404, trainer_2_cross_response.text)

    def test_storage_private_routes_are_tenant_scoped(self):
        random_name = f"{uuid4().hex}_{uuid4().hex[:24]}.pdf"
        cross_trainer_path = f"trainer/{self.trainer_2_id}/workspace/{random_name}"
        cross_client_path = f"client/{self.client_2_id}/{random_name}"

        trainer_cross_response = self.client.post(
            "/api/v1/storage/private/download-url",
            json={"object_path": cross_trainer_path},
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(trainer_cross_response.status_code, 403, trainer_cross_response.text)

        client_cross_response = self.client.post(
            "/api/v1/storage/private/download-url",
            json={"object_path": cross_client_path},
            headers=self._headers(self.client_1_access_token),
        )
        self.assertEqual(client_cross_response.status_code, 403, client_cross_response.text)

    def test_trainer_knowledge_ingest_persists_and_lists_for_owner(self):
        ingest_response = self.client.post(
            "/api/v1/trainer-knowledge/ingest",
            json={
                "title": f"{self.record_prefix}_methodology",
                "raw_text": "If fatigue is elevated, reduce intensity before reducing frequency.",
                "document_type": "text",
                "metadata": {"source": self.record_prefix},
            },
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(ingest_response.status_code, 200, ingest_response.text)
        ingest_payload = ingest_response.json()
        created_document_id = ingest_payload.get("document", {}).get("id")
        self.assertTrue(created_document_id)

        list_response = self.client.get(
            "/api/v1/trainer-knowledge",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(list_response.status_code, 200, list_response.text)
        listed_ids = [row.get("id") for row in (list_response.json() or [])]
        self.assertIn(created_document_id, listed_ids)

        patch_response = self.client.patch(
            f"/api/v1/trainer-knowledge/{created_document_id}",
            json={
                "title": f"{self.record_prefix}_methodology_updated",
                "raw_text": "Updated: reduce intensity first, then adjust volume if fatigue stays high.",
            },
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(patch_response.status_code, 200, patch_response.text)
        patch_payload = patch_response.json()
        self.assertEqual(
            patch_payload.get("document", {}).get("title"),
            f"{self.record_prefix}_methodology_updated",
        )

    def test_client_tokens_cannot_read_internal_only_coach_memory(self):
        inserted_rows = self.admin.table("coach_memory").insert(
            {
                "trainer_id": self.trainer_1_id,
                "client_id": self.client_1_id,
                "memory_type": "note",
                "memory_key": f"{self.record_prefix}_internal_only_visibility",
                "value_json": {
                    "visibility": "internal_only",
                    "text": "Internal trainer note for RLS smoke coverage.",
                },
            }
        ).execute().data or []
        self.assertEqual(len(inserted_rows), 1)
        memory_id = inserted_rows[0]["id"]

        assigned_client_rows = (
            get_supabase_user_client(self.client_1_access_token)
            .table("coach_memory")
            .select("id")
            .eq("id", memory_id)
            .execute()
            .data
        )
        self.assertEqual(assigned_client_rows, [])

        cross_tenant_client_rows = (
            get_supabase_user_client(self.client_2_access_token)
            .table("coach_memory")
            .select("id")
            .eq("id", memory_id)
            .execute()
            .data
        )
        self.assertEqual(cross_tenant_client_rows, [])

        trainer_owner_rows = (
            get_supabase_user_client(self.trainer_1_access_token)
            .table("coach_memory")
            .select("id, trainer_id, client_id")
            .eq("id", memory_id)
            .execute()
            .data
        )
        self.assertEqual(len(trainer_owner_rows), 1)
        self.assertEqual(trainer_owner_rows[0]["trainer_id"], self.trainer_1_id)
        self.assertEqual(trainer_owner_rows[0]["client_id"], self.client_1_id)

    def test_trainer_review_outputs_are_scoped_to_current_trainer(self):
        self._send_chat(self.client_1_access_token, "Give me a quick progression adjustment.")
        self._send_chat(self.client_2_access_token, "Need a check-in summary for tomorrow.")

        trainer_1_outputs = self.client.get(
            "/api/v1/trainer-review/outputs?source_type=chat",
            headers=self._headers(self.trainer_1_access_token),
        )
        self.assertEqual(trainer_1_outputs.status_code, 200, trainer_1_outputs.text)
        trainer_1_items = trainer_1_outputs.json().get("items", [])
        self.assertGreaterEqual(len(trainer_1_items), 1)
        self.assertTrue(all(item.get("trainer_id") == self.trainer_1_id for item in trainer_1_items))
        self.assertTrue(all(item.get("client_id") == self.client_1_id for item in trainer_1_items))

        trainer_2_outputs = self.client.get(
            "/api/v1/trainer-review/outputs?source_type=chat",
            headers=self._headers(self.trainer_2_access_token),
        )
        self.assertEqual(trainer_2_outputs.status_code, 200, trainer_2_outputs.text)
        trainer_2_items = trainer_2_outputs.json().get("items", [])
        self.assertGreaterEqual(len(trainer_2_items), 1)
        self.assertTrue(all(item.get("trainer_id") == self.trainer_2_id for item in trainer_2_items))
        self.assertTrue(all(item.get("client_id") == self.client_2_id for item in trainer_2_items))


if __name__ == "__main__":
    unittest.main()
