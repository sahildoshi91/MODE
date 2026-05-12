from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
INDEX_MIGRATION = REPO_ROOT / "sql" / "20260511c_database_hardening_indexes.sql"
VERIFY_SQL = REPO_ROOT / "sql" / "20260511d_verify_data_fortress_phase_b.sql"
CONVERSATION_REPOSITORY = REPO_ROOT / "app" / "modules" / "conversation" / "repository.py"
CHAT_SESSION_REPOSITORY = REPO_ROOT / "app" / "modules" / "chat_sessions" / "repository.py"
AUDIT_SCRIPT = REPO_ROOT / "scripts" / "phase_b_database_audit.py"
DROP_REDUNDANT_INDEX_MIGRATION = REPO_ROOT / "sql" / "20260511e_drop_redundant_conversation_message_index.sql"


def test_phase_b_required_indexes_are_declared():
    source = INDEX_MIGRATION.read_text()

    assert "idx_conversations_trainer_client" in source
    assert "ON public.conversations (trainer_id, client_id)" in source
    assert "idx_conversations_client_created_desc" in source
    assert "ON public.conversations (client_id, created_at DESC)" in source
    assert "idx_conversation_messages_conversation_created_desc" in source
    assert "ON public.conversation_messages (conversation_id, created_at DESC, id DESC)" in source
    assert "idx_intelligence_jobs_type_status_enqueued" in (REPO_ROOT / "sql" / "20260511b_create_intelligence_jobs.sql").read_text()


def test_phase_b_drops_redundant_message_index_after_composite_index_exists():
    source = DROP_REDUNDANT_INDEX_MIGRATION.read_text()

    assert "DROP INDEX IF EXISTS public.idx_conversation_messages_conversation_id" in source
    assert "CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id" in source


def test_phase_b_optional_directive_indexes_are_safe_for_absent_tables():
    source = INDEX_MIGRATION.read_text()

    for table in ("public.messages", "public.user_digests", "public.safety_flags", "public.readiness_scores"):
        assert f"to_regclass('{table}')" in source


def test_conversation_message_history_query_is_bounded_and_recent_first():
    source = CONVERSATION_REPOSITORY.read_text()

    assert "normalized_limit = max(1, min(int(limit or 20), 50))" in source
    assert ".order('created_at', desc=True)" in source
    assert ".order('id', desc=True)" in source
    assert ".limit(normalized_limit)" in source
    assert "rows.reverse()" in source


def test_chat_session_append_fallback_does_not_load_500_messages():
    source = CHAT_SESSION_REPOSITORY.read_text()

    assert "self.list_messages(session_id, limit=500)" not in source
    assert '.select("message_index")' in source
    assert '.order("message_index", desc=True)' in source
    assert ".limit(1)" in source


def test_phase_b_rls_verification_sql_checks_enabled_and_forced():
    source = VERIFY_SQL.read_text()

    for table in ("conversations", "conversation_messages", "chat_sessions", "chat_messages", "intelligence_jobs"):
        assert f"'{table}'" in source
    assert "relrowsecurity IS DISTINCT FROM TRUE" in source
    assert "relforcerowsecurity IS DISTINCT FROM TRUE" in source
    assert "SET LOCAL ROLE authenticated" in source


def test_phase_b_live_audit_script_runs_explain_analyze_without_printing_secrets():
    source = AUDIT_SCRIPT.read_text()

    assert "MODE_SECURITY_DATABASE_URL" in source
    assert "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)" in source
    assert "database_url" in source
    assert "print(database_url" not in source
