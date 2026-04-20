import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.api.v1.checkin import _derive_plan_preview


class CheckinPreviewDerivationTests(unittest.TestCase):
    def test_derives_nutrition_preview_from_structured_payload(self):
        headline, summary = _derive_plan_preview(
            structured_payload={
                "title": "Lean Builder",
                "meals": [
                    {"totalCalories": 650, "totalProtein": 45},
                    {"totalCalories": 780, "totalProtein": 58},
                    {"totalCalories": 720, "totalProtein": 52},
                ],
            },
            plan_type_value="nutrition",
        )

        self.assertEqual(headline, "Lean Builder")
        self.assertEqual(summary, "3 meals | 2150 kcal | 155g protein")

    def test_derives_training_preview_from_exercise_list(self):
        headline, summary = _derive_plan_preview(
            structured_payload={
                "headline": "Travel Session",
                "exercises": [{"name": "Split squat"}, {"name": "Push-up"}],
            },
            plan_type_value="training",
        )

        self.assertEqual(headline, "Travel Session")
        self.assertEqual(summary, "2 exercises planned")

    def test_falls_back_to_plan_type_when_structured_payload_missing(self):
        headline, summary = _derive_plan_preview(
            structured_payload=None,
            plan_type_value="training",
        )

        self.assertEqual(headline, "Training Plan")
        self.assertEqual(summary, "Training plan ready for review.")


if __name__ == "__main__":
    unittest.main()
