import copy
import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from content_contracts import (
    ContentFixture,
    PublicationCandidateV1,
    validate_content_policy_fixture,
)
from content_publication_contracts import compute_publication_candidate_checksum


EXAMPLES_DIR = Path(__file__).parent.parent / "examples"

VALID_FIXTURES = [
    "content-cycle.example.json",
    "content-week-context-owner-promotion.example.json",
    "content-week-context-safe-default.example.json",
    "content-pack-week-1-ar.example.json",
    "content-pack-week-1-en.example.json",
    "content-pack-week-1-mixed.example.json",
    "content-pack-week-2-rollover.example.json",
    "content-item-version-owner-asset.example.json",
    "content-item-version-generated-asset.example.json",
    "content-item-version-prompt-only.example.json",
    "content-decision-approved.example.json",
    "publication-candidate-created-event.example.json",
]

POLICY_EXPECTED_CODES = {
    "content-duplicate-week-claim.invalid.json": "CONTENT_WEEK_ALREADY_CLAIMED",
    "content-strategy-unapproved.invalid.json": "CONTENT_STRATEGY_NOT_APPROVED",
    "content-profile-stale.invalid.json": "CONTENT_PROFILE_STALE",
    "content-invented-promotion.invalid.json": "CONTENT_OFFER_UNAPPROVED",
    "content-expired-promotion.invalid.json": "CONTENT_OFFER_UNAPPROVED",
    "content-wrong-channel.invalid.json": "CONTENT_CHANNEL_MISMATCH",
    "content-unsupported-testimonial.invalid.json": "CONTENT_UNSUPPORTED_CLAIM",
    "content-guarantee-claim.invalid.json": "CONTENT_POLICY_VIOLATION",
    "content-regulated-claim.invalid.json": "CONTENT_POLICY_VIOLATION",
    "content-competitor-superiority.invalid.json": "CONTENT_UNSUPPORTED_CLAIM",
    "content-unconfirmed-price.invalid.json": "CONTENT_UNSUPPORTED_CLAIM",
    "content-unconfirmed-availability.invalid.json": "CONTENT_UNSUPPORTED_CLAIM",
    "content-superiority-claim.invalid.json": "CONTENT_UNSUPPORTED_CLAIM",
    "content-branded-undisclosed.invalid.json": "CONTENT_POLICY_VIOLATION",
    "content-protected-text-mutated.invalid.json": "CONTENT_POLICY_VIOLATION",
    "content-missing-required-asset.invalid.json": "CONTENT_ASSET_REQUIRED",
    "content-cycle-paused.invalid.json": "CONTENT_CYCLE_PAUSED",
    "content-cycle-completed.invalid.json": "CONTENT_CYCLE_COMPLETED",
    "content-schema-failure.invalid.json": "CONTENT_SCHEMA_FAILURE",
    "content-pack-too-few-items.invalid.json": "CONTENT_SCHEMA_FAILURE",
    "content-pack-too-many-items.invalid.json": "CONTENT_SCHEMA_FAILURE",
    "content-provider-failure.invalid.json": "CONTENT_PROVIDER_FAILURE",
    "content-approval-blocked.invalid.json": "CONTENT_APPROVAL_BLOCKED",
    "content-version-conflict.invalid.json": "CONTENT_VERSION_CONFLICT",
    "content-alt-text-too-long.invalid.json": "CONTENT_SCHEMA_FAILURE",
}


