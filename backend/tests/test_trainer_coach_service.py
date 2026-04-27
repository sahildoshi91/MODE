import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.modules.trainer_coach.service import TrainerCoachService


class TrainerCoachServiceQueuePreviewTests(unittest.TestCase):
    def setUp(self):
        self.service = TrainerCoachService(
            repository=None,
            ai_feedback_service=None,
            trainer_home_service=None,
        )

    def test_to_queue_item_skips_json_like_text_fallback(self):
        row = {
            "id": "output-1",
            "trainer_id": "trainer-1",
            "source_type": "generated_checkin_plan",
            "review_status": "open",
            "queue_state": "pending",
            "priority_tier": "high",
            "queue_priority": 9,
            "delivery_state": "draft",
            "reviewed_output_text": '{"summary":"raw blob"}',
            "output_text": "[{\"name\":\"draft\"}]",
            "output_json": {},
        }

        item = self.service._to_queue_item(row, client_name_by_id={})

        self.assertEqual(item.headline, "Draft Review")
        self.assertEqual(item.summary, "Draft ready for review.")

    def test_to_queue_item_derives_nutrition_summary_from_structured_payload(self):
        row = {
            "id": "output-2",
            "trainer_id": "trainer-1",
            "source_type": "generated_checkin_plan",
            "review_status": "open",
            "queue_state": "pending",
            "priority_tier": "normal",
            "queue_priority": 2,
            "delivery_state": "draft",
            "output_json": {
                "plan_type": "nutrition",
                "structured": {
                    "title": "Cut Plan",
                    "meals": [
                        {"name": "Meal 1", "totalCalories": 700, "totalProtein": 55},
                        {"name": "Meal 2", "totalCalories": 800, "totalProtein": 62},
                        {"name": "Meal 3", "totalCalories": 600, "totalProtein": 48},
                    ],
                },
            },
        }

        item = self.service._to_queue_item(row, client_name_by_id={})

        self.assertEqual(item.headline, "Cut Plan")
        self.assertEqual(item.summary, "3 meals planned around about 2,100 kcal and 165g protein.")
        self.assertEqual(item.action_type, "nutrition")

    def test_to_queue_item_derives_nutrition_summary_without_macro_totals(self):
        row = {
            "id": "output-2b",
            "trainer_id": "trainer-1",
            "source_type": "generated_checkin_plan",
            "review_status": "open",
            "queue_state": "pending",
            "priority_tier": "normal",
            "queue_priority": 2,
            "delivery_state": "draft",
            "output_json": {
                "plan_type": "nutrition",
                "structured": {
                    "title": "Simple Fuel",
                    "meals": [{"name": "Breakfast"}, {"name": "Lunch"}, {"name": "Dinner"}],
                },
            },
        }

        item = self.service._to_queue_item(row, client_name_by_id={})

        self.assertEqual(item.headline, "Simple Fuel")
        self.assertEqual(item.summary, "3 meals planned with portions and timing ready to review.")

    def test_to_queue_item_derives_training_summary_from_structured_payload(self):
        row = {
            "id": "output-3",
            "trainer_id": "trainer-1",
            "source_type": "generated_checkin_plan",
            "review_status": "open",
            "queue_state": "pending",
            "priority_tier": "normal",
            "queue_priority": 2,
            "delivery_state": "draft",
            "output_json": {
                "plan_type": "training",
                "structured": {
                    "headline": "Friday Workout",
                    "exercises": [
                        {"name": "Split squat"},
                        {"name": "DB row"},
                        {"name": "Push-up"},
                    ],
                },
            },
        }

        item = self.service._to_queue_item(row, client_name_by_id={})

        self.assertEqual(item.headline, "Friday Workout")
        self.assertEqual(item.summary, "3 exercises planned")


if __name__ == "__main__":
    unittest.main()
