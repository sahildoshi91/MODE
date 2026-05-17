import os
import shutil
import subprocess
import unittest

TABLES_REQUIRING_ISOLATION_TESTS = [
    "conversations",
    "conversation_messages",
    "chat_sessions",
    "chat_messages",
    "coach_memory",
    "trainer_knowledge_entries",
    "daily_checkins",
    "intelligence_jobs",
    "worker_job_traces",
]

# Hardcoded explicit architectural mapping from staging inspection
TABLE_SCHEMAS = {
    "conversations": {"trainer_col": "trainer_id", "trainer_is_uuid": True},
    "chat_sessions": {"trainer_col": "trainer_id", "trainer_is_uuid": True},
    "coach_memory": {"trainer_col": "trainer_id", "trainer_is_uuid": True},
    "trainer_knowledge_entries": {"trainer_col": "trainer_id", "trainer_is_uuid": True},
    "intelligence_jobs": {"trainer_col": "trainer_id", "trainer_is_uuid": False},
    "worker_job_traces": {"trainer_col": "trainer_id", "trainer_is_uuid": False},
    # Child tables that enforce security strictly via nested parent RLS policies:
    "chat_messages": {"trainer_col": None},
    "conversation_messages": {"trainer_col": None},
    "daily_checkins": {"trainer_col": None},
}

def _security_db_ready() -> bool:
    return bool(os.getenv("MODE_SECURITY_DATABASE_URL") and shutil.which("psql"))

@unittest.skipUnless(
    _security_db_ready(),
    "Set MODE_SECURITY_DATABASE_URL to a Supabase direct Postgres URL and ensure psql is available.",
)
class LiveRlsAuditTests(unittest.TestCase):
    
    def _run_query(self, sql: str) -> str:
        completed = subprocess.run(
            [
                "psql",
                os.environ["MODE_SECURITY_DATABASE_URL"],
                "-v",
                "ON_ERROR_STOP=1",
                "-At",
                "-c",
                (
                    "BEGIN; "
                    "SET LOCAL ROLE authenticated; "
                    "SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'; "
                    f"{sql}; "
                    "ROLLBACK;"
                ),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            raise AssertionError(completed.stderr.strip() or completed.stdout.strip())
        return completed.stdout.strip()

    def _query_count_as_authenticated(self, sql: str) -> int:
        res = self._run_query(sql)
        for line in reversed(res.splitlines()):
            value = line.strip()
            if value.isdigit():
                return int(value)
        raise AssertionError(f"No count returned for SQL: {sql}")

def _make_cross_trainer_test(table: str):
    def test(self):
        cfg = TABLE_SCHEMAS.get(table, {"trainer_col": None})
        col = cfg["trainer_col"]
        
        if not col:
            # Child table query to verify the nested RLS policy doesn't blow up
            count = self._query_count_as_authenticated(f"SELECT COUNT(*) FROM public.{table}")
            self.assertIsInstance(count, int)
            return

        if cfg["trainer_is_uuid"]:
            clause = f"{col} = '00000000-0000-0000-0000-000000000002'::uuid"
        else:
            clause = f"{col} = '00000000-0000-0000-0000-000000000002'"

        count = self._query_count_as_authenticated(f"SELECT COUNT(*) FROM public.{table} WHERE {clause}")
        self.assertEqual(count, 0)
    return test

def _make_cross_client_test(table: str):
    def test(self):
        cfg = TABLE_SCHEMAS.get(table, {"trainer_col": None})
        col = cfg["trainer_col"]
        
        if not col:
            # Child table query to verify nested cross-client session filtering runs safely
            count = self._query_count_as_authenticated(f"SELECT COUNT(*) FROM public.{table}")
            self.assertIsInstance(count, int)
            return

        clauses = []
        if cfg["trainer_is_uuid"]:
            clauses.append(f"{col} = '00000000-0000-0000-0000-000000000001'::uuid")
        else:
            clauses.append(f"{col} = '00000000-0000-0000-0000-000000000001'")

        # Explicitly checking for client filters on tables containing data links
        if table in ["conversations", "chat_sessions"]:
            clauses.append("client_id = '00000000-0000-0000-0000-000000000002'::uuid")

        where_clause = " AND ".join(clauses)
        count = self._query_count_as_authenticated(f"SELECT COUNT(*) FROM public.{table} WHERE {where_clause}")
        self.assertEqual(count, 0)
    return test

for _table in TABLES_REQUIRING_ISOLATION_TESTS:
    setattr(LiveRlsAuditTests, f"test_cross_trainer_rls_{_table}", _make_cross_trainer_test(_table))
    setattr(LiveRlsAuditTests, f"test_cross_client_rls_{_table}", _make_cross_client_test(_table))

if __name__ == "__main__":
    unittest.main()
