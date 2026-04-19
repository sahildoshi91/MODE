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
            "/api/v1/trainer-clients/{client_id}/meeting-location",
            "/api/v1/trainer-clients/{client_id}/schedule-preferences",
            "/api/v1/trainer-clients/{client_id}/schedule-exceptions",
            "/api/v1/trainer-clients/{client_id}/schedule-exceptions/{session_date}",
            "/api/v1/trainer-settings/me",
            "/api/v1/profiles/me/trainer-schedule",
            "/api/v1/trainer-assistant/bootstrap",
            "/api/v1/trainer-assistant/execute",
            "/api/v1/trainer-assistant/drafts/{draft_id}/edit",
            "/api/v1/trainer-assistant/drafts/{draft_id}/approve",
            "/api/v1/trainer-assistant/drafts/{draft_id}/reject",
            "/api/v1/trainer-assistant/background/run",
            "/api/v1/trainer-coach/workspace",
            "/api/v1/trainer-coach/queue",
            "/api/v1/trainer-coach/events",
            "/api/v1/trainer-programs/templates",
            "/api/v1/trainer-programs/templates/{template_id}",
            "/api/v1/trainer-programs/templates/{template_id}/archive",
            "/api/v1/trainer-coach/queue/{output_id}/approve",
            "/api/v1/trainer-coach/queue/{output_id}/edit",
            "/api/v1/trainer-coach/queue/{output_id}/reject",
            "/api/v1/chat/history",
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
        self.assertIn("patch", paths["/api/v1/trainer-clients/{client_id}/meeting-location"])
        self.assertIn("get", paths["/api/v1/trainer-clients/{client_id}/schedule-preferences"])
        self.assertIn("patch", paths["/api/v1/trainer-clients/{client_id}/schedule-preferences"])
        self.assertIn("post", paths["/api/v1/trainer-clients/{client_id}/schedule-exceptions"])
        self.assertIn("delete", paths["/api/v1/trainer-clients/{client_id}/schedule-exceptions/{session_date}"])
        self.assertIn("get", paths["/api/v1/trainer-settings/me"])
        self.assertIn("patch", paths["/api/v1/trainer-settings/me"])
        self.assertIn("get", paths["/api/v1/profiles/me/trainer-schedule"])
        self.assertIn("get", paths["/api/v1/trainer-assistant/bootstrap"])
        self.assertIn("post", paths["/api/v1/trainer-assistant/execute"])
        self.assertIn("post", paths["/api/v1/trainer-assistant/drafts/{draft_id}/edit"])
        self.assertIn("post", paths["/api/v1/trainer-assistant/drafts/{draft_id}/approve"])
        self.assertIn("post", paths["/api/v1/trainer-assistant/drafts/{draft_id}/reject"])
        self.assertIn("post", paths["/api/v1/trainer-assistant/background/run"])
        self.assertIn("get", paths["/api/v1/trainer-coach/workspace"])
        self.assertIn("get", paths["/api/v1/trainer-coach/queue"])
        self.assertIn("get", paths["/api/v1/trainer-coach/events"])
        self.assertIn("post", paths["/api/v1/trainer-coach/events"])
        self.assertIn("get", paths["/api/v1/trainer-programs/templates"])
        self.assertIn("post", paths["/api/v1/trainer-programs/templates"])
        self.assertIn("patch", paths["/api/v1/trainer-programs/templates/{template_id}"])
        self.assertIn("post", paths["/api/v1/trainer-programs/templates/{template_id}/archive"])
        self.assertIn("post", paths["/api/v1/trainer-coach/queue/{output_id}/approve"])
        self.assertIn("post", paths["/api/v1/trainer-coach/queue/{output_id}/edit"])
        self.assertIn("post", paths["/api/v1/trainer-coach/queue/{output_id}/reject"])
        self.assertIn("get", paths["/api/v1/chat/history"])


if __name__ == "__main__":
    unittest.main()
