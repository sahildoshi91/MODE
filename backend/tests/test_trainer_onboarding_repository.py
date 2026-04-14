import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.modules.trainer_onboarding.repository import (
    TrainerOnboardingRepository,
    TrainerOnboardingStorageUnavailableError,
)


class _FakeQuery:
    def __init__(self, table_name, errors_by_table):
        self.table_name = table_name
        self.errors_by_table = errors_by_table

    def select(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        error = self.errors_by_table.get(self.table_name)
        if error is not None:
            raise error
        return type("FakeResponse", (), {"data": []})()


class _FakeSupabase:
    def __init__(self, errors_by_table):
        self.errors_by_table = errors_by_table

    def table(self, table_name):
        return _FakeQuery(table_name, self.errors_by_table)


class TrainerOnboardingRepositoryTests(unittest.TestCase):
    def test_storage_guard_maps_missing_table_errors_to_storage_unavailable(self):
        repository = TrainerOnboardingRepository(_FakeSupabase({}))

        with self.assertRaises(TrainerOnboardingStorageUnavailableError):
            repository._with_storage_guard(
                lambda: (_ for _ in ()).throw(
                    RuntimeError(
                        {
                            "code": "PGRST205",
                            "message": "Could not find the table 'public.trainer_onboarding_profiles' in the schema cache",
                        }
                    )
                )
            )

    def test_storage_preflight_reports_missing_onboarding_tables(self):
        repository = TrainerOnboardingRepository(
            _FakeSupabase(
                {
                    "trainer_onboarding_profiles": RuntimeError(
                        {
                            "code": "PGRST205",
                            "message": "Could not find the table 'public.trainer_onboarding_profiles' in the schema cache",
                        }
                    ),
                    "trainer_onboarding_events": RuntimeError(
                        {
                            "code": "PGRST205",
                            "message": "Could not find the table 'public.trainer_onboarding_events' in the schema cache",
                        }
                    ),
                }
            )
        )

        result = repository.storage_preflight()

        self.assertFalse(result["healthy"])
        self.assertEqual(
            sorted(result["missing_tables"]),
            ["trainer_onboarding_events", "trainer_onboarding_profiles"],
        )
        self.assertEqual(result["errors"], {})


if __name__ == "__main__":
    unittest.main()