def apply_mutation(base: dict, mutation: dict) -> dict:
    doc = copy.deepcopy(base)
    kind = mutation["kind"]
    if kind == "tamper_caption":
        doc["caption"] = mutation["value"]
    elif kind == "tamper_asset_checksum":
        doc["assets"][0]["checksum"] = mutation["value"]
    elif kind == "tamper_target_channel":
        doc["target_channel"] = mutation["value"]
    elif kind == "tamper_approval_id":
        doc["approval"]["decision_id"] = mutation["value"]
    elif kind == "tamper_item_version":
        doc["content_item_version"] = mutation["value"]
    elif kind == "replay_conflict":
        doc["caption"] = mutation["value"]
        doc["candidate_checksum"] = mutation["candidate_checksum"]
    elif kind == "replay_identical":
        doc["candidate_checksum"] = compute_publication_candidate_checksum(doc)
    elif kind == "revoked":
        doc["candidate_state"] = "revoked"
    elif kind == "prompt_only_asset":
        doc["assets"][0]["kind"] = "prompt_only"
    elif kind == "unapproved":
        doc["approval"]["decision"] = "rejected"
    elif kind == "duplicate_week_claim":
        doc["existing_weekly_claims"].append(
            {
                "content_cycle_id": doc["week_context"]["content_cycle_id"],
                "week_number": doc["week_context"]["week_number"],
                "weekly_claim_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
            }
        )
    elif kind == "strategy_status":
        doc["strategy_status"] = mutation["value"]
    elif kind == "current_profile_version_id":
        doc["current_profile_version_id"] = mutation["value"]
    elif kind == "cycle_status":
        doc["cycle_status"] = mutation["value"]
    elif kind == "week_number":
        doc["week_context"]["week_number"] = mutation["value"]
    elif kind == "empty_item_ids":
        doc["pack"]["item_ids"] = []
    elif kind == "too_few_item_ids":
        doc["pack"]["item_ids"] = doc["pack"]["item_ids"][:1]
    elif kind == "too_many_item_ids":
        doc["pack"]["item_ids"] = (
            doc["pack"]["item_ids"]
            + [
                "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                "ffffffff-ffff-4fff-8fff-ffffffffffff",
            ]
        )
    elif kind == "promotion_mode":
        doc["week_context"]["promotion_mode"] = mutation["value"]
        doc["week_context"]["promotion"] = None
    elif kind == "promotion_expired":
        doc["week_context"]["promotion"]["valid_until"] = mutation["value"]
    elif kind == "channel":
        doc["item_version"]["channel"] = mutation["value"]
    elif kind == "claim":
        doc["item_version"]["claim_sources"].append(
            {
                "claim_type": mutation["claim_type"],
                "source_type": "week_context",
                "source_path": "unsafe_claim",
                "approved": mutation["approved"],
            }
        )
    elif kind == "protected_text_mutated":
        doc["protected_text_mutated"] = True
    elif kind == "asset_status":
        doc["assets"][0]["status"] = mutation["value"]
    elif kind == "approved_decision_without_asset":
        doc["decision"] = {
            "id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
            "content_item_id": doc["item_version"]["content_item_id"],
            "content_item_version_id": doc["item_version"]["id"],
            "content_item_version": doc["item_version"]["version"],
            "content_item_version_checksum": doc["item_version"]["version_checksum"],
            "decision": "approved",
            "revision_notes": None,
            "decided_by_user_id": doc["week_context"]["confirmed_by_user_id"],
            "decided_at": "2026-08-01T11:00:00+03:00",
        }
        doc["assets"][0]["status"] = "missing"
    elif kind == "version_conflict":
        doc["decision"] = {
            "id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
            "content_item_id": doc["item_version"]["content_item_id"],
            "content_item_version_id": "99999999-9999-4999-8999-999999999998",
            "content_item_version": doc["item_version"]["version"],
            "content_item_version_checksum": "stale-checksum",
            "decision": "approved",
            "revision_notes": None,
            "decided_by_user_id": doc["week_context"]["confirmed_by_user_id"],
            "decided_at": "2026-08-01T11:00:00+03:00",
        }
    elif kind == "alt_text":
        doc["item_version"]["alt_text"] = mutation["value"]
    else:
        raise ValueError(f"Unsupported mutation kind: {kind}")
    return doc


class TestContentContracts(unittest.TestCase):
    def load_fixture(self, filename: str):
        return json.loads((EXAMPLES_DIR / filename).read_text(encoding="utf-8"))

    def load_descriptor(self, filename: str):
        descriptor = self.load_fixture(filename)
        base = self.load_fixture(descriptor["base_fixture"])
        return apply_mutation(base, descriptor["mutation"])

    def test_valid_content_fixtures_are_accepted(self):
        for filename in VALID_FIXTURES:
            ContentFixture.model_validate(self.load_fixture(filename))

    def test_valid_candidate_is_accepted(self):
        PublicationCandidateV1.model_validate(
            self.load_fixture("publication-candidate-approved.example.json")
        )

    def test_schema_invalid_fixtures_are_rejected(self):
        for filename in (
            "content-week-13.invalid.json",
            "content-empty-alt-text.invalid.json",
        ):
            with self.assertRaises(ValidationError, msg=filename):
                ContentFixture.model_validate(self.load_fixture(filename))

    def test_candidate_prompt_only_is_rejected(self):
        candidate = self.load_descriptor("publication-candidate-prompt-only.invalid.json")
        with self.assertRaises(ValidationError):
            PublicationCandidateV1.model_validate(candidate)

    def test_candidate_unapproved_is_rejected(self):
        candidate = self.load_descriptor("publication-candidate-unapproved.invalid.json")
        with self.assertRaises(ValidationError):
            PublicationCandidateV1.model_validate(candidate)

    def test_candidate_tampered_is_rejected(self):
        candidate = self.load_descriptor("publication-candidate-tampered.invalid.json")
        PublicationCandidateV1.model_validate(candidate)
        self.assertNotEqual(
            compute_publication_candidate_checksum(candidate),
            candidate["candidate_checksum"],
            "tampered caption must change the checksum",
        )

    def test_candidate_revoked_is_rejected(self):
        candidate = self.load_descriptor("publication-candidate-revoked.invalid.json")
        PublicationCandidateV1.model_validate(candidate)
        self.assertEqual(candidate["candidate_state"], "revoked")

    def test_candidate_replay_identical_is_idempotent(self):
        candidate = self.load_descriptor("publication-candidate-replay-identical.invalid.json")
        PublicationCandidateV1.model_validate(candidate)
        self.assertEqual(
            compute_publication_candidate_checksum(candidate),
            candidate["candidate_checksum"],
            "identical replay must keep a matching checksum (idempotent delivery)",
        )

    def test_policy_invalid_fixtures_produce_expected_codes(self):
        for filename, expected_code in POLICY_EXPECTED_CODES.items():
            with self.subTest(filename=filename):
                fixture = self.load_descriptor(filename)
                result = validate_content_policy_fixture(fixture)
                self.assertTrue(
                    any(issue.code == expected_code for issue in result.issues),
                    f"{filename}: expected {expected_code}, got "
                    f"{[issue.code for issue in result.issues]}",
                )

    def test_valid_policy_fixture_has_no_issues(self):
        fixture = self.load_fixture("content-pack-week-1-ar.example.json")
        result = validate_content_policy_fixture(fixture)
        self.assertEqual(
            [issue.code for issue in result.issues],
            [],
            f"valid fixture must have no policy issues: {result.issues}",
        )


if __name__ == "__main__":
    unittest.main()
