"""Content v2 contract parity tests (issue #187).

Mirrors the surfaces defined in packages/contracts/src/content/v2/*.ts and
validates the example fixtures: valid examples must construct, invalid
examples must raise ValidationError, and the planner/week-plan invariants
(3-5 ordered post plans) must be enforced.
"""

import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from content_v2_contracts import (
    AiContentV2PlanRequest,
    AiContentV2PlanResponse,
    ContentCtaLibraryEntryInput,
    ContentCtaLibraryEntryV2,
    ContentEditorialProfileUpsertRequest,
    ContentEditorialProfileV2,
    ContentItemVersionV2,
    ContentMediaLibraryEntryV2,
    ContentPostPlanV2,
    ContentV2FrozenInput,
    ContentWeekPlanV2,
    ContentWeekPlanListResponse,
    OwnerContentDirectEditRequest,
)


EXAMPLES_DIR = Path(__file__).parent.parent / "examples"

VALID_FIXTURES = [
    "content-v2-editorial-profile.example.json",
    "content-v2-cta-library.example.json",
    "content-v2-media-library.example.json",
    "content-v2-week-plan.example.json",
    "content-v2-frozen-input.example.json",
]

INVALID_FIXTURES = [
    "content-v2-planner-two-plans.invalid.json",
    "content-v2-week-plan-six-plans.invalid.json",
    "content-v2-frozen-input-unordered.invalid.json",
]

MODEL_BY_FIXTURE = {
    "content-v2-editorial-profile.example.json": ContentEditorialProfileV2,
    "content-v2-cta-library.example.json": None,
    "content-v2-media-library.example.json": None,
    "content-v2-week-plan.example.json": ContentWeekPlanV2,
    "content-v2-frozen-input.example.json": ContentV2FrozenInput,
}


def load(name: str):
    return json.loads((EXAMPLES_DIR / name).read_text(encoding="utf-8"))


class ContentV2ContractTests(unittest.TestCase):
    def test_valid_fixtures_construct(self) -> None:
        for name in VALID_FIXTURES:
            with self.subTest(fixture=name):
                payload = load(name)
                model = MODEL_BY_FIXTURE[name]
                if model is None:
                    continue
                if name == "content-v2-cta-library.example.json":
                    self.assertIsNone(model)
                    continue
                model.model_validate(payload)

    def test_cta_library_entries_construct(self) -> None:
        for entry in load("content-v2-cta-library.example.json")["entries"]:
            ContentCtaLibraryEntryV2.model_validate(entry)

    def test_media_library_entries_construct(self) -> None:
        for entry in load("content-v2-media-library.example.json")["entries"]:
            ContentMediaLibraryEntryV2.model_validate(entry)

    def test_invalid_fixtures_rejected(self) -> None:
        for name in INVALID_FIXTURES:
            with self.subTest(fixture=name):
                payload = load(name)
                if name == "content-v2-planner-two-plans.invalid.json":
                    with self.assertRaises(ValidationError):
                        AiContentV2PlanResponse.model_validate(payload)
                elif name == "content-v2-week-plan-six-plans.invalid.json":
                    with self.assertRaises(ValidationError):
                        ContentWeekPlanV2.model_validate(payload)
                else:
                    with self.assertRaises(ValidationError):
                        ContentV2FrozenInput.model_validate(payload)

    def test_planner_requires_three_to_five_plans(self) -> None:
        valid = load("content-v2-week-plan.example.json")["post_plans"]
        two = [valid[0], valid[1]]
        with self.assertRaises(ValidationError):
            AiContentV2PlanResponse(
                week_plan_id=valid[0]["content_week_plan_id"],
                post_plans=two,
                validation={"valid": True, "issues": []},
            )

    def test_week_plan_position_gap_rejected(self) -> None:
        payload = load("content-v2-week-plan.example.json")
        plans = payload["post_plans"]
        plans[1]["position"] = 5  # positions become 1,5,3,4 -> gap + duplicate
        with self.assertRaises(ValidationError):
            ContentWeekPlanV2.model_validate(payload)

    def test_editorial_profile_upsert_request(self) -> None:
        profile = ContentEditorialProfileV2.model_validate(
            load("content-v2-editorial-profile.example.json")
        )
        upsert = ContentEditorialProfileUpsertRequest(
            audience_nuance=profile.audience_nuance,
            voice=profile.voice,
            language=profile.language,
            writing_guardrails=list(profile.writing_guardrails),
            default_visual_guidance=profile.default_visual_guidance,
        )
        self.assertEqual(upsert.language, "ar-EG")

    def test_cta_entry_input_defaults(self) -> None:
        entry = ContentCtaLibraryEntryInput(
            label="اطلب بالواتساب",
            destination={"type": "whatsapp", "value": "+201001234567"},
            campaign_context=None,
        )
        self.assertTrue(entry.active)

    def test_frozen_input_plan_count_and_order(self) -> None:
        frozen = ContentV2FrozenInput.model_validate(
            load("content-v2-frozen-input.example.json")
        )
        self.assertEqual(len(frozen.post_plans), 4)
        self.assertEqual(
            [plan.position for plan in frozen.post_plans], [1, 2, 3, 4]
        )

    def test_owner_direct_edit_requires_base_version(self) -> None:
        payload = {
            "content_item_id": "be000000-0000-4000-8000-00000000be11",
            "base_version_id": "be000000-0000-4000-8000-00000000be11",
            "base_version_checksum": "a" * 64,
            "caption_variants": [],
            "cta": None,
            "hashtags": [],
            "alt_text": "صورة كشري",
            "creative_brief": "مختصر",
            "idempotency_key": "key-1",
        }
        OwnerContentDirectEditRequest.model_validate(payload)
        payload.pop("base_version_id")
        with self.assertRaises(ValidationError):
            OwnerContentDirectEditRequest.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
