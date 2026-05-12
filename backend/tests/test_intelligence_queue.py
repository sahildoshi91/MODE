import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.tenancy import TrainerContext
from app.modules.account_deletion.service import AccountDeletionResult
from app.modules.conversation.schemas import ChatRequest
from app.modules.conversation.service import ConversationService
from app.modules.intelligence_jobs.handlers import run_intelligence_job
from app.modules.intelligence_jobs.queue import enqueue_post_chat_jobs
from app.modules.intelligence_jobs.schemas import EnqueueResult, IntelligenceJob, JOB_CONFIGS


class FakeJobRepository:
    def __init__(self, existing=None):
        self.existing = existing
        self.running = []
        self.retry = []
        self.success = []
        self.failed = []
        self.traces = []

    def get_job(self, job_id):
        del job_id
        return self.existing

    def mark_running(self, job, *, attempt_number):
        self.running.append((job.job_id, attempt_number))

    def mark_retry(self, job, *, attempt_number, error_category):
        self.retry.append((job.job_id, attempt_number, error_category))

    def mark_success(self, job, *, attempt_number):
        self.success.append((job.job_id, attempt_number))

    def mark_failed(self, job, *, attempt_number, error_category):
        self.failed.append((job.job_id, attempt_number, error_category))

    def record_worker_trace(self, trace_payload):
        self.traces.append(trace_payload)


class FakeDeletionRequestRepository:
    instances = []

    def __init__(self, supabase):
        del supabase
        self.running = []
        self.succeeded = []
        self.failed = []
        FakeDeletionRequestRepository.instances.append(self)

    def mark_running(self, *, request_id):
        self.running.append(request_id)

    def mark_succeeded(self, *, request_id, deletion_request_id, actor_role, deleted_record_counts):
        self.succeeded.append(
            {
                "request_id": request_id,
                "deletion_request_id": deletion_request_id,
                "actor_role": actor_role,
                "deleted_record_counts": deleted_record_counts,
            }
        )

    def mark_failed(self, *, request_id, error_category):
        self.failed.append({"request_id": request_id, "error_category": error_category})


def trainer_context():
    return TrainerContext(
        tenant_id="tenant-1",
        trainer_id="trainer-1",
        trainer_user_id="trainer-user-1",
        trainer_display_name="Coach Test",
        client_id="client-1",
        client_user_id="client-user-1",
    )


def intelligence_job(job_type="memory_write"):
    return IntelligenceJob(
        job_type=job_type,
        trainer_id="trainer-1",
        client_id="client-1",
        conversation_id="conversation-1",
        trace_id="trace-1",
        payload={"message_text": "I prefer morning workouts", "message_length": 26},
    )


