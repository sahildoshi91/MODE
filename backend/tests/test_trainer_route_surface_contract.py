import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.main import app


class TrainerRouteSurfaceContractTests(unittest.TestCase):
    def test_openapi_includes_required_trainer_clients_routes(self):
        paths = app.openapi().get("paths", {})
        required_paths = {
            "/api/v1/trainer-home/command-center",
            "/api/v1/trainer-clients/{client_id}/detail",
            "/api/v1/trainer-clients/{client_id}/memory",
            "/api/v1/trainer-clients/{client_id}/memory/{memory_id}",
            "/api/v1/trainer-clients/{client_id}/ai-context",
        }

        missing_paths = sorted(required_paths.difference(paths.keys()))
        self.assertEqual(
            missing_paths,
            [],
            msg=f"Missing trainer route surface paths: {missing_paths}",
        )

        self.assertIn("get", paths["/api/v1/trainer-home/command-center"])
        self.assertIn("get", paths["/api/v1/trainer-clients/{client_id}/detail"])
        self.assertIn("get", paths["/api/v1/trainer-clients/{client_id}/memory"])
        self.assertIn("post", paths["/api/v1/trainer-clients/{client_id}/memory"])
        self.assertIn("patch", paths["/api/v1/trainer-clients/{client_id}/memory/{memory_id}"])
        self.assertIn("delete", paths["/api/v1/trainer-clients/{client_id}/memory/{memory_id}"])
        self.assertIn("get", paths["/api/v1/trainer-clients/{client_id}/ai-context"])


if __name__ == "__main__":
    unittest.main()
