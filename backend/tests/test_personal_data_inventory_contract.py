import re
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.security.personal_data_inventory import REQUIRED_SINK_CATEGORIES, load_personal_data_inventory


REPO_ROOT = Path(__file__).resolve().parents[1]
SQL_DIR = REPO_ROOT / "sql"
SCRIPT_PATH = REPO_ROOT / "scripts" / "check_personal_data_inventory.py"
TABLE_PATTERN = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)",
    re.IGNORECASE,
)


def _discover_public_tables_from_sql() -> set[str]:
    tables: set[str] = set()
    for path in sorted(SQL_DIR.glob("*.sql")):
        source = path.read_text(encoding="utf-8")
        for match in TABLE_PATTERN.findall(source):
            tables.add(str(match).strip().lower())
    return tables


def test_inventory_file_covers_all_public_migration_tables() -> None:
    inventory = load_personal_data_inventory(strict=True)
    migration_tables = _discover_public_tables_from_sql()

    missing = sorted(migration_tables - inventory.table_names)
    extra = sorted(inventory.table_names - migration_tables)
    assert missing == [], f"Inventory is missing migration tables: {missing}"
    assert extra == [], f"Inventory includes tables not found in migrations: {extra}"


def test_inventory_declares_all_required_sink_categories() -> None:
    inventory = load_personal_data_inventory(strict=True)
    required = set(REQUIRED_SINK_CATEGORIES)
    declared = set(inventory.required_sink_categories)
    assert required.issubset(declared)
    assert required.issubset(set(inventory.external_sinks.keys()))


def test_personal_tables_have_explicit_non_keep_policy() -> None:
    inventory = load_personal_data_inventory(strict=True)
    offenders = [
        row.fq_name
        for row in inventory.personal_or_derived_tables
        if row.deletion_policy.action == "keep"
    ]
    assert offenders == [], f"Personal/derived tables must not use keep policy: {offenders}"


def test_remaining_analytics_tables_are_non_reversible_or_deleted() -> None:
    inventory = load_personal_data_inventory(strict=True)
    analytics_rows = [
        row
        for row in inventory.tables
        if "analytics" in row.table
    ]
    assert analytics_rows, "Expected at least one analytics-related inventory row"

    for row in analytics_rows:
        if row.table == "mobile_analytics_events":
            assert row.classification == "personal"
            assert row.deletion_policy.action == "sink_handler"
            continue

        assert row.classification in {"derived", "non_personal"}
        assert row.deletion_policy.action in {"retention_ttl", "keep"}


def test_app_feedback_reports_in_inventory() -> None:
    inventory = load_personal_data_inventory(strict=True)
    tables = {t.table for t in inventory.tables}
    assert "app_feedback_reports" in tables, (
        "app_feedback_reports must be listed in personal_data_inventory.json"
    )
    entry = next(t for t in inventory.tables if t.table == "app_feedback_reports")
    assert entry.classification == "personal"
    assert entry.deletion_policy.action == "delete_rows"
    assert entry.deletion_policy.column == "user_id"


def test_check_personal_data_inventory_script_runs_in_static_mode() -> None:
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "PASSED" in completed.stdout
