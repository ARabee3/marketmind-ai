"""Fixed Content item-version checksum vectors shared with TypeScript."""

from __future__ import annotations

import uuid

from app.content.validators import compute_content_item_checksum
from tests.content.fixture_helpers import load_example


def test_python_matches_every_fixed_cross_language_vector() -> None:
    document = load_example("content-item-checksum-vectors.json")
    for vector in document["vectors"]:
        assert compute_content_item_checksum(vector["item"]) == vector["expected_checksum"]


def test_equivalent_utc_offsets_have_the_same_checksum() -> None:
    document = load_example("content-item-checksum-vectors.json")
    zulu = next(v for v in document["vectors"] if v["name"] == "timestamp-utc-z")
    offset = next(
        v
        for v in document["vectors"]
        if v["name"] == "timestamp-utc-offset-equivalent"
    )
    assert compute_content_item_checksum(zulu["item"]) == compute_content_item_checksum(
        offset["item"]
    )


def test_changing_an_immutable_field_changes_the_checksum() -> None:
    document = load_example("content-item-checksum-vectors.json")
    vector = document["vectors"][0]
    valid = {**vector["item"], "version_checksum": vector["expected_checksum"]}
    tampered = {
        **valid,
        "caption_variants": [
            {
                "locale": "ar",
                "caption": "نص مختلف",
                "cta": None,
                "hashtags": ["#متجر_النور", "#عرض_اليوم"],
            }
        ],
    }
    assert compute_content_item_checksum(valid) == vector["expected_checksum"]
    assert compute_content_item_checksum(tampered) != vector["expected_checksum"]


def test_generated_asset_identity_is_version_and_role_addressed() -> None:
    version_id = "99999999-9999-4999-8999-999999999999"
    assert str(
        uuid.uuid5(uuid.NAMESPACE_URL, f"content-asset:{version_id}:generated_static")
    ) == "25f5f5f0-9156-5319-97a5-601a4067faec"
