from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MIGRATION_PATH = REPO_ROOT / "sql" / "20260426c_harden_trainer_asset_visibility_rls.sql"


def test_trainer_asset_select_policies_are_trainer_only() -> None:
    source = MIGRATION_PATH.read_text(encoding="utf-8")

    assert "public.auth_is_trainer_user(trainer_id)" in source
    assert "auth_can_view_trainer" not in source

    for table_name in (
        "trainer_personas",
        "trainer_knowledge_documents",
        "trainer_program_templates",
        "trainer_faq_examples",
    ):
        assert f"DROP POLICY IF EXISTS {table_name}_select_visible ON public.{table_name};" in source
        assert f"CREATE POLICY {table_name}_select_visible ON public.{table_name}" in source
