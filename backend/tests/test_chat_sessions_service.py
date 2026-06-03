import os
import re
import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core.tenancy import TrainerContext
from app.modules.chat_sessions.schemas import ChatSessionSendRequest, ChatSessionTodayRequest
from app.modules.chat_sessions.service import ChatSessionService
from app.modules.conversation.schemas import ChatResponse, ConversationState, TokenUsage


USER_ID = "00000000-0000-0000-0000-000000000001"
OTHER_USER_ID = "00000000-0000-0000-0000-000000000099"
TRAINER_ID = "10000000-0000-0000-0000-000000000001"
CLIENT_ID = "20000000-0000-0000-0000-000000000001"
CLIENT_USER_ID = USER_ID
TODAY = date.today()


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?", text))


def flag_review_briefs(text: str) -> list[str]:
    return [
        part.strip()
        for part in re.split(r"\n\n(?=[^\n]+ \u2014 (?:Low|Medium|High)\n\nMain issue:)", text.strip())
        if re.match(r"^[^\n]+ \u2014 (?:Low|Medium|High)\n\nMain issue:", part.strip())
    ]


def dynamic_checkin_response() -> dict:
    return {
        "mode": "BUILD",
        "total_score": 20,
        "template_version": "daily_checkin_response_v1",
        "sections": [
            {
                "id": "opening",
                "label": None,
                "content": "Build day - 20/25. Your readiness is solid, with motivation doing the heavy lifting.",
            },
            {
                "id": "workout",
                "label": "Today's workout",
                "content": "Do three steady strength rounds at a pace where your last two reps stay clean.",
            },
            {
                "id": "nutrition",
                "label": "Before you train",
                "content": "Have Greek yogurt with berries or eggs and toast, then keep water nearby.",
            },
            {
                "id": "why",
                "label": "Your why",
                "content": "Today's controlled work is another deposit toward feeling capable with your family.",
            },
            {
                "id": "question",
                "label": None,
                "content": "Which lift do you want to anchor today's session around?",
            },
        ],
        "signal_classification": {
            "signals": {
                "sleep": "high",
                "stress": "neutral",
                "body": "high",
                "nutrition": "neutral",
                "motivation": "high",
            },
            "standout_low": "stress",
            "standout_low_score": 3,
            "contrast_pair": None,
            "all_neutral": False,
        },
        "generated_at": "2026-05-30T16:00:00+00:00",
        "model_used": "gpt-5.4-mini",
        "tokens_used": {"input": 120, "output": 80, "total": 200},
    }


