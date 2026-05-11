import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.modules.trainer_coach.repository import TrainerCoachRepository


class _FakeQuery:
    def __init__(self, data: list[dict] | None = None):
        self.data = data or []
        self.operations: list[tuple] = []
        self._negate_next = False

    @property
    def not_(self):
        self._negate_next = True
        return self

    def select(self, *args):
        self.operations.append(("select", args))
        return self

    def eq(self, column, value):
        self.operations.append(("eq", column, value))
        return self

    def in_(self, column, values):
        self.operations.append(("in", column, tuple(values)))
        return self

    def is_(self, column, value):
        op = "not_is" if self._negate_next else "is"
        self._negate_next = False
        self.operations.append((op, column, value))
        return self

    def order(self, column, desc=False):
        self.operations.append(("order", column, desc))
        return self

    def range(self, start, end):
        self.operations.append(("range", start, end))
        return self

    def execute(self):
        return type("FakeResponse", (), {"data": self.data})()


class _FakeSupabase:
    def __init__(self, query_data: list[dict] | None = None):
        self.query_data = query_data or []
        self.queries: list[_FakeQuery] = []

    def table(self, table_name):
        query = _FakeQuery(data=self.query_data if table_name == "ai_generated_outputs" else [])
        self.queries.append(query)
        return query


class TrainerCoachRepositoryTests(unittest.TestCase):
    def test_list_queue_applies_client_scoped_source_filters(self):
        supabase = _FakeSupabase(query_data=[{"id": "output-1"}])
        repository = TrainerCoachRepository(supabase)

        rows = repository.list_queue("trainer-1", limit=25, offset=10)

        self.assertEqual(len(rows), 1)
        operations = supabase.queries[0].operations
        self.assertIn(("eq", "trainer_id", "trainer-1"), operations)
        self.assertIn(("in", "review_status", ("open",)), operations)
        self.assertIn(("in", "source_type", ("chat", "generated_checkin_plan")), operations)
        self.assertIn(("not_is", "client_id", None), operations)
        self.assertIn(("range", 10, 34), operations)

    def test_count_open_queue_applies_client_scoped_source_filters(self):
        supabase = _FakeSupabase(query_data=[{"id": "1"}, {"id": "2"}])
        repository = TrainerCoachRepository(supabase)

        count = repository.count_open_queue("trainer-1")

        self.assertEqual(count, 2)
        operations = supabase.queries[0].operations
        self.assertIn(("eq", "trainer_id", "trainer-1"), operations)
        self.assertIn(("eq", "review_status", "open"), operations)
        self.assertIn(("in", "source_type", ("chat", "generated_checkin_plan")), operations)
        self.assertIn(("not_is", "client_id", None), operations)


if __name__ == "__main__":
    unittest.main()
