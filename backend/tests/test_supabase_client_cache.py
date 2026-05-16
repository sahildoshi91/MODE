import os
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.db.client import clear_supabase_client_cache, get_supabase_user_client


class SupabaseClientCacheTests(unittest.TestCase):
    def tearDown(self):
        clear_supabase_client_cache()

    def test_user_client_is_reused_within_thread_not_across_threads(self):
        created = []

        def fake_create_client(*args, **kwargs):
            del args, kwargs
            client = object()
            created.append(client)
            return client

        with patch("app.db.client.create_client", side_effect=fake_create_client):
            first = get_supabase_user_client("token-123")
            second = get_supabase_user_client("token-123")
            with ThreadPoolExecutor(max_workers=1) as executor:
                third = executor.submit(get_supabase_user_client, "token-123").result()

        self.assertIs(first, second)
        self.assertIsNot(first, third)
        self.assertEqual(len(created), 2)


if __name__ == "__main__":
    unittest.main()