class FakeChatSessionRepository:
    def __init__(self):
        self.sessions = []
        self.messages = {}
        self.today_checkin = {
            "id": "checkin-1",
            "date": TODAY.isoformat(),
            "total_score": 20,
            "assigned_mode": "BUILD",
            "inputs": {"sleep": 4, "stress": 3, "soreness": 4, "nutrition": 3, "motivation": 5},
        }
        self.clients = {
            CLIENT_ID: {
                "id": CLIENT_ID,
                "tenant_id": "tenant-1",
                "user_id": CLIENT_USER_ID,
                "client_name": "Taylor",
                "assigned_trainer_id": TRAINER_ID,
            },
        }
        self.active_trainers = [
            {
                "id": "trainer-test",
                "tenant_id": "tenant-1",
                "user_id": "trainer-user-test",
                "display_name": "Test Trainer",
                "status": "active",
                "email": "test.trainer@example.com",
            },
        ]
        self.connection_requests = []
        self.profile = {
            "primary_goal": "lean out and feel more in control",
            "user_why": None,
        }
        self.update_message_calls = []
        self.race_update_message_id = None
        self.race_latest_message = None

    def get_session(self, session_id):
        return next((row for row in self.sessions if row["id"] == session_id), None)

    def find_session(self, *, user_id, trainer_id, client_id, role, session_type, session_date):
        for row in self.sessions:
            if (
                row["user_id"] == user_id
                and row["trainer_id"] == trainer_id
                and row.get("client_id") == client_id
                and row["role"] == role
                and row["session_type"] == session_type
                and row["session_date"] == session_date.isoformat()
            ):
                return row
        return None

    def create_session(self, **payload):
        row = {
            **payload,
            "id": f"session-{len(self.sessions) + 1}",
            "session_date": payload["session_date"].isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "last_message_at": None,
            "summary": payload.get("summary"),
            "title": payload.get("title"),
            "metadata": payload.get("metadata") or {},
        }
        self.sessions.append(row)
        self.messages[row["id"]] = []
        return row

    def update_session(self, session_id, fields):
        row = self.get_session(session_id)
        if not row:
            return None
        row.update(fields)
        row["updated_at"] = datetime.now(timezone.utc).isoformat()
        return row

    def archive_older_sessions(self, *, user_id, trainer_id, client_id, role, session_type, before_date):
        for row in self.sessions:
            if (
                row["user_id"] == user_id
                and row["trainer_id"] == trainer_id
                and row.get("client_id") == client_id
                and row["role"] == role
                and row["session_type"] == session_type
                and date.fromisoformat(row["session_date"]) < before_date
            ):
                metadata = row.get("metadata") or {}
                row["metadata"] = {
                    **metadata,
                    "archived_at": "2026-05-04T00:00:00+00:00",
                }

    def list_sessions(self, *, user_id, trainer_id, role, session_type=None, limit=80, offset=0):
        rows = [
            row for row in self.sessions
            if row["user_id"] == user_id and row["trainer_id"] == trainer_id and row["role"] == role
        ]
        if session_type:
            rows = [row for row in rows if row["session_type"] == session_type]
        return rows[offset:offset + limit]

    def list_messages(self, session_id, limit=200, offset=0):
        return list(self.messages.get(session_id, []))[offset:offset + limit]

    def get_opening_summary_message(self, session_id):
        return next(
            (
                row for row in self.messages.get(session_id, [])
                if (row.get("metadata") or {}).get("auto_generated_opening_summary")
            ),
            None,
        )

    def update_opening_summary_message(
        self,
        *,
        session_id,
        content,
        metadata,
        expected_content=None,
        expected_metadata=None,
    ):
        row = self.get_opening_summary_message(session_id)
        if not row:
            return None
        if expected_content is not None and row.get("content") != expected_content:
            return None
        if expected_metadata is not None and (row.get("metadata") or {}) != expected_metadata:
            return None
        row["content"] = content
        row["metadata"] = metadata or {}
        return row

    def get_first_assistant_message(self, session_id):
        return next(
            (row for row in self.messages.get(session_id, []) if row.get("sender_type") == "ai"),
            None,
        )

    def update_message_by_id(
        self,
        *,
        message_id,
        content,
        metadata,
        expected_content=None,
        expected_metadata=None,
    ):
        self.update_message_calls.append({
            "message_id": message_id,
            "content": content,
            "metadata": metadata,
            "expected_content": expected_content,
            "expected_metadata": expected_metadata,
        })
        for session_messages in self.messages.values():
            for row in session_messages:
                if row.get("id") == message_id:
                    if self.race_update_message_id == message_id:
                        if self.race_latest_message:
                            row.update(self.race_latest_message)
                        return None
                    if expected_content is not None and row.get("content") != expected_content:
                        return None
                    if expected_metadata is not None and (row.get("metadata") or {}) != expected_metadata:
                        return None
                    row["content"] = content
                    row["metadata"] = metadata or {}
                    return row
        return None

    def append_message(self, *, session_id, sender_type, content, metadata=None):
        rows = self.messages.setdefault(session_id, [])
        row = {
            "id": f"message-{session_id}-{len(rows) + 1}",
            "session_id": session_id,
            "sender_type": sender_type,
            "content": content,
            "message_index": len(rows),
            "metadata": metadata or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        rows.append(row)
        session = self.get_session(session_id)
        if session:
            session["last_message_at"] = row["created_at"]
        return row

    def get_client_for_trainer(self, *, trainer_id, client_id):
        row = self.clients.get(client_id)
        if row and row.get("assigned_trainer_id") == trainer_id:
            return row
        return None

    def get_client_by_id(self, client_id):
        row = self.clients.get(client_id)
        return dict(row) if row else None

    def get_client_names(self, *, trainer_id, client_ids):
        del trainer_id
        return {client_id: self.clients[client_id]["client_name"] for client_id in client_ids if client_id in self.clients}

    def list_active_trainers_for_tenant(self, tenant_id):
        return [
            dict(row)
            for row in self.active_trainers
            if row.get("tenant_id") == tenant_id and row.get("status") == "active"
        ]

    def find_pending_connection_request(self, *, client_id, trainer_id):
        return next(
            (
                dict(row) for row in self.connection_requests
                if row["client_id"] == client_id
                and row["trainer_id"] == trainer_id
                and row["status"] == "pending"
            ),
            None,
        )

    def create_connection_request(self, payload):
        row = {
            "id": f"connection-request-{len(self.connection_requests) + 1}",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        self.connection_requests.append(row)
        return dict(row)

    def get_profile(self, client_id):
        del client_id
        return dict(self.profile)

    def get_checkin_by_date(self, client_id, session_date):
        del client_id, session_date
        return self.today_checkin

    def list_recent_checkins(self, client_id, *, end_date, limit=7):
        del client_id, end_date, limit
        return []

    def list_client_memory(self, *, trainer_id, client_id, limit=20):
        del trainer_id, client_id, limit
        return []

    def count_completed_workouts(self, *, user_id, start_date, end_date):
        del user_id, start_date, end_date
        return 0


class FakeConversationService:
    def __init__(self):
        self.handle_chat_calls = []
        self.stream_chat_calls = []

    def handle_chat(self, user_id, trainer_context, request):
        self.handle_chat_calls.append((user_id, trainer_context, request))
        return ChatResponse(
            conversation_id="legacy-conversation-1",
            assistant_message="Here is the next best step.",
            conversation_state=ConversationState(current_stage="default_fast"),
            token_usage=TokenUsage(total_tokens=12),
        )

    def stream_chat(self, user_id, trainer_context, request):
        self.stream_chat_calls.append((user_id, trainer_context, request))
        return "legacy-conversation-1", ["Here is the next best step."], {}, None


class FakeDailyCheckinService:
    def __init__(self, response=None):
        self.response = response
        self.calls = []

    def ensure_checkin_response(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


class FakeOpenAIClient:
    def __init__(self):
        self.calls = []

    def create_chat_completion_with_usage(self, model, messages):
        self.calls.append({"model": model, "messages": messages})
        return SimpleNamespace(
            text=(
                '{"priority":"High","primary_issue_type":"adherence_collapse",'
                '"main_issue":"Readiness is the main risk today",'
                '"why_it_matters":"Fatigue can turn a hard session into a setback",'
                '"next_action":"Scale the plan and check the blocker",'
                '"metrics_summary":["readiness is poor","motivation is low"],'
                '"client_message":"Let us adjust today and pick one easy win"}'
            )
        )


class FakeInvalidOpenAIClient(FakeOpenAIClient):
    def create_chat_completion_with_usage(self, model, messages):
        self.calls.append({"model": model, "messages": messages})
        return SimpleNamespace(
            text=(
                '{"priority":"High","primary_issue_type":"adherence_collapse",'
                '"main_issue":"Motivation avg 1/5 is too low",'
                '"why_it_matters":"Raw score strings should not pass",'
                '"next_action":"Review every metric and date",'
                '"metrics_summary":["Motivation avg 1/5 on 2026-05-09"],'
                '"client_message":"Send all the details"}'
            )
        )


def client_context(user_id=USER_ID):
    return TrainerContext(
        tenant_id="tenant-1",
        trainer_id=TRAINER_ID,
        trainer_user_id="trainer-user-1",
        trainer_display_name="Coach",
        client_id=CLIENT_ID,
        client_user_id=user_id,
    )


def unassigned_client_context(user_id=USER_ID):
    return TrainerContext(
        tenant_id="tenant-1",
        trainer_id=None,
        trainer_user_id=None,
        trainer_display_name=None,
        client_id=CLIENT_ID,
        client_user_id=user_id,
    )


def trainer_context(user_id=USER_ID):
    return TrainerContext(
        tenant_id="tenant-1",
        trainer_id=TRAINER_ID,
        trainer_user_id=user_id,
        trainer_display_name="Coach",
        client_id=None,
        client_user_id=None,
        trainer_onboarding_completed=True,
    )


class FakeTrainerHomeService:
    def __init__(self):
        self.totals = SimpleNamespace(
            assigned_clients=1,
            scheduled_today=0,
            checkins_completed_today=1,
            today_missing_checkins=0,
            recent_missed_checkin_days=3,
            clients_with_recent_missed_checkins=1,
            clients_with_low_7d_readiness=0,
            clients_with_recent_low_readiness=1,
            high_priority_clients=1,
            critical_priority_clients=0,
        )
        self.clients = [
            SimpleNamespace(
                client_id=CLIENT_ID,
                client_name="Taylor",
                priority_score=9.25,
                priority_tier="high",
                risk_flags=[
                    SimpleNamespace(
                        code="low_motivation_7d",
                        label="Low Motivation",
                        severity="high",
                        detail="Motivation averaged 1.0/5 across 1 check-ins in the last 7 days.",
                    ),
                    SimpleNamespace(
                        code="low_7d_readiness",
                        label="Low 7-Day Readiness",
                        severity="high",
                        detail="Average readiness is 12.0/25 over the last 7 days.",
                    ),
                ],
                week_summary=SimpleNamespace(
                    checkins_completed_7d=1,
                    checkins_completed_today=True,
                    avg_score_7d=12.0,
                    workouts_completed_7d=0,
                    missed_checkin_dates_7d=[date(2026, 5, 8), date(2026, 5, 7), date(2026, 5, 2)],
                    recent_low_readiness_dates=[date(2026, 5, 9), date(2026, 5, 5)],
                    question_summaries=[
                        SimpleNamespace(
                            key="motivation",
                            label="Motivation",
                            average_7d=1.0,
                            responses_7d=1,
                            low_days_7d=1,
                            latest_score=1,
                            latest_date=date(2026, 5, 9),
                            status="low",
                            daily_responses=[
                                SimpleNamespace(date=date(2026, 5, 9), score=1),
                                SimpleNamespace(date=date(2026, 5, 8), score=None),
                            ],
                        ),
                        SimpleNamespace(
                            key="sleep",
                            label="Sleep",
                            average_7d=2.0,
                            responses_7d=1,
                            low_days_7d=1,
                            latest_score=2,
                            latest_date=date(2026, 5, 9),
                            status="low",
                            daily_responses=[
                                SimpleNamespace(date=date(2026, 5, 9), score=2),
                            ],
                        ),
                    ],
                ),
                missed_checkin_dates_7d=[date(2026, 5, 8), date(2026, 5, 7), date(2026, 5, 2)],
                recent_low_readiness_dates=[date(2026, 5, 9), date(2026, 5, 5)],
            )
        ]

    def build_command_center(self, trainer_context, target_date):
        del trainer_context, target_date
        return SimpleNamespace(totals=self.totals, clients=self.clients)


class ChatSessionServiceTests(unittest.TestCase):
    def setUp(self):
        self.repository = FakeChatSessionRepository()
        self.conversation_service = FakeConversationService()
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
        )
        self.service._today = lambda: TODAY

    def test_today_session_is_reused_and_opening_summary_inserts_once(self):
        request = ChatSessionTodayRequest(
            role="client",
            session_type="client_chat",
            session_date=TODAY,
        )

        first = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )
        second = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )

        self.assertEqual(first.session.id, second.session.id)
        self.assertEqual(len(self.repository.sessions), 1)
        self.assertEqual(len(self.repository.messages[first.session.id]), 1)
        opening = self.repository.messages[first.session.id][0]
        self.assertEqual(opening["message_index"], 0)
        self.assertTrue(opening["metadata"]["auto_generated_opening_summary"])

    def test_client_opening_summary_uses_degraded_fallback_without_structured_response(self):
        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertEqual(opening.metadata["summary_source"], "client_daily_checkin_response_degraded_v1")
        self.assertEqual(opening.metadata["template_version"], "daily_checkin_response_v1")
        self.assertTrue(opening.metadata["degraded_opening_summary"])
        self.assertIn("Coach brief is still generating.", opening.content)
        self.assertIn("structured opening could not be refreshed", opening.content)
        self.assertIn("20/25", opening.content)
        self.assertNotIn("Stable readiness.", opening.content)
        self.assertNotIn("\nTraining:", opening.content)
        self.assertIn("Build me a training routine", response.suggested_actions)
        self.assertIn("Build me a nutrition plan", response.suggested_actions)
        self.assertEqual(response.session.client_name, "Taylor")

    def test_client_opening_summary_prefers_persisted_checkin_response_sections(self):
        self.repository.today_checkin["checkin_response"] = dynamic_checkin_response()
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertEqual(opening.metadata["summary_source"], "client_daily_checkin_response_v1")
        self.assertEqual(opening.metadata["template_version"], "daily_checkin_response_v1")
        self.assertEqual(opening.metadata["checkin_response"]["template_version"], "daily_checkin_response_v1")
        self.assertEqual(opening.metadata["checkin_response_generated_at"], "2026-05-30T16:00:00+00:00")
        self.assertEqual(opening.metadata["model_used"], "gpt-5.4-mini")
        self.assertEqual(opening.metadata["checkin_id"], "checkin-1")
        self.assertEqual(opening.metadata["checkin_response"]["sections"][1]["id"], "workout")
        self.assertIn("Build day - 20/25", opening.content)
        self.assertIn("Today's workout: Do three steady strength rounds", opening.content)
        self.assertIn("Which lift do you want to anchor today's session around?", opening.content)
        self.assertNotIn("Stable readiness.", opening.content)
        self.assertNotIn("Training: 30-45 min", opening.content)
        self.assertEqual(daily_checkin_service.calls, [])

    def test_client_opening_summary_backfills_missing_checkin_response_once(self):
        self.repository.today_checkin["checkin_response"] = None
        self.repository.today_checkin["checkin_response_attempted"] = False
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertEqual(len(daily_checkin_service.calls), 1)
        self.assertEqual(daily_checkin_service.calls[0]["client_id"], CLIENT_ID)
        self.assertEqual(daily_checkin_service.calls[0]["record"]["id"], "checkin-1")
        self.assertEqual(opening.metadata["summary_source"], "client_daily_checkin_response_v1")
        self.assertTrue(opening.metadata["checkin_response_attempted"])
        self.assertIn("Build day - 20/25", opening.content)
        self.assertNotIn("Stable readiness.", opening.content)

    def test_client_opening_summary_backfills_even_when_attempted(self):
        self.repository.today_checkin["checkin_response"] = None
        self.repository.today_checkin["checkin_response_attempted"] = True
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertEqual(len(daily_checkin_service.calls), 1)
        self.assertEqual(opening.metadata["summary_source"], "client_daily_checkin_response_v1")
        self.assertTrue(opening.metadata["checkin_response_attempted"])
        self.assertIn("Build day - 20/25", opening.content)
        self.assertNotIn("Stable readiness.", opening.content)

    def test_client_opening_summary_refreshes_malformed_checkin_response(self):
        malformed = dynamic_checkin_response()
        malformed["sections"] = malformed["sections"][:2]
        self.repository.today_checkin["checkin_response"] = malformed
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertEqual(len(daily_checkin_service.calls), 1)
        self.assertEqual(opening.metadata["summary_source"], "client_daily_checkin_response_v1")
        self.assertIn("checkin_response", opening.metadata)
        self.assertIn("Build day - 20/25", opening.content)
        self.assertNotIn("Training: 30-45 min", opening.content)

    def test_client_opening_summary_metadata_tracks_user_why_when_degraded(self):
        self.repository.profile["user_why"] = "Dance until I am 100 and never tell my kids I am tired."

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertEqual(opening.metadata["summary_source"], "client_daily_checkin_response_degraded_v1")
        self.assertNotIn("Mindset: Build momentum with disciplined reps.", opening.content)
        self.assertTrue(response.messages[0].metadata["has_user_why"])

    def test_client_mode_brief_word_cap_applies_to_all_modes(self):
        for mode in ["BEAST", "BUILD", "RECOVER", "REST"]:
            with self.subTest(mode=mode):
                text = self.service._build_client_mode_brief({
                    "id": f"checkin-{mode.lower()}",
                    "date": TODAY.isoformat(),
                    "total_score": 20,
                    "assigned_mode": mode,
                    "inputs": {"sleep": 4, "stress": 3, "soreness": 4, "nutrition": 3, "motivation": 5},
                })
                self.assertLessEqual(len(text.split()), 75)
                for label in [f"{mode} MODE", "\nTraining:", "\nNutrition:", "\nMindset:"]:
                    self.assertIn(label, text)
                self.assertNotIn("Build Today:", text)
                self.assertIn("What do you want to achieve today?", text)

    def test_client_mode_brief_normalizes_legacy_color_modes(self):
        text = self.service._build_client_mode_brief({
            "id": "checkin-yellow",
            "date": TODAY.isoformat(),
            "total_score": 20,
            "assigned_mode": "YELLOW",
            "inputs": {"sleep": 4, "stress": 3, "soreness": 4, "nutrition": 3, "motivation": 5},
        })

        self.assertIn("BUILD MODE", text)
        self.assertNotIn("YELLOW", text)

    def test_client_opening_summary_does_not_fake_mode_without_checkin(self):
        self.repository.today_checkin = None

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        opening = response.messages[0].content
        self.assertTrue(opening.startswith("Hey Taylor, I do not have today's MODE yet."))
        self.assertNotIn("current MODE is BUILD", opening)
        self.assertNotIn("Build me a training routine", response.suggested_actions)
        self.assertNotIn("Build me a nutrition plan", response.suggested_actions)

    def test_client_opening_summary_refreshes_after_checkin_completion(self):
        self.repository.today_checkin = None
        request = ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY)

        first = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )
        self.assertIn("do not have today's MODE yet", first.messages[0].content)

        self.repository.today_checkin = {
            "id": "checkin-2",
            "date": TODAY.isoformat(),
            "total_score": 20,
            "assigned_mode": "BUILD",
            "inputs": {"sleep": 4, "stress": 3, "soreness": 4, "nutrition": 3, "motivation": 5},
        }
        second = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )

        self.assertEqual(first.session.id, second.session.id)
        self.assertEqual(len(self.repository.messages[first.session.id]), 1)
        self.assertIn("Coach brief is still generating.", second.messages[0].content)
        self.assertEqual(second.messages[0].metadata["summary_source"], "client_daily_checkin_response_degraded_v1")
        self.assertEqual(second.messages[0].metadata["checkin_id"], "checkin-2")

    def test_client_opening_summary_refreshes_degraded_message_when_checkin_response_arrives(self):
        request = ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY)
        first = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )
        self.assertEqual(first.messages[0].metadata["summary_source"], "client_daily_checkin_response_degraded_v1")
        self.assertIn("Coach brief is still generating.", first.messages[0].content)

        self.repository.today_checkin["checkin_response"] = dynamic_checkin_response()
        second = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )

        self.assertEqual(first.session.id, second.session.id)
        self.assertEqual(len(self.repository.messages[first.session.id]), 1)
        self.assertEqual(second.messages[0].metadata["summary_source"], "client_daily_checkin_response_v1")
        self.assertEqual(second.messages[0].metadata["checkin_response"]["sections"][0]["id"], "opening")
        self.assertIn("Build day - 20/25", second.messages[0].content)
        self.assertNotIn("Coach brief is still generating.", second.messages[0].content)

    def test_client_opening_summary_refreshes_legacy_mode_brief_row_on_load(self):
        request = ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY)
        first = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )
        existing = self.repository.messages[first.session.id][0]
        existing["content"] = (
            "BUILD MODE\n"
            "20/25. Stable readiness.\n"
            "Training: 30-45 min, Moderate, controlled strength.\n"
            "Nutrition: Protein each meal.\n"
            "Mindset: Build momentum.\n\n"
            "What do you want to achieve today?"
        )
        existing["metadata"] = {
            "auto_generated_opening_summary": True,
            "summary_source": "client_daily_mode_brief_v1",
            "suggested_action_chips": ["Old chip"],
        }

        self.repository.today_checkin["checkin_response"] = dynamic_checkin_response()
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        second = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )

        self.assertEqual(first.session.id, second.session.id)
        self.assertEqual(len(self.repository.messages[first.session.id]), 1)
        self.assertEqual(second.messages[0].metadata["summary_source"], "client_daily_checkin_response_v1")
        self.assertEqual(second.messages[0].metadata["template_version"], "daily_checkin_response_v1")
        self.assertIn("Build day - 20/25", second.messages[0].content)
        self.assertNotIn("Stable readiness.", second.messages[0].content)

    def test_client_opening_summary_regenerates_version_mismatch(self):
        stale_response = dynamic_checkin_response()
        stale_response["template_version"] = "daily_checkin_response_v0"
        self.repository.today_checkin["checkin_response"] = stale_response
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertEqual(len(daily_checkin_service.calls), 1)
        self.assertEqual(opening.metadata["summary_source"], "client_daily_checkin_response_v1")
        self.assertEqual(opening.metadata["template_version"], "daily_checkin_response_v1")
        self.assertEqual(opening.metadata["checkin_response"]["template_version"], "daily_checkin_response_v1")

    def test_client_opening_summary_refetches_latest_after_refresh_race(self):
        request = ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY)
        first = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )
        existing = self.repository.messages[first.session.id][0]
        repaired_response = dynamic_checkin_response()
        repaired_response = {
            "mode": repaired_response["mode"],
            "total_score": repaired_response["total_score"],
            "template_version": repaired_response["template_version"],
            "sections": repaired_response["sections"],
            "generated_at": repaired_response["generated_at"],
            "model_used": repaired_response["model_used"],
        }
        latest = {
            "content": "Already repaired elsewhere.",
            "metadata": {
                "auto_generated_opening_summary": True,
                "summary_source": "client_daily_checkin_response_v1",
                "template_version": "daily_checkin_response_v1",
                "checkin_id": "checkin-1",
                "checkin_date": TODAY.isoformat(),
                "assigned_mode": "BUILD",
                "checkin_score": 20,
                "has_checkin": True,
                "has_user_why": False,
                "checkin_response_attempted": False,
                "checkin_response": repaired_response,
                "checkin_response_generated_at": "2026-05-30T16:00:00+00:00",
                "model_used": "gpt-5.4-mini",
            },
        }
        self.repository.race_update_message_id = existing["id"]
        self.repository.race_latest_message = latest
        self.repository.today_checkin["checkin_response"] = dynamic_checkin_response()
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        second = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )

        self.assertEqual(second.messages[0].content, "Already repaired elsewhere.")
        self.assertEqual(second.messages[0].metadata["summary_source"], "client_daily_checkin_response_v1")

    def test_client_opening_summary_degrades_when_generation_fails(self):
        class BrokenDailyCheckinService:
            def __init__(self):
                self.calls = []

            def ensure_checkin_response(self, **kwargs):
                self.calls.append(kwargs)
                raise RuntimeError("generation unavailable")

        self.repository.today_checkin["checkin_response"] = None
        daily_checkin_service = BrokenDailyCheckinService()
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertEqual(len(daily_checkin_service.calls), 1)
        self.assertEqual(opening.metadata["summary_source"], "client_daily_checkin_response_degraded_v1")
        self.assertTrue(opening.metadata["degraded_opening_summary"])
        self.assertIn("Coach brief is still generating.", opening.content)
        self.assertNotIn("Stable readiness.", opening.content)

    def test_client_opening_summary_does_not_replace_valid_structured_opening_with_degraded(self):
        request = ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY)
        self.repository.today_checkin["checkin_response"] = dynamic_checkin_response()
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY
        first = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )
        self.assertEqual(first.messages[0].metadata["summary_source"], "client_daily_checkin_response_v1")

        self.repository.today_checkin["checkin_response"] = None
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=FakeDailyCheckinService(response=None),
        )
        self.service._today = lambda: TODAY
        second = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )

        self.assertEqual(second.messages[0].metadata["summary_source"], "client_daily_checkin_response_v1")
        self.assertIn("Build day - 20/25", second.messages[0].content)
        self.assertNotIn("Coach brief is still generating.", second.messages[0].content)

    def test_client_opening_summary_does_not_refresh_for_chips_only(self):
        request = ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY)
        self.repository.today_checkin["checkin_response"] = dynamic_checkin_response()
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY
        first = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )
        existing = self.repository.messages[first.session.id][0]
        existing["metadata"] = {
            **existing["metadata"],
            "suggested_action_chips": ["Old chip"],
        }
        update_count = len(self.repository.update_message_calls)

        second = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )

        self.assertEqual(len(self.repository.update_message_calls), update_count)
        self.assertEqual(second.messages[0].metadata["suggested_action_chips"], ["Old chip"])

    def test_trainer_opening_summary_uses_recent_missed_and_low_readiness_counts(self):
        self.service = ChatSessionService(
            self.repository,
            conversation_service=FakeConversationService(),
            trainer_home_service=FakeTrainerHomeService(),
        )
        self.service._today = lambda: TODAY

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            request=ChatSessionTodayRequest(role="trainer", session_type="coach_ai", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertIn("You have 1 client on the board.", opening.content)
        self.assertIn("1 client missed 3 check-in days across the previous 7 days", opening.content)
        self.assertIn("0 missing today", opening.content)
        self.assertIn("0 clients have low 7-day readiness averages", opening.content)
        self.assertIn("1 client has recent low-readiness days", opening.content)
        self.assertEqual(opening.metadata["summary_source"], "trainer_command_center_v2")
        self.assertEqual(opening.metadata["recent_missed_checkin_days"], 3)
        self.assertEqual(opening.metadata["today_missing_checkins"], 0)
        self.assertEqual(opening.metadata["clients_with_recent_low_readiness"], 1)
        self.assertTrue(opening.metadata["analytics_fingerprint"])

    def test_trainer_opening_summary_refreshes_v1_metadata_to_v2(self):
        self.service = ChatSessionService(
            self.repository,
            conversation_service=FakeConversationService(),
            trainer_home_service=FakeTrainerHomeService(),
        )
        self.service._today = lambda: TODAY
        request = ChatSessionTodayRequest(role="trainer", session_type="coach_ai", session_date=TODAY)

        first = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            request=request,
        )
        existing = self.repository.messages[first.session.id][0]
        existing["content"] = (
            "You have 1 clients on the board today, with 0 missed check-ins and 0 showing low recovery patterns."
        )
        existing["metadata"] = {
            "auto_generated_opening_summary": True,
            "summary_source": "trainer_command_center_v1",
            "suggested_action_chips": [
                "Review flagged clients",
                "Draft check-in",
                "Show priorities",
                "Review missed clients",
            ],
        }

        second = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            request=request,
        )

        self.assertEqual(first.session.id, second.session.id)
        self.assertEqual(len(self.repository.messages[first.session.id]), 1)
        self.assertEqual(second.messages[0].metadata["summary_source"], "trainer_command_center_v2")
        self.assertEqual(second.messages[0].metadata["recent_missed_checkin_days"], 3)
        self.assertIn("Recent adherence", second.messages[0].content)

    def test_trainer_flag_review_uses_command_center_instead_of_generic_chat(self):
        conversation_service = FakeConversationService()
        self.service = ChatSessionService(
            self.repository,
            conversation_service=conversation_service,
            trainer_home_service=FakeTrainerHomeService(),
        )
        self.service._today = lambda: TODAY
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            request=ChatSessionTodayRequest(role="trainer", session_type="coach_ai", session_date=TODAY),
        )

        response = self.service.send_message(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="Review flagged clients"),
        )

        self.assertEqual(conversation_service.handle_chat_calls, [])
        content = response.ai_message.content
        briefs = flag_review_briefs(content)
        self.assertEqual(len(briefs), 1)
        brief = briefs[0]
        self.assertIn("Taylor \u2014 High", brief)
        self.assertEqual(brief.count("Taylor"), 1)
        self.assertIn("Main issue:\nAdherence is breaking down", brief)
        self.assertIn("Why it matters:\nLow motivation plus missed training", brief)
        self.assertIn("Next action:\nRemove friction", brief)
        self.assertIn("Message to client:\nWhat is blocking workouts right now?", brief)
        self.assertEqual(brief.count("Main issue:"), 1)
        self.assertEqual(brief.count("Next action:"), 1)
        self.assertEqual(brief.count("Message to client:"), 1)
        self.assertLessEqual(word_count(brief), 75)
        self.assertNotRegex(brief, r"\d{4}-\d{2}-\d{2}")
        self.assertNotRegex(brief, r"\bavg\b|/\d{1,2}\b|\baverage\b")
        self.assertNotIn("Weak scores:", brief)
        self.assertNotIn("Next move:", brief)
        self.assertEqual(response.ai_message.metadata["response_source"], "trainer_command_center_flag_review_v3")
        self.assertEqual(response.ai_message.metadata["action_type"], "review_flagged_clients")
        self.assertEqual(response.ai_message.metadata["summarizer"], "deterministic_structured")
        self.assertEqual(response.ai_message.metadata["client_ids"], [CLIENT_ID])
        self.assertEqual(response.ai_message.metadata["included_client_count"], 1)
        structured = response.ai_message.metadata["flagged_client_review_v3"]
        self.assertEqual(structured["version"], 3)
        self.assertEqual(len(structured["cards"]), 1)
        card = structured["cards"][0]
        self.assertEqual(card["client_id"], CLIENT_ID)
        self.assertEqual(card["client_name"], "Taylor")
        self.assertEqual(card["primary_issue_type"], "adherence_collapse")
        self.assertEqual(card["priority"], "High")
        self.assertEqual(card["action_signal"], {"label": "Reduce Friction", "tone": "high"})
        self.assertEqual(card["discussion_prompt"], card["client_message"])
        self.assertEqual(len(card["metrics_summary"]), 3)
        domains = [item["domain"] for item in card["metrics_breakdown"]]
        self.assertEqual(domains, ["Workouts", "Motivation", "Recovery", "Check-ins"])
        self.assertNotIn("Nutrition", domains)
        self.assertNotIn("Soreness", domains)
        for item in card["metrics_breakdown"]:
            metric_text = " ".join(str(value) for value in item.values())
            self.assertNotRegex(metric_text, r"\d{4}-\d{2}-\d{2}")
            self.assertNotRegex(metric_text, r"\bavg\b|/\d{1,2}\b|\baverage\b")

    def test_trainer_flag_review_matches_natural_low_score_variants(self):
        conversation_service = FakeConversationService()
        self.service = ChatSessionService(
            self.repository,
            conversation_service=conversation_service,
            trainer_home_service=FakeTrainerHomeService(),
        )
        self.service._today = lambda: TODAY
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            request=ChatSessionTodayRequest(role="trainer", session_type="coach_ai", session_date=TODAY),
        )

        response = self.service.send_message(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="Who is not doing so well? Show low daily scores."),
        )

        self.assertEqual(conversation_service.handle_chat_calls, [])
        self.assertIn("Taylor \u2014 High", response.ai_message.content)
        self.assertIn("Why it matters:", response.ai_message.content)
        self.assertIn(
            "motivation is low",
            response.ai_message.metadata["flagged_client_review_v3"]["cards"][0]["metrics_summary"],
        )
        self.assertNotIn("flagged or high-priority", response.ai_message.content)
        self.assertNotIn("Weak scores:", response.ai_message.content)
        self.assertNotIn("Sleep avg 2.0/5", response.ai_message.content)

    def test_trainer_flag_review_uses_stronger_llm_summary_when_available(self):
        conversation_service = FakeConversationService()
        conversation_service.openai_client = FakeOpenAIClient()
        self.service = ChatSessionService(
            self.repository,
            conversation_service=conversation_service,
            trainer_home_service=FakeTrainerHomeService(),
        )
        self.service._today = lambda: TODAY
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            request=ChatSessionTodayRequest(role="trainer", session_type="coach_ai", session_date=TODAY),
        )

        response = self.service.send_message(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="Review flagged clients"),
        )

        calls = conversation_service.openai_client.calls
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["model"], "gpt-5.4")
        brief = flag_review_briefs(response.ai_message.content)[0]
        self.assertIn("Main issue:\nReadiness is the main risk today.", brief)
        self.assertIn("Message to client:\nLet us adjust today and pick one easy win.", brief)
        self.assertLessEqual(word_count(brief), 75)
        self.assertEqual(response.ai_message.metadata["summarizer"], "llm_with_deterministic_fallback")
        card = response.ai_message.metadata["flagged_client_review_v3"]["cards"][0]
        self.assertEqual(card["primary_issue_type"], "adherence_collapse")
        self.assertEqual(card["action_signal"]["label"], "Reduce Friction")
        self.assertEqual(card["discussion_prompt"], "Let us adjust today and pick one easy win")
        self.assertEqual(card["metrics_summary"], ["readiness is poor", "motivation is low"])
        self.assertTrue(card["metrics_breakdown"])

    def test_trainer_flag_review_rejects_metric_dump_llm_output(self):
        conversation_service = FakeConversationService()
        conversation_service.openai_client = FakeInvalidOpenAIClient()
        self.service = ChatSessionService(
            self.repository,
            conversation_service=conversation_service,
            trainer_home_service=FakeTrainerHomeService(),
        )
        self.service._today = lambda: TODAY
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            request=ChatSessionTodayRequest(role="trainer", session_type="coach_ai", session_date=TODAY),
        )

        response = self.service.send_message(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="Review flagged clients"),
        )

        self.assertEqual(len(conversation_service.openai_client.calls), 1)
        self.assertEqual(response.ai_message.metadata["summarizer"], "deterministic_structured")
        self.assertNotRegex(response.ai_message.content, r"\bavg\b|/\d{1,2}\b|\d{4}-\d{2}-\d{2}")

    def test_trainer_flag_review_deterministic_issue_types_are_mobile_safe(self):
        service = ChatSessionService(self.repository, conversation_service=FakeConversationService())

        def make_client(
            *,
            workouts=3,
            checkins=5,
            missed=0,
            avg_score=22.0,
            weak_keys=(),
            low_readiness_days=0,
        ):
            question_summaries = [
                SimpleNamespace(
                    key=key,
                    label=key.title(),
                    average_7d=2.0,
                    low_days_7d=1,
                    latest_score=2,
                    latest_date=TODAY,
                    status="low",
                    daily_responses=[SimpleNamespace(date=TODAY, score=2)],
                )
                for key in weak_keys
            ]
            missed_dates = [date(2026, 5, 1) for _ in range(missed)]
            low_dates = [date(2026, 5, 2) for _ in range(low_readiness_days)]
            return SimpleNamespace(
                client_id="client-scenario",
                client_name="Alex",
                priority_tier="high",
                priority_score=8,
                risk_flags=[],
                missed_checkin_dates_7d=missed_dates,
                recent_low_readiness_dates=low_dates,
                week_summary=SimpleNamespace(
                    checkins_completed_7d=checkins,
                    checkins_completed_today=True,
                    workouts_completed_7d=workouts,
                    avg_score_7d=avg_score,
                    question_summaries=question_summaries,
                    missed_checkin_dates_7d=missed_dates,
                    recent_low_readiness_dates=low_dates,
                ),
            )

        scenarios = [
            ("adherence_collapse", "Reduce Friction", make_client(workouts=0, weak_keys=("motivation",))),
            ("recovery_overload", "Scale Load", make_client(avg_score=12.0, weak_keys=("soreness",), low_readiness_days=1)),
            ("fueling_issue", "Fuel First", make_client(workouts=3, weak_keys=("nutrition",))),
            ("disengagement_risk", "Re-engage", make_client(workouts=3, missed=2, weak_keys=("motivation",))),
            ("accountability_gap", "Set Tiny Target", make_client(workouts=0, checkins=7)),
            ("readiness_recovery", "Adjust Plan", make_client(workouts=3, avg_score=12.0, low_readiness_days=1)),
        ]

        for expected_issue_type, expected_signal, client in scenarios:
            with self.subTest(expected_issue_type=expected_issue_type):
                card, source = service._build_flag_review_client_card(client)
                rendered = service._render_flag_review_card(card)

                self.assertEqual(source, "deterministic")
                self.assertEqual(card["primary_issue_type"], expected_issue_type)
                self.assertEqual(card["action_signal"]["label"], expected_signal)
                self.assertEqual(card["discussion_prompt"], card["client_message"])
                self.assertTrue(card["metrics_breakdown"])
                self.assertEqual(rendered.count("Main issue:"), 1)
                self.assertEqual(rendered.count("Next action:"), 1)
                self.assertEqual(rendered.count("Message to client:"), 1)
                self.assertLessEqual(word_count(rendered), 75)
                self.assertNotRegex(rendered, r"\d{4}-\d{2}-\d{2}")
                self.assertNotRegex(rendered, r"\bavg\b|/\d{1,2}\b|\baverage\b")
                self.assertLessEqual(len(card["metrics_summary"]), 3)

    def test_trainer_flag_review_soreness_area_is_not_invented(self):
        service = ChatSessionService(self.repository, conversation_service=FakeConversationService())

        def make_soreness_client(**overrides):
            return SimpleNamespace(
                client_id="client-sore",
                client_name="Alex",
                priority_tier="medium",
                priority_score=6,
                risk_flags=[],
                missed_checkin_dates_7d=[],
                recent_low_readiness_dates=[date(2026, 5, 2)],
                week_summary=SimpleNamespace(
                    checkins_completed_7d=5,
                    checkins_completed_today=True,
                    workouts_completed_7d=3,
                    avg_score_7d=12.0,
                    missed_checkin_dates_7d=[],
                    recent_low_readiness_dates=[date(2026, 5, 2)],
                    question_summaries=[
                        SimpleNamespace(
                            key="soreness",
                            label="Soreness",
                            average_7d=2.0,
                            responses_7d=1,
                            low_days_7d=1,
                            latest_score=2,
                            latest_date=TODAY,
                            status="low",
                            daily_responses=[SimpleNamespace(date=TODAY, score=2)],
                        )
                    ],
                ),
                **overrides,
            )

        no_area_card, _ = service._build_flag_review_client_card(make_soreness_client())
        no_area_soreness = next(
            item for item in no_area_card["metrics_breakdown"] if item["domain"] == "Soreness"
        )
        self.assertEqual(no_area_soreness["detail"], "No specific sore area was captured.")

        area_card, _ = service._build_flag_review_client_card(make_soreness_client(soreness_area="left knee"))
        area_soreness = next(
            item for item in area_card["metrics_breakdown"] if item["domain"] == "Soreness"
        )
        self.assertEqual(area_soreness["detail"], "Reported sore area: left knee.")

    def test_trainer_flag_review_empty_state_keeps_board_clear(self):
        trainer_home_service = FakeTrainerHomeService()
        trainer_home_service.totals = SimpleNamespace(
            assigned_clients=2,
            scheduled_today=0,
            checkins_completed_today=2,
            today_missing_checkins=0,
            recent_missed_checkin_days=0,
            clients_with_recent_missed_checkins=0,
            clients_with_low_7d_readiness=0,
            clients_with_recent_low_readiness=0,
            high_priority_clients=0,
            critical_priority_clients=0,
        )
        trainer_home_service.clients = [
            SimpleNamespace(
                client_id="client-stable",
                client_name="Stable Client",
                priority_score=0,
                priority_tier="low",
                risk_flags=[],
                missed_checkin_dates_7d=[],
                recent_low_readiness_dates=[],
                week_summary=SimpleNamespace(
                    checkins_completed_7d=7,
                    checkins_completed_today=True,
                    avg_score_7d=22.0,
                    workouts_completed_7d=4,
                    question_summaries=[],
                ),
            )
        ]
        conversation_service = FakeConversationService()
        self.service = ChatSessionService(
            self.repository,
            conversation_service=conversation_service,
            trainer_home_service=trainer_home_service,
        )
        self.service._today = lambda: TODAY
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            request=ChatSessionTodayRequest(role="trainer", session_type="coach_ai", session_date=TODAY),
        )

        response = self.service.send_message(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="client flags"),
        )

        self.assertEqual(conversation_service.handle_chat_calls, [])
        self.assertIn("client flag board is clear", response.ai_message.content)
        self.assertEqual(response.ai_message.metadata["total_flagged_client_count"], 0)
        self.assertEqual(response.ai_message.metadata["client_ids"], [])

    def test_trainer_flag_review_stream_uses_same_command_center_responder(self):
        conversation_service = FakeConversationService()
        self.service = ChatSessionService(
            self.repository,
            conversation_service=conversation_service,
            trainer_home_service=FakeTrainerHomeService(),
        )
        self.service._today = lambda: TODAY
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            request=ChatSessionTodayRequest(role="trainer", session_type="coach_ai", session_date=TODAY),
        )

        _, _, conversation_id, chunks, route_debug, result_state = self.service.prepare_stream(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="Show highest priority clients with weak scores"),
        )

        self.assertEqual(conversation_service.stream_chat_calls, [])
        self.assertEqual(conversation_id, f"review_flagged_clients:{today.session.id}")
        self.assertIsNone(result_state)
        self.assertIn("Taylor", "".join(chunks))
        metadata = route_debug["assistant_message_metadata"]
        self.assertEqual(metadata["response_source"], "trainer_command_center_flag_review_v3")
        self.assertEqual(metadata["client_ids"], [CLIENT_ID])
        self.assertEqual(metadata["flagged_client_review_v3"]["cards"][0]["client_name"], "Taylor")

    def test_new_day_creates_new_session_and_archives_previous(self):
        first_date = date(2026, 5, 3)
        second_date = date(2026, 5, 4)

        first = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=first_date),
        )
        second = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=second_date),
        )

        self.assertNotEqual(first.session.id, second.session.id)
        archived = self.repository.get_session(first.session.id)
        self.assertIn("archived_at", archived["metadata"])

    def test_message_indexes_increment_for_user_and_ai_messages(self):
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        self.service.send_message(
            user_id=USER_ID,
            trainer_context=client_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="What should I do next?"),
        )

        indexes = [row["message_index"] for row in self.repository.messages[today.session.id]]
        self.assertEqual(indexes, [0, 1, 2])

    def test_message_send_uses_client_session_date_for_late_evening_local_day(self):
        local_date = date(2026, 5, 3)
        utc_date = date(2026, 5, 4)
        self.service._today = lambda: utc_date
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=local_date),
        )

        response = self.service.send_message(
            user_id=USER_ID,
            trainer_context=client_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(
                message="Reach step goal",
                session_date=local_date,
            ),
        )

        self.assertFalse(response.session.read_only)
        indexes = [row["message_index"] for row in self.repository.messages[today.session.id]]
        self.assertEqual(indexes, [0, 1, 2])

    def test_message_send_allows_recent_legacy_client_previous_local_day_without_session_date(self):
        local_date = date(2026, 5, 3)
        utc_date = date(2026, 5, 4)
        now = datetime(2026, 5, 4, 5, 0, tzinfo=timezone.utc)
        self.service._today = lambda: utc_date
        self.service._now = lambda: now
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=local_date),
        )
        session = self.repository.get_session(today.session.id)
        session["created_at"] = "2026-05-04T04:43:51+00:00"

        response = self.service.send_message(
            user_id=USER_ID,
            trainer_context=client_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="Reach step goal"),
        )

        self.assertFalse(response.session.read_only)
        indexes = [row["message_index"] for row in self.repository.messages[today.session.id]]
        self.assertEqual(indexes, [0, 1, 2])

    def test_message_send_rejects_old_legacy_previous_day_without_session_date(self):
        local_date = date(2026, 5, 3)
        utc_date = date(2026, 5, 4)
        now = datetime(2026, 5, 4, 20, 0, tzinfo=timezone.utc)
        self.service._today = lambda: utc_date
        self.service._now = lambda: now
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=local_date),
        )
        session = self.repository.get_session(today.session.id)
        session["created_at"] = "2026-05-04T04:43:51+00:00"

        with self.assertRaises(ValueError):
            self.service.send_message(
                user_id=USER_ID,
                trainer_context=client_context(),
                session_id=today.session.id,
                request=ChatSessionSendRequest(message="Reach step goal"),
            )

    def test_message_send_rejects_mismatched_client_session_date(self):
        local_date = date(2026, 5, 3)
        utc_date = date(2026, 5, 4)
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=local_date),
        )

        with self.assertRaises(ValueError):
            self.service.send_message(
                user_id=USER_ID,
                trainer_context=client_context(),
                session_id=today.session.id,
                request=ChatSessionSendRequest(
                    message="Reach step goal",
                    session_date=utc_date,
                ),
            )

    def test_message_send_keeps_archived_sessions_read_only_even_with_matching_date(self):
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )
        session = self.repository.get_session(today.session.id)
        session["metadata"] = {
            **(session.get("metadata") or {}),
            "archived_at": "2026-05-04T00:00:00+00:00",
        }

        with self.assertRaises(ValueError):
            self.service.send_message(
                user_id=USER_ID,
                trainer_context=client_context(),
                session_id=today.session.id,
                request=ChatSessionSendRequest(
                    message="Reach step goal",
                    session_date=TODAY,
                ),
            )

    def test_atlas_assignment_intent_creates_pending_request_without_assigning_client(self):
        self.repository.clients[CLIENT_ID]["assigned_trainer_id"] = None
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="atlas_client_chat", session_date=TODAY),
        )

        response = self.service.send_message(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="assign me to test.trainer"),
        )

        self.assertEqual(len(self.repository.connection_requests), 1)
        request_row = self.repository.connection_requests[0]
        self.assertEqual(request_row["client_id"], CLIENT_ID)
        self.assertEqual(request_row["trainer_id"], "trainer-test")
        self.assertEqual(request_row["requested_by_user_id"], USER_ID)
        self.assertEqual(request_row["status"], "pending")
        self.assertIsNone(self.repository.clients[CLIENT_ID]["assigned_trainer_id"])
        self.assertIn("approval", response.ai_message.content)
        self.assertEqual(response.ai_message.metadata["atlas_assignment_status"], "pending_created")

    def test_atlas_reuses_duplicate_pending_request(self):
        self.repository.clients[CLIENT_ID]["assigned_trainer_id"] = None
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="atlas_client_chat", session_date=TODAY),
        )

        self.service.send_message(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="connect me to test.trainer"),
        )
        second = self.service.send_message(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="attach me to test.trainer"),
        )

        self.assertEqual(len(self.repository.connection_requests), 1)
        self.assertEqual(second.ai_message.metadata["atlas_assignment_status"], "pending_existing")

    def test_atlas_ambiguous_trainer_match_does_not_create_request(self):
        self.repository.clients[CLIENT_ID]["assigned_trainer_id"] = None
        self.repository.active_trainers.append({
            "id": "trainer-test-2",
            "tenant_id": "tenant-1",
            "user_id": "trainer-user-test-2",
            "display_name": "Test.Trainer",
            "status": "active",
            "email": "test_trainer@example.com",
        })
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="atlas_client_chat", session_date=TODAY),
        )

        response = self.service.send_message(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="connect me to test.trainer"),
        )

        self.assertEqual(len(self.repository.connection_requests), 0)
        self.assertEqual(response.ai_message.metadata["atlas_assignment_status"], "trainer_ambiguous")

    def test_atlas_ignores_cross_tenant_and_inactive_trainers(self):
        self.repository.clients[CLIENT_ID]["assigned_trainer_id"] = None
        self.repository.active_trainers = [
            {
                "id": "trainer-cross",
                "tenant_id": "tenant-2",
                "user_id": "trainer-user-cross",
                "display_name": "Test Trainer",
                "status": "active",
                "email": "test.trainer@example.com",
            },
            {
                "id": "trainer-inactive",
                "tenant_id": "tenant-1",
                "user_id": "trainer-user-inactive",
                "display_name": "Test Trainer",
                "status": "inactive",
                "email": "test.trainer@example.com",
            },
        ]
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="atlas_client_chat", session_date=TODAY),
        )

        response = self.service.send_message(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="attach me to test.trainer"),
        )

        self.assertEqual(len(self.repository.connection_requests), 0)
        self.assertEqual(response.ai_message.metadata["atlas_assignment_status"], "trainer_not_found")

    def test_atlas_already_assigned_client_does_not_create_request(self):
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="atlas_client_chat", session_date=TODAY),
        )

        response = self.service.send_message(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            session_id=today.session.id,
            request=ChatSessionSendRequest(message="assign me to test.trainer"),
        )

        self.assertEqual(len(self.repository.connection_requests), 0)
        self.assertEqual(response.ai_message.metadata["atlas_assignment_status"], "already_assigned")

    def test_atlas_opening_uses_checkin_response_when_available(self):
        self.repository.today_checkin["checkin_response"] = dynamic_checkin_response()
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="atlas_client_chat", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertEqual(opening.metadata["summary_source"], "client_daily_checkin_response_v1")
        self.assertIn("Build day - 20/25", opening.content)
        self.assertNotIn("Atlas is ready", opening.content)
        self.assertTrue(opening.metadata["atlas_client_chat"])
        self.assertEqual(daily_checkin_service.calls, [])

    def test_atlas_opening_backfills_when_checkin_response_missing(self):
        self.repository.today_checkin["checkin_response"] = None
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="atlas_client_chat", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertEqual(len(daily_checkin_service.calls), 1)
        self.assertEqual(daily_checkin_service.calls[0]["client_id"], CLIENT_ID)
        self.assertEqual(opening.metadata["summary_source"], "client_daily_checkin_response_v1")
        self.assertIn("Build day - 20/25", opening.content)
        self.assertNotIn("Atlas is ready", opening.content)

    def test_atlas_opening_uses_degraded_fallback_when_no_daily_checkin_service(self):
        self.repository.today_checkin["checkin_response"] = None
        # Default service has no daily_checkin_service wired

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=unassigned_client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="atlas_client_chat", session_date=TODAY),
        )

        opening = response.messages[0]
        self.assertIn("Coach brief is still generating.", opening.content)
        self.assertEqual(opening.metadata["summary_source"], "client_daily_checkin_response_degraded_v1")
        self.assertTrue(opening.metadata["atlas_client_chat"])

    def test_legacy_first_assistant_message_is_replaced_in_place_not_appended(self):
        request = ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY)

        first = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )
        # Strip auto_generated_opening_summary to simulate a legacy static message
        legacy_message = self.repository.messages[first.session.id][0]
        legacy_content = legacy_message["content"]
        del legacy_message["metadata"]["auto_generated_opening_summary"]

        # Add checkin_response so the opening content changes
        self.repository.today_checkin["checkin_response"] = dynamic_checkin_response()
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        second = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )

        # Exactly one message — replaced, not appended
        self.assertEqual(len(self.repository.messages[first.session.id]), 1)
        self.assertEqual(first.session.id, second.session.id)
        self.assertIn("Build day - 20/25", second.messages[0].content)
        self.assertNotIn(legacy_content, second.messages[0].content)

    def test_legacy_opening_after_refresh_has_auto_generated_marker(self):
        request = ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY)

        first = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )
        # Strip all metadata to simulate legacy message with no marker
        legacy_message = self.repository.messages[first.session.id][0]
        legacy_message["metadata"] = {}

        self.repository.today_checkin["checkin_response"] = dynamic_checkin_response()
        daily_checkin_service = FakeDailyCheckinService(response=dynamic_checkin_response())
        self.service = ChatSessionService(
            self.repository,
            conversation_service=self.conversation_service,
            daily_checkin_service=daily_checkin_service,
        )
        self.service._today = lambda: TODAY

        second = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=request,
        )

        self.assertEqual(len(self.repository.messages[first.session.id]), 1)
        self.assertTrue(second.messages[0].metadata.get("auto_generated_opening_summary"))

    def test_cross_user_session_detail_is_rejected(self):
        today = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        with self.assertRaises(ValueError):
            self.service.get_session_detail(
                user_id=OTHER_USER_ID,
                trainer_context=client_context(user_id=OTHER_USER_ID),
                session_id=today.session.id,
            )

    def test_client_today_rejects_mismatched_client_scope(self):
        with self.assertRaises(ValueError):
            self.service.get_or_create_today_session(
                user_id=USER_ID,
                trainer_context=client_context(),
                request=ChatSessionTodayRequest(
                    role="client",
                    session_type="client_chat",
                    client_id="20000000-0000-0000-0000-000000000099",
                    session_date=TODAY,
                ),
            )

    def test_history_filters_to_client_scope(self):
        self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )
        self.repository.sessions.append({
            "id": "session-other-client",
            "user_id": USER_ID,
            "trainer_id": TRAINER_ID,
            "client_id": "other-client",
            "role": "client",
            "session_type": "client_chat",
            "session_date": TODAY.isoformat(),
            "title": "Other",
            "summary": None,
            "metadata": {},
            "created_at": None,
            "updated_at": None,
            "last_message_at": None,
        })

        history = self.service.list_history(
            user_id=USER_ID,
            trainer_context=client_context(),
            role="client",
            session_type="client_chat",
        )

        self.assertEqual([session.client_id for session in history.sessions], [CLIENT_ID])

    def test_trainer_history_returns_trainer_sessions(self):
        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            request=ChatSessionTodayRequest(role="trainer", session_type="coach_ai", session_date=TODAY),
        )

        history = self.service.list_history(
            user_id=USER_ID,
            trainer_context=trainer_context(),
            role="trainer",
            session_type="coach_ai",
        )

        self.assertEqual([session.id for session in history.sessions], [response.session.id])


if __name__ == "__main__":
    unittest.main()
