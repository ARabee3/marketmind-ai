import json
from pathlib import Path
from uuid import UUID

import pytest

from app.qdrant import collection_exists, create_collection, create_payload_indexes
from app.qdrant import QdrantKnowledgePoint

from tests.evaluation.conftest import (
    knowledge_base_fixture,
    privacy_profile_fixture,
    upsert_fixture_points,
)

pytestmark = pytest.mark.integration

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.mark.eval_smoke
async def test_no_pii_in_knowledge_base_payloads(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    knowledge_base_fixture: list[dict],
    privacy_profile_fixture: dict,
) -> None:
    if not await collection_exists(qdrant_test_client, test_collection_name):
        await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)
        await create_payload_indexes(qdrant_test_client, test_collection_name)

    await upsert_fixture_points(
        qdrant_test_client,
        test_collection_name,
        knowledge_base_fixture,
        fake_provider,
    )

    pii_fields = ["owner_name", "owner_phone", "owner_email", "address_text", "vat_number"]
    issues = []

    for point in knowledge_base_fixture:
        text = point.get("text", "")
        for field in pii_fields:
            raw_value = privacy_profile_fixture.get(field, "")
            if raw_value and raw_value in text:
                issues.append(f"PII leak in {point['chunk_id']}: field '{field}' value in text payload")

    exact_loc = privacy_profile_fixture.get("exact_location", {})
    lat = exact_loc.get("lat")
    lng = exact_loc.get("lng")
    payload_json = json.dumps(knowledge_base_fixture, ensure_ascii=False)
    if lat and str(lat) in payload_json:
        issues.append("PII leak: exact_location.lat found in knowledge base payloads")
    if lng and str(lng) in payload_json:
        issues.append("PII leak: exact_location.lng found in knowledge base payloads")

    if not test_collection_name.startswith("test_marketing_knowledge"):
        issues.append(
            f"Collection name '{test_collection_name}' does not follow marketing_knowledge naming convention"
        )

    if issues:
        pytest.fail("\n".join(issues))


@pytest.mark.eval_full
async def test_qdrant_point_payloads_never_contain_pii(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    knowledge_base_fixture: list[dict],
    privacy_profile_fixture: dict,
) -> None:
    if not await collection_exists(qdrant_test_client, test_collection_name):
        await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)
        await create_payload_indexes(qdrant_test_client, test_collection_name)

    await upsert_fixture_points(
        qdrant_test_client,
        test_collection_name,
        knowledge_base_fixture,
        fake_provider,
    )

    pii_values = [
        privacy_profile_fixture.get("owner_name", ""),
        privacy_profile_fixture.get("owner_phone", ""),
        privacy_profile_fixture.get("owner_email", ""),
        privacy_profile_fixture.get("address_text", ""),
        privacy_profile_fixture.get("vat_number", ""),
    ]
    pii_values = [v for v in pii_values if v]

    issues = []
    for point in knowledge_base_fixture:
        text = point.get("text", "")
        for pii in pii_values:
            if pii and pii in text:
                issues.append(f"PII '{pii}' found in knowledge point {point['chunk_id']}")

    exact_loc = privacy_profile_fixture.get("exact_location", {})
    for point in knowledge_base_fixture:
        payload_str = json.dumps(point, ensure_ascii=False)
        if exact_loc.get("lat") and str(exact_loc["lat"]) in payload_str:
            issues.append(f"PII leak: exact_location.lat found in {point['chunk_id']}")
        if exact_loc.get("lng") and str(exact_loc["lng"]) in payload_str:
            issues.append(f"PII leak: exact_location.lng found in {point['chunk_id']}")

    if not test_collection_name.startswith("test_marketing_knowledge"):
        issues.append(
            f"Collection name '{test_collection_name}' does not follow marketing_knowledge naming convention"
        )

    if issues:
        pytest.fail("\n".join(issues))
