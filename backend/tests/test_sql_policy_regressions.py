import re
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent

COACH_MEMORY_POLICY_FILES = [
    "backend/sql/20260321_supabase_full_setup.sql",
    "backend/sql/20260322_fix_multi_tenant_rls_recursion.sql",
    "backend/sql/20260321_multi_tenant_rls_policies.sql",
    "backend/sql/20260412_fix_coach_memory_internal_visibility_rls.sql",
]

COACH_MEMORY_POLICY_BLOCK = re.compile(
    r"CREATE POLICY coach_memory_select_visible ON public\.coach_memory.*?;",
    re.DOTALL,
)

VERIFICATION_REQUIRED_PATTERNS = [
    r"auth_is_trainer_user\(trainer_id\)",
    r"auth_is_client_user\(client_id\)",
    r"coalesce\(lower\(\(*value_json->>'visibility'\)*\),'internal_only'\)<>'internal_only'",
]


def _normalize_policy_qual(qual: str) -> str:
    normalized = qual.lower()
    normalized = re.sub(r"\s+", "", normalized)
    normalized = normalized.replace("public.", "")
    normalized = normalized.replace("::text", "")
    return normalized


def _qual_passes_verification(qual: str) -> bool:
    normalized = _normalize_policy_qual(qual)
    if "auth_can_view_client(client_id)" in normalized:
        return False
    return all(re.search(pattern, normalized) for pattern in VERIFICATION_REQUIRED_PATTERNS)


class SqlPolicyRegressionTests(unittest.TestCase):
    def test_canonical_sql_paths_embed_hardened_coach_memory_policy(self):
        required_fragments = [
            "public.auth_is_trainer_user(trainer_id)",
            "public.auth_is_client_user(client_id)",
            "COALESCE(LOWER(value_json ->> 'visibility'), 'internal_only') <> 'internal_only'",
        ]

        for relative_path in COACH_MEMORY_POLICY_FILES:
            text = (REPO_ROOT / relative_path).read_text()
            blocks = COACH_MEMORY_POLICY_BLOCK.findall(text)
            self.assertGreater(
                len(blocks),
                0,
                f"{relative_path} should define coach_memory_select_visible",
            )

            for block in blocks:
                for fragment in required_fragments:
                    self.assertIn(fragment, block, f"{relative_path} is missing {fragment}")
                self.assertNotIn(
                    "public.auth_can_view_client(client_id)",
                    block,
                    f"{relative_path} still contains the legacy client-visible predicate",
                )

    def test_verification_script_checks_coach_memory_policy_guard(self):
        verification_sql = (
            REPO_ROOT / "backend/sql/20260411d_verify_trainer_platform_rls.sql"
        ).read_text()

        self.assertIn("'coach_memory'", verification_sql)
        self.assertIn("coach_memory_select_visible", verification_sql)
        self.assertIn(
            "legacy auth_can_view_client(client_id) predicate is still present",
            verification_sql,
        )
        self.assertIn(
            "policy predicate is missing the hardened visibility guard",
            verification_sql,
        )
        self.assertIn("regexp_replace(normalized_qual, 'public\\.', '', 'g')", verification_sql)
        self.assertIn("regexp_replace(normalized_qual, '::text', '', 'g')", verification_sql)

    def test_verification_semantic_match_accepts_canonical_and_deparsed_policy_text(self):
        canonical_qual = """
        public.auth_is_trainer_user(trainer_id)
        OR (
          public.auth_is_client_user(client_id)
          AND COALESCE(LOWER(value_json ->> 'visibility'), 'internal_only') <> 'internal_only'
        )
        """
        deparsed_qual = """
        (auth_is_trainer_user(trainer_id) OR (auth_is_client_user(client_id)
        AND (COALESCE(lower((value_json ->> 'visibility'::text)), 'internal_only'::text)
        <> 'internal_only'::text)))
        """

        self.assertTrue(_qual_passes_verification(canonical_qual))
        self.assertTrue(_qual_passes_verification(deparsed_qual))

    def test_verification_semantic_match_rejects_legacy_predicate_with_or_without_schema(self):
        legacy_quals = [
            "public.auth_can_view_client(client_id)",
            "auth_can_view_client(client_id)",
        ]

        for qual in legacy_quals:
            with self.subTest(qual=qual):
                self.assertFalse(_qual_passes_verification(qual))

    def test_verification_semantic_match_rejects_missing_visibility_guard(self):
        missing_guard_qual = """
        public.auth_is_trainer_user(trainer_id)
        OR public.auth_is_client_user(client_id)
        """

        self.assertFalse(_qual_passes_verification(missing_guard_qual))


if __name__ == "__main__":
    unittest.main()
