import asyncio
import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.main import app
from app.modules.conversation.trace import ChatTrace, ChatTraceAccumulator
from app.modules.intelligence_jobs.handlers import run_intelligence_job
from app.modules.intelligence_jobs.schemas import IntelligenceJob
from app.modules.observability import health as health_module
from app.modules.observability.health import build_healthz_payload
from app.modules.observability.metrics import ALERT_THRESHOLDS, PHASE_D_METRIC_NAMES


class FakeJobRepository:
    def __init__(self):
        self.traces = []

    def get_job(self, job_id):
        del job_id
        return {"status": "queued", "attempt_count": 0}

    def mark_running(self, job, *, attempt_number):
        del job, attempt_number

    def mark_success(self, job, *, attempt_number):
        del job, attempt_number

    def record_worker_trace(self, trace_payload):
        self.traces.append(trace_payload)


class ObservabilityPhaseDTests(unittest.TestCase):
    def tearDown(self):
        health_module.reset_health_cache_for_tests()

    def test_healthz_responds_under_100ms(self):
        async def fake_healthz():
            return {
                "status": "ok",
                "ok": True,
                "db": "ok",
                "redis": "ok",
                "queue": "ok",
                "duration_ms": 3,
                "cache_age_ms": 10,
                "checks": {},
            }

        client = TestClient(app)
        started_at = time.perf_counter()
        with patch("app.main.build_healthz_payload", side_effect=fake_healthz):
            response = client.get("/healthz")

        self.assertLess((time.perf_counter() - started_at) * 1000, 100)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {key: response.json()[key] for key in ("status", "db", "redis", "queue")},
            {"status": "ok", "db": "ok", "redis": "ok", "queue": "ok"},
        )

    def test_healthz_returns_cached_structured_snapshot(self):
        with patch("app.modules.observability.health._check_db_sync") as db:
            with patch("app.modules.observability.health._check_redis_sync") as redis:
                with patch("app.modules.observability.health._check_queue_sync") as queue:
                    asyncio.run(health_module.refresh_health_snapshot(timeout_ms=100))
                    payload = asyncio.run(build_healthz_payload())

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["db"], "ok")
        self.assertEqual(payload["redis"], "ok")
        self.assertEqual(payload["queue"], "ok")
        self.assertIsInstance(payload["cache_age_ms"], int)
        self.assertIn("dependency_duration_ms", payload)
        self.assertEqual(set(payload["checks"].keys()), {"db", "redis", "queue"})
        db.assert_called_once()
        redis.assert_called_once()
        queue.assert_called_once()

    def test_healthz_cached_snapshot_does_not_block_on_slow_dependency_checks(self):
        with patch("app.modules.observability.health._check_db_sync"):
            with patch("app.modules.observability.health._check_redis_sync"):
                with patch("app.modules.observability.health._check_queue_sync"):
                    asyncio.run(health_module.refresh_health_snapshot(timeout_ms=100))

        def slow_check():
            time.sleep(0.2)

        with patch("app.modules.observability.health._check_db_sync", side_effect=slow_check):
            started_at = time.perf_counter()
            payload = asyncio.run(build_healthz_payload(cache_ttl_seconds=60))

        self.assertLess((time.perf_counter() - started_at) * 1000, 100)
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["db"], "ok")

    def test_healthz_stale_snapshot_returns_degraded(self):
        ok_payload = {
            "status": "ok",
            "ok": True,
            "db": "ok",
            "redis": "ok",
            "queue": "ok",
            "duration_ms": 0,
            "dependency_duration_ms": 3,
            "checks": {
                "db": {"status": "ok", "latency_ms": 1, "error_category": None},
                "redis": {"status": "ok", "latency_ms": 1, "error_category": None},
                "queue": {"status": "ok", "latency_ms": 1, "error_category": None},
            },
        }
        health_module._health_snapshot = health_module.HealthSnapshot(
            captured_at=time.perf_counter() - 60,
            payload=ok_payload,
        )

        payload = asyncio.run(build_healthz_payload(cache_ttl_seconds=999, stale_after_seconds=1))

        self.assertEqual(payload["status"], "degraded")
        self.assertFalse(payload["ok"])
        self.assertTrue(payload["stale"])
        self.assertEqual(payload["checks"]["snapshot"]["error_category"], "HealthSnapshotStale")

    def test_healthz_initial_snapshot_is_fast_and_refreshes_in_background(self):
        calls = []

        def record_check():
            calls.append("check")

        async def run_probe():
            with patch("app.modules.observability.health._check_db_sync", side_effect=record_check):
                with patch("app.modules.observability.health._check_redis_sync", side_effect=record_check):
                    with patch("app.modules.observability.health._check_queue_sync", side_effect=record_check):
                        payload = await build_healthz_payload()
                        await asyncio.sleep(0.05)
                        warmed = await build_healthz_payload()
                        return payload, warmed

        payload, warmed = asyncio.run(run_probe())

        self.assertEqual(payload["status"], "degraded")
        self.assertEqual(payload["db"], "unknown")
        self.assertEqual(warmed["status"], "ok")
        self.assertEqual(len(calls), 3)

    def test_healthz_db_check_uses_rls_safe_ping_rpc(self):
        class FakeClient:
            def __init__(self):
                self.rpc_name = None

            def rpc(self, name):
                self.rpc_name = name
                return self

            def execute(self):
                return {"ok": True}

        fake_client = FakeClient()
        with patch("app.modules.observability.health.get_supabase_public_client", return_value=fake_client):
            health_module._check_db_sync()

        self.assertEqual(fake_client.rpc_name, "mode_health_ping")

    def test_chat_trace_includes_prompt_version_and_cost_metrics(self):
        trace = ChatTrace(
            request_id="req-1",
            user_id="user-1",
            trainer_id="trainer-1",
            route="FAST_PATH",
            time_to_first_token_ms=42,
            total_response_ms=100,
            tokens_in=10,
            tokens_out=5,
            model_used="gpt-5.4-mini",
            prompt_version="system_v1+trainer_persona_v1+safety_rules_v1",
            model_fallback_chain=["openai:gpt-5.4-mini"],
            tokens_cost_usd=0.001,
        )

        with self.assertLogs("app.modules.observability.metrics", level="INFO") as logs:
            trace.log()

        joined = "\n".join(logs.output)
        self.assertIn('"name": "chat.ttft_ms"', joined)
        self.assertIn('"name": "llm.cost_usd"', joined)
        self.assertIn('"model": "gpt-5.4-mini"', joined)
        self.assertEqual(trace.prompt_version, "system_v1+trainer_persona_v1+safety_rules_v1")
        self.assertEqual(trace.tokens_cost_usd, 0.001)

    def test_chat_trace_accumulator_captures_phase_d_fields(self):
        trace = ChatTraceAccumulator(request_id="req-1", user_id="user-1", trainer_id="trainer-1")
        trace.observe_payload(
            {
                "type": "done",
                "token_usage": {"prompt_tokens": 11, "completion_tokens": 7},
                "_trace": {
                    "route": "DEEP_PATH",
                    "model_used": "gpt-5.4",
                    "prompt_version": "system_v1+trainer_persona_v1+safety_rules_v1",
                    "model_fallback_chain": ["openai:gpt-5.4"],
                    "tokens_cost_usd": 0.002,
                    "queue_enqueue_latency_ms": 3,
                },
            }
        )
        built = trace.build()

        self.assertEqual(built.prompt_version, "system_v1+trainer_persona_v1+safety_rules_v1")
        self.assertEqual(built.model_fallback_chain, ["openai:gpt-5.4"])
        self.assertEqual(built.tokens_cost_usd, 0.002)
        self.assertEqual(built.queue_enqueue_latency_ms, 3)

    def test_worker_trace_emitted_on_job_completion(self):
        job = IntelligenceJob(
            job_id="job-1",
            job_type="conversation_summarization",
            trainer_id="trainer-1",
            client_id="client-1",
            conversation_id="conversation-1",
            trace_id="trace-1",
            payload={},
        )
        repo = FakeJobRepository()

        with patch("app.modules.intelligence_jobs.handlers.get_supabase_admin_client", return_value=object()):
            with patch("app.modules.intelligence_jobs.handlers.IntelligenceJobRepository", return_value=repo):
                with patch("app.modules.intelligence_jobs.handlers._dispatch"):
                    with self.assertLogs("app.modules.observability.metrics", level="INFO") as logs:
                        run_intelligence_job(job.model_dump(mode="json"))

        self.assertEqual(repo.traces[-1]["status"], "success")
        joined = "\n".join(logs.output)
        self.assertIn('"name": "worker.job_success_rate"', joined)
        self.assertIn('"name": "worker.queue_lag_ms"', joined)

    def test_phase_d_metric_and_alert_contracts_are_configured(self):
        expected_metrics = {
            "chat.ttft_ms",
            "chat.total_ms",
            "router.latency_ms",
            "db.query_latency_ms",
            "worker.queue_lag_ms",
            "worker.job_success_rate",
            "worker.retry_rate",
            "worker.dead_letter_count",
            "llm.tokens_in",
            "llm.tokens_out",
            "llm.cost_usd",
            "llm.fallback_rate",
            "safety.escalation_rate",
            "safety.injection_detected_rate",
            "safety.trainer_review_pending_count",
            "llm.error_rate",
            "db.error_rate",
            "cache.miss_rate",
        }
        self.assertTrue(expected_metrics.issubset(PHASE_D_METRIC_NAMES))
        self.assertEqual(ALERT_THRESHOLDS["chat.ttft_ms"], {"warning": 2000, "critical": 4000, "aggregation": "p95"})
        self.assertEqual(ALERT_THRESHOLDS["worker.queue_lag_ms"], {"warning": 15000, "critical": 30000, "aggregation": "p95"})


if __name__ == "__main__":
    unittest.main()
