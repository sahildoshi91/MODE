import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_atlas_migration_forces_rls_and_uses_service_role_only_grants():
    sql = (ROOT / "backend/sql/20260427_create_atlas_phase1.sql").read_text(encoding="utf-8")
    for table in [
        "atlas_knowledge",
        "atlas_learning_events",
        "atlas_review_queue",
        "atlas_profile",
        "atlas_audit_logs",
        "trainer_ai_knowledge",
        "trainer_ai_learning_events",
        "trainer_ai_review_queue",
    ]:
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;" in sql
        assert f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY;" in sql
    assert "TO authenticated" not in sql
    forbidden = "master" + "_ai"
    assert forbidden not in sql.lower()


def test_personal_data_inventory_covers_atlas_tables():
    inventory = json.loads((ROOT / "backend/security/personal_data_inventory.json").read_text(encoding="utf-8"))
    tables = {row["table"]: row for row in inventory["tables"]}

    for table in ["trainer_ai_knowledge", "trainer_ai_learning_events", "trainer_ai_review_queue"]:
        row = tables[table]
        assert row["classification"] == "personal"
        assert row["deletion_policy"]["action"] == "delete_rows"
        assert row["deletion_policy"]["subject"] == "trainer_ids"
        assert row["deletion_policy"]["column"] == "trainer_id"

    for table in ["atlas_knowledge", "atlas_profile"]:
        row = tables[table]
        assert row["classification"] == "non_personal"
        assert row["deletion_policy"]["action"] == "keep"

    for table in ["atlas_learning_events", "atlas_review_queue", "atlas_audit_logs"]:
        row = tables[table]
        assert row["classification"] == "derived"
        assert row["deletion_policy"]["action"] == "retention_ttl"


def test_forbidden_legacy_ai_naming_absent_in_source():
    forbidden = "master" + "_ai"
    checked_suffixes = {".py", ".js", ".json", ".sql", ".md"}
    ignored_parts = {".git", "node_modules", "build", "dist", ".pytest_cache", "ios/Pods"}
    offenders = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix not in checked_suffixes:
            continue
        relative = str(path.relative_to(ROOT))
        if any(part in relative for part in ignored_parts):
            continue
        if forbidden in path.read_text(encoding="utf-8", errors="ignore").lower():
            offenders.append(relative)
    assert offenders == []
