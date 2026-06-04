import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.modules.onboarding.service import OnboardingService


def make_service():
    return OnboardingService(repository=MagicMock())


class TestExtractProfilePatchEquipmentInference(unittest.TestCase):
    def setUp(self):
        self.service = make_service()

    def _patch(self, payload):
        return self.service._extract_profile_patch(payload)

    def test_gym_infers_full_gym_equipment(self):
        result = self._patch({"training_location": "Gym"})
        self.assertEqual(result["equipment_access"], "Full gym equipment")

    def test_gym_lowercase_infers_full_gym_equipment(self):
        result = self._patch({"training_location": "commercial gym downtown"})
        self.assertEqual(result["equipment_access"], "Full gym equipment")

    def test_home_minimal_infers_minimal_equipment(self):
        result = self._patch({"training_location": "Home (minimal)"})
        self.assertEqual(result["equipment_access"], "Home - minimal equipment")

    def test_minimal_keyword_alone_infers_minimal_equipment(self):
        result = self._patch({"training_location": "minimal setup"})
        self.assertEqual(result["equipment_access"], "Home - minimal equipment")

    def test_home_full_equipment_infers_home_gym_full(self):
        result = self._patch({"training_location": "Home - full equipment"})
        self.assertEqual(result["equipment_access"], "Home gym - full equipment")

    def test_home_kit_infers_home_gym_full(self):
        result = self._patch({"training_location": "Home with full kit"})
        self.assertEqual(result["equipment_access"], "Home gym - full equipment")

    def test_outdoors_infers_outdoors(self):
        result = self._patch({"training_location": "Outdoors"})
        self.assertEqual(result["equipment_access"], "Outdoors")

    def test_outside_infers_outdoors(self):
        result = self._patch({"training_location": "outside park"})
        self.assertEqual(result["equipment_access"], "Outdoors")

    def test_home_without_qualifier_infers_minimal(self):
        result = self._patch({"training_location": "Home"})
        self.assertEqual(result["equipment_access"], "Home - minimal equipment")

    def test_explicit_equipment_key_is_not_overwritten(self):
        result = self._patch({
            "training_location": "Gym",
            "equipment": "Resistance bands only",
        })
        self.assertEqual(result["equipment_access"], "Resistance bands only")

    def test_no_training_location_no_inference(self):
        result = self._patch({"goal": "Lose weight"})
        self.assertNotIn("equipment_access", result)

    def test_lightweight_setup_nesting_is_respected(self):
        result = self._patch({
            "lightweight_setup": {
                "training_location": "Gym",
            }
        })
        self.assertEqual(result["equipment_access"], "Full gym equipment")

    def test_explicit_equipment_in_lightweight_setup_not_overwritten(self):
        result = self._patch({
            "lightweight_setup": {
                "training_location": "Gym",
                "equipment": "Cables only",
            }
        })
        self.assertEqual(result["equipment_access"], "Cables only")


if __name__ == "__main__":
    unittest.main()