class IntelligenceQueueTests(unittest.TestCase):
    def test_job_enqueued_after_chat_response(self):
        service = ConversationService.__new__(ConversationService)

        with patch(
            "app.modules.conversation.service.enqueue_post_chat_jobs",
            return_value=[EnqueueResult(ok=True, job_id="job-1", queue_name="mode:intelligence:normal")],
        ) as enqueue:
            service.persist_memory_after_response(
                trainer_context=trainer_context(),
                request=ChatRequest(message="I prefer morning workouts"),
                conversation_id="conversation-1",
            )

        enqueue.assert_called_once()
        self.assertTrue(enqueue.call_args.kwargs["include_memory"])
        self.assertEqual(enqueue.call_args.kwargs["trainer_id"], "trainer-1")
        self.assertEqual(enqueue.call_args.kwargs["client_id"], "client-1")

    def test_job_not_blocking_sse_stream(self):
        started_at = time.perf_counter()

        with patch("app.modules.intelligence_jobs.queue.settings.redis_url", None):
            results = enqueue_post_chat_jobs(
                trainer_id="trainer-1",
                client_id="client-1",
                conversation_id="conversation-1",
                trace_id="trace-1",
                message_text="I prefer morning workouts",
            )

        self.assertLess((time.perf_counter() - started_at) * 1000, 50)
        self.assertGreaterEqual(len(results), 1)
        self.assertTrue(all(result.error_category == "redis_url_missing" for result in results))

    def test_failed_job_retries_with_backoff(self):
        job = intelligence_job()
        repo = FakeJobRepository(existing={"status": "queued", "attempt_count": 0})

        with patch("app.modules.intelligence_jobs.handlers.get_supabase_admin_client", return_value=object()):
            with patch("app.modules.intelligence_jobs.handlers.IntelligenceJobRepository", return_value=repo):
                with patch("app.modules.intelligence_jobs.handlers._dispatch", side_effect=RuntimeError("boom")):
                    with self.assertRaises(RuntimeError):
                        run_intelligence_job(job.model_dump(mode="json"))

        self.assertEqual(JOB_CONFIGS["memory_write"].max_attempts, 3)
        self.assertEqual(JOB_CONFIGS["memory_write"].retry_intervals_seconds, (2, 10))
        self.assertEqual(repo.retry, [(job.job_id, 1, "RuntimeError")])
        self.assertEqual(repo.traces[-1]["status"], "retry")

    def test_job_idempotency_duplicate_ignored(self):
        job = intelligence_job()
        repo = FakeJobRepository(existing={"status": "success", "attempt_count": 1})

        with patch("app.modules.intelligence_jobs.handlers.get_supabase_admin_client", return_value=object()):
            with patch("app.modules.intelligence_jobs.handlers.IntelligenceJobRepository", return_value=repo):
                with patch("app.modules.intelligence_jobs.handlers._dispatch") as dispatch:
                    run_intelligence_job(job.model_dump(mode="json"))

        dispatch.assert_not_called()
        self.assertFalse(repo.running)
        self.assertEqual(repo.traces[-1]["status"], "success")

    def test_memory_write_failure_does_not_surface_to_user(self):
        with patch("app.modules.intelligence_jobs.queue.settings.redis_url", None):
            results = enqueue_post_chat_jobs(
                trainer_id="trainer-1",
                client_id="client-1",
                conversation_id="conversation-1",
                trace_id="trace-1",
                message_text="I prefer morning workouts",
            )

        self.assertTrue(results)
        self.assertTrue(all(not result.ok for result in results))

    def test_safety_flag_job_survives_process_restart(self):
        job = intelligence_job("safety_flag_persistence")
        job.payload = {
            "route_flow": "safety_escalation",
            "route_reason": "pain language detected",
            "risk_flags": ["pain_language"],
        }

        restored = IntelligenceJob.model_validate_json(job.model_dump_json())

        self.assertEqual(restored.job_id, job.job_id)
        self.assertEqual(restored.job_type, "safety_flag_persistence")
        self.assertEqual(restored.payload["risk_flags"], ["pain_language"])
        self.assertEqual(JOB_CONFIGS["safety_flag_persistence"].max_attempts, 5)

    def test_account_deletion_worker_executes_idempotent_job_and_records_success(self):
        job = IntelligenceJob(
            job_type="account_deletion",
            trainer_id="",
            client_id="",
            conversation_id="delete-request-1",
            trace_id="trace-delete-1",
            payload={"request_id": "delete-request-1", "user_id": "user-123"},
        )
        repo = FakeJobRepository(existing={"status": "queued", "attempt_count": 0})
        service_calls = []
        FakeDeletionRequestRepository.instances = []

        class FakeAccountDeletionService:
            CONFIRMATION_TOKEN = "DELETE"

            def __init__(self, repository, atlas_trainer_deletion_observer=None):
                del repository, atlas_trainer_deletion_observer

            def delete_account(self, *, user, confirmation):
                service_calls.append((user.id, user.email, confirmation))
                return AccountDeletionResult(
                    deletion_request_id="service-delete-1",
                    outcome="succeeded",
                    actor_role="client",
                    deleted_record_counts={"clients": 1},
                )

        with patch("app.modules.intelligence_jobs.handlers.get_supabase_admin_client", return_value=object()):
            with patch("app.modules.intelligence_jobs.handlers.IntelligenceJobRepository", return_value=repo):
                with patch(
                    "app.modules.intelligence_jobs.handlers.AccountDeletionRequestRepository",
                    FakeDeletionRequestRepository,
                ):
                    with patch("app.modules.intelligence_jobs.handlers.AccountDeletionService", FakeAccountDeletionService):
                        run_intelligence_job(job.model_dump(mode="json"))

        request_repo = FakeDeletionRequestRepository.instances[0]
        self.assertEqual(service_calls, [("user-123", None, "DELETE")])
        self.assertEqual(request_repo.running, ["delete-request-1"])
        self.assertEqual(request_repo.succeeded[0]["request_id"], "delete-request-1")
        self.assertEqual(request_repo.succeeded[0]["deleted_record_counts"], {"clients": 1})
        self.assertEqual(request_repo.failed, [])
        self.assertEqual(repo.success, [(job.job_id, 1)])
        self.assertEqual(repo.traces[-1]["status"], "success")


if __name__ == "__main__":
    unittest.main()
