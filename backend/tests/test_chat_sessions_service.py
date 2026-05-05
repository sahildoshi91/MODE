import os
import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

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
                "user_id": CLIENT_USER_ID,
                "client_name": "Taylor",
                "assigned_trainer_id": TRAINER_ID,
            },
        }
        self.profile = {
            "primary_goal": "lean out and feel more in control",
            "user_why": None,
        }

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

    def list_sessions(self, *, user_id, trainer_id, role, session_type=None, limit=80):
        rows = [
            row for row in self.sessions
            if row["user_id"] == user_id and row["trainer_id"] == trainer_id and row["role"] == role
        ]
        if session_type:
            rows = [row for row in rows if row["session_type"] == session_type]
        return rows[:limit]

    def list_messages(self, session_id, limit=200):
        return list(self.messages.get(session_id, []))[:limit]

    def get_opening_summary_message(self, session_id):
        return next(
            (
                row for row in self.messages.get(session_id, [])
                if (row.get("metadata") or {}).get("auto_generated_opening_summary")
            ),
            None,
        )

    def update_opening_summary_message(self, *, session_id, content, metadata):
        row = self.get_opening_summary_message(session_id)
        if not row:
            return None
        row["content"] = content
        row["metadata"] = metadata or {}
        return row

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

    def get_client_names(self, *, trainer_id, client_ids):
        del trainer_id
        return {client_id: self.clients[client_id]["client_name"] for client_id in client_ids if client_id in self.clients}

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
    def handle_chat(self, user_id, trainer_context, request):
        del user_id, trainer_context, request
        return ChatResponse(
            conversation_id="legacy-conversation-1",
            assistant_message="Here is the next best step.",
            conversation_state=ConversationState(current_stage="default_fast"),
            token_usage=TokenUsage(total_tokens=12),
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


class ChatSessionServiceTests(unittest.TestCase):
    def setUp(self):
        self.repository = FakeChatSessionRepository()
        self.service = ChatSessionService(
            self.repository,
            conversation_service=FakeConversationService(),
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

    def test_client_opening_summary_is_compact_mode_brief(self):
        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        opening = response.messages[0].content
        self.assertLessEqual(len(opening.split()), 75)
        for label in ["BUILD MODE", "\nTraining:", "\nNutrition:", "\nMindset:"]:
            self.assertIn(label, opening)
        self.assertNotIn("Build Today:", opening)
        self.assertIn("What do you want to achieve today?", opening)
        self.assertIn("20/25", opening)
        self.assertIn("30-45 min", opening)
        self.assertIn("Build me a training routine", response.suggested_actions)
        self.assertIn("Build me a nutrition plan", response.suggested_actions)
        self.assertEqual(response.session.client_name, "Taylor")

    def test_client_opening_summary_mindset_names_user_why(self):
        self.repository.profile["user_why"] = "Dance until I am 100 and never tell my kids I am tired."

        response = self.service.get_or_create_today_session(
            user_id=USER_ID,
            trainer_context=client_context(),
            request=ChatSessionTodayRequest(role="client", session_type="client_chat", session_date=TODAY),
        )

        opening = response.messages[0].content
        self.assertLessEqual(len(opening.split()), 75)
        self.assertIn("Mindset: Build momentum with disciplined reps.", opening)
        self.assertIn("Remember why: Dance until I am 100", opening)
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
        self.assertIn("BUILD MODE", second.messages[0].content)
        self.assertEqual(second.messages[0].metadata["summary_source"], "client_daily_mode_brief_v1")
        self.assertEqual(second.messages[0].metadata["checkin_id"], "checkin-2")

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
