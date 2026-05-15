import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.core.auth import AuthenticatedUser, require_user
from app.core.config import settings
from app.core.dependencies import get_conversation_service, get_trainer_context
from app.core.rate_limit import _rate_limiter, _redis_rate_limiter, enforce_rate_limit
from app.core.tenancy import TrainerContext
from app.main import app
from app.modules.conversation.security import redact_log_payload, validate_llm_output
from app.modules.conversation.service import ConversationService


class _ExplodingConversationService:
    def handle_chat(self, user_id, trainer_context, request):
        del user_id, trainer_context, request
        raise RuntimeError("controlled test failure")


def _request_from_ip(ip_address: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/chat",
            "headers": [],
            "query_string": b"",
            "client": (ip_address, 49152),
            "server": ("testserver", 80),
            "scheme": "http",
        }
    )


class _FakeRedisClient:
    def __init__(self) -> None:
        self.values: dict[str, int] = {}
        self.expiry_seconds: dict[str, int] = {}

    def incr(self, key: str) -> int:
        self.values[key] = int(self.values.get(key, 0)) + 1
        return self.values[key]

    def expire(self, key: str, seconds: int) -> bool:
        self.expiry_seconds[key] = seconds
        return True


class SecurityPhaseETests(unittest.TestCase):
    def tearDown(self):
        _rate_limiter._windows.clear()
        _redis_rate_limiter._client = None
        _redis_rate_limiter._client_url = None
        _redis_rate_limiter._client_timeout_seconds = None
        app.dependency_overrides.clear()

    def test_llm_output_schema_leakage_redacted(self):
        safe_text, flags = validate_llm_output(
            "trainer_id = trainer-sec SELECT clients",
            "trainer-sec",
            "client-sec",
        )

        self.assertIn("schema_tenant_leakage", flags)
        self.assertIn("sql_in_output", flags)
        self.assertNotIn("trainer-sec", safe_text)
        self.assertIn("[redacted]", safe_text)

    def test_injection_in_llm_output_flagged(self):
        safe_text, flags = validate_llm_output(
            "The system prompt says client_id: client-sec",
            "trainer-sec",
            "client-sec",
        )

        self.assertIn("prompt_reflection", flags)
        self.assertIn("schema_tenant_leakage", flags)
        self.assertNotIn("client-sec", safe_text)

    def test_output_validation_log_excludes_raw_response_content(self):
        service = ConversationService.__new__(ConversationService)
        trainer_context = TrainerContext(
            tenant_id="tenant-sec",
            trainer_id="trainer-sec",
            trainer_user_id="trainer-user-sec",
            trainer_display_name="Coach",
            client_id="client-sec",
            client_user_id="client-user-sec",
        )
        raw_output = "SELECT clients"
        metadata = {}

        with self.assertLogs("app.modules.conversation.service", level="WARNING") as logs:
            safe_text = service._validate_assistant_output(
                raw_output,
                trainer_context=trainer_context,
                conversation_id="conversation-sec",
                orchestration_metadata=metadata,
            )

        joined = "\n".join(logs.output)
        self.assertEqual(safe_text, "[redacted]")
        self.assertNotIn(raw_output, joined)
        self.assertEqual(metadata["llm_output_flags"], ["sql_in_output"])

    def test_raw_message_content_not_in_logs(self):
        original_rate_limit_enabled = settings.rate_limit_enabled
        settings.rate_limit_enabled = False
        secret_message = "phase-e-raw-message-secret"
        app.dependency_overrides[require_user] = lambda: AuthenticatedUser(
            id="user-sec",
            email="user@example.com",
            access_token="token-sec",
        )
        app.dependency_overrides[get_trainer_context] = lambda: TrainerContext(
            tenant_id="tenant-sec",
            trainer_id="trainer-sec",
            trainer_user_id="trainer-user-sec",
            trainer_display_name="Coach",
            client_id="client-sec",
            client_user_id="user-sec",
        )
        app.dependency_overrides[get_conversation_service] = lambda: _ExplodingConversationService()
        client = TestClient(app)

        try:
            with self.assertLogs("app.api.v1.chat", level="ERROR") as logs:
                response = client.post(
                    "/api/v1/chat",
                    json={"message": secret_message},
                    headers={"Authorization": "Bearer ignored"},
                )
        finally:
            settings.rate_limit_enabled = original_rate_limit_enabled

        self.assertEqual(response.status_code, 502)
        self.assertNotIn(secret_message, "\n".join(logs.output))

    def test_rate_limit_fires_at_threshold(self):
        setting_names = [
            "rate_limit_enabled",
            "rate_limit_backend",
            "rate_limit_window_seconds",
            "rate_limit_chat_per_window",
            "rate_limit_chat_client_per_window",
            "rate_limit_chat_trainer_per_window",
            "rate_limit_chat_ip_per_window",
            "rate_limit_ip_per_window",
        ]
        original_settings = {name: getattr(settings, name) for name in setting_names}
        user = AuthenticatedUser(id="user-sec", email="user@example.com", access_token="token-sec")
        request = _request_from_ip("203.0.113.80")

        try:
            settings.rate_limit_enabled = True
            settings.rate_limit_backend = "memory"
            settings.rate_limit_window_seconds = 60
            settings.rate_limit_chat_per_window = 100
            settings.rate_limit_chat_client_per_window = 1
            settings.rate_limit_chat_trainer_per_window = 100
            settings.rate_limit_chat_ip_per_window = 100
            settings.rate_limit_ip_per_window = 100
            _rate_limiter._windows.clear()

            enforce_rate_limit(
                group="chat",
                user=user,
                request=request,
                context={"trainer_id": "trainer-sec", "client_id": "client-sec"},
            )
            with self.assertRaises(HTTPException) as exc:
                enforce_rate_limit(
                    group="chat",
                    user=user,
                    request=request,
                    context={"trainer_id": "trainer-sec", "client_id": "client-sec"},
                )
        finally:
            for name, value in original_settings.items():
                setattr(settings, name, value)
            _rate_limiter._windows.clear()

        self.assertEqual(exc.exception.status_code, 429)
        self.assertIn("chat|scope:client:client-sec", exc.exception.detail["scopes_checked"])

    def test_redis_rate_limit_fires_at_threshold(self):
        setting_names = [
            "rate_limit_enabled",
            "rate_limit_backend",
            "redis_url",
            "chat_cache_timeout_ms",
            "rate_limit_window_seconds",
            "rate_limit_chat_per_window",
            "rate_limit_chat_client_per_window",
            "rate_limit_chat_trainer_per_window",
            "rate_limit_chat_ip_per_window",
            "rate_limit_ip_per_window",
        ]
        original_settings = {name: getattr(settings, name) for name in setting_names}
        fake_redis = _FakeRedisClient()
        redis_from_url_calls = []
        user = AuthenticatedUser(id="user-sec", email="user@example.com", access_token="token-sec")
        request = _request_from_ip("203.0.113.81")

        try:
            settings.rate_limit_enabled = True
            settings.rate_limit_backend = "redis"
            settings.redis_url = "redis://localhost:6379/0"
            settings.chat_cache_timeout_ms = 25
            settings.rate_limit_window_seconds = 60
            settings.rate_limit_chat_per_window = 100
            settings.rate_limit_chat_client_per_window = 1
            settings.rate_limit_chat_trainer_per_window = 100
            settings.rate_limit_chat_ip_per_window = 100
            settings.rate_limit_ip_per_window = 100

            def fake_from_url(*args, **kwargs):
                redis_from_url_calls.append((args, kwargs))
                return fake_redis

            redis_module = SimpleNamespace(Redis=SimpleNamespace(from_url=fake_from_url))
            with patch.dict(sys.modules, {"redis": redis_module}):
                enforce_rate_limit(
                    group="chat",
                    user=user,
                    request=request,
                    context={"trainer_id": "trainer-sec", "client_id": "client-sec"},
                )
                with self.assertRaises(HTTPException) as exc:
                    enforce_rate_limit(
                        group="chat",
                        user=user,
                        request=request,
                        context={"trainer_id": "trainer-sec", "client_id": "client-sec"},
                    )
        finally:
            for name, value in original_settings.items():
                setattr(settings, name, value)

        self.assertEqual(exc.exception.status_code, 429)
        self.assertIn("chat|scope:client:client-sec", exc.exception.detail["scopes_checked"])
        self.assertEqual(len(redis_from_url_calls), 1)

    def test_redis_rate_limit_unavailable_fails_closed(self):
        setting_names = [
            "rate_limit_enabled",
            "rate_limit_backend",
            "redis_url",
            "rate_limit_window_seconds",
            "rate_limit_chat_per_window",
            "rate_limit_chat_client_per_window",
            "rate_limit_chat_trainer_per_window",
            "rate_limit_chat_ip_per_window",
            "rate_limit_ip_per_window",
        ]
        original_settings = {name: getattr(settings, name) for name in setting_names}
        user = AuthenticatedUser(id="user-sec", email="user@example.com", access_token="token-sec")
        request = _request_from_ip("203.0.113.82")

        try:
            settings.rate_limit_enabled = True
            settings.rate_limit_backend = "redis"
            settings.redis_url = None
            settings.rate_limit_window_seconds = 60
            settings.rate_limit_chat_per_window = 100
            settings.rate_limit_chat_client_per_window = 100
            settings.rate_limit_chat_trainer_per_window = 100
            settings.rate_limit_chat_ip_per_window = 100
            settings.rate_limit_ip_per_window = 100

            with self.assertRaises(HTTPException) as exc:
                enforce_rate_limit(
                    group="chat",
                    user=user,
                    request=request,
                    context={"trainer_id": "trainer-sec", "client_id": "client-sec"},
                )
        finally:
            for name, value in original_settings.items():
                setattr(settings, name, value)

        self.assertEqual(exc.exception.status_code, 503)
        self.assertEqual(exc.exception.detail["detail"], "Rate limiter unavailable")

    def test_service_role_key_not_used_in_request_handler(self):
        api_dir = Path(__file__).resolve().parents[1] / "app" / "api" / "v1"
        allowed_exception_files = {"storage_private.py"}
        forbidden_markers = (
            "get_supabase_admin_client(",
            "get_supabase_client(",
            "supabase_service_role_key",
            "SUPABASE_SERVICE_ROLE_KEY",
        )
        violations: list[str] = []
        for path in sorted(api_dir.glob("*.py")):
            source = path.read_text(encoding="utf-8")
            for marker in forbidden_markers:
                if path.name in allowed_exception_files and marker == "get_supabase_admin_client(":
                    continue
                if marker in source:
                    violations.append(f"{path.name}:{marker}")

        self.assertEqual(violations, [])

    def test_storage_private_is_only_api_handler_service_role_exception(self):
        api_dir = Path(__file__).resolve().parents[1] / "app" / "api" / "v1"
        exception_files = []
        for path in sorted(api_dir.glob("*.py")):
            source = path.read_text(encoding="utf-8")
            if "get_supabase_admin_client(" in source or "supabase_service_role_key" in source:
                exception_files.append(path.name)

        self.assertEqual(exception_files, ["storage_private.py"])

    def test_service_role_key_not_used_in_request_time_foundations(self):
        app_dir = Path(__file__).resolve().parents[1] / "app"
        checked_paths = [
            app_dir / "core" / "auth.py",
            app_dir / "core" / "rate_limit.py",
            app_dir / "modules" / "conversation" / "repository.py",
            app_dir / "modules" / "intelligence_jobs" / "queue.py",
        ]
        violations = []
        for path in checked_paths:
            source = path.read_text(encoding="utf-8")
            if "get_supabase_admin_client" in source or "supabase_service_role_key" in source:
                violations.append(str(path.relative_to(app_dir)))
        self.assertEqual(violations, [])

    def test_dependency_admin_factories_are_internal_only(self):
        source = (Path(__file__).resolve().parents[1] / "app" / "core" / "dependencies.py").read_text(encoding="utf-8")
        current_function = ""
        violations = []
        for line in source.splitlines():
            if line.startswith("def "):
                current_function = line.split("(", 1)[0].replace("def ", "").strip()
            if "get_supabase_admin_client()" in line and not current_function.startswith("get_internal_"):
                violations.append(current_function or "<module>")
        self.assertEqual(violations, [])

    def test_redact_log_payload_redacts_sensitive_keys(self):
        payload = {
            "message_content": "secret message",
            "nested": {
                "response_content": "secret response",
                "safe_id": "trace-123",
            },
            "items": [{"client_name": "Taylor"}, {"status": "ok"}],
        }

        redacted = redact_log_payload(payload)

        self.assertEqual(redacted["message_content"], "[redacted]")
        self.assertEqual(redacted["nested"]["response_content"], "[redacted]")
        self.assertEqual(redacted["nested"]["safe_id"], "trace-123")
        self.assertEqual(redacted["items"][0]["client_name"], "[redacted]")
        self.assertEqual(redacted["items"][1]["status"], "ok")


if __name__ == "__main__":
    unittest.main()
