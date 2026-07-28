import json

import pytest
from qdrant_client import AsyncQdrantClient

from app.qdrant import collection_exists, create_collection, create_payload_indexes

from tests.evaluation.conftest import (
    knowledge_base_fixture,
    privacy_profile_fixture,
    upsert_fixture_points,
)

pytestmark = pytest.mark.integration


async def _check_pii_in_stored_payloads(
    client: AsyncQdrantClient,
    collection_name: str,
    pii_values: list[str],
    exact_location: dict,
) -> list[str]:
    issues: list[str] = []
    next_offset = None
    while True:
        page, next_offset = await client.scroll(
            collection_name=collection_name,
            limit=100,
            offset=next_offset,
            with_payload=True,
            with_vectors=False,
        )
        for point in page:
            payload = point.payload or {}
            payload_str = json.dumps(payload, ensure_ascii=False)
            for pii in pii_values:
                if pii and pii in payload_str:
                    chunk_id = payload.get("chunk_id", "unknown")
                    issues.append(f"PII '{pii}' found in stored Qdrant point {chunk_id}")
            lat = exact_location.get("lat")
            lng = exact_location.get("lng")
            if lat and str(lat) in payload_str:
                chunk_id = payload.get("chunk_id", "unknown")
                issues.append(f"PII leak: exact_location.lat ({lat}) found in stored Qdrant point {chunk_id}")
            if lng and str(lng) in payload_str:
                chunk_id = payload.get("chunk_id", "unknown")
                issues.append(f"PII leak: exact_location.lng ({lng}) found in stored Qdrant point {chunk_id}")
        if next_offset is None:
            break
    return issues


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

    pii_values = [
        privacy_profile_fixture.get(f, "")
        for f in pii_fields
    ]
    pii_values = [v for v in pii_values if v]
    stored_issues = await _check_pii_in_stored_payloads(
        qdrant_test_client,
        test_collection_name,
        pii_values,
        privacy_profile_fixture.get("exact_location", {}),
    )
    issues.extend(stored_issues)

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

    pii_fields = ["owner_name", "owner_phone", "owner_email", "address_text", "vat_number"]
    pii_values = [
        privacy_profile_fixture.get(f, "")
        for f in pii_fields
    ]
    pii_values = [v for v in pii_values if v]

    issues = []

    stored_issues = await _check_pii_in_stored_payloads(
        qdrant_test_client,
        test_collection_name,
        pii_values,
        privacy_profile_fixture.get("exact_location", {}),
    )
    issues.extend(stored_issues)

    if not test_collection_name.startswith("test_marketing_knowledge"):
        issues.append(
            f"Collection name '{test_collection_name}' does not follow marketing_knowledge naming convention"
        )

    if issues:
        pytest.fail("\n".join(issues))
