import json
from datetime import datetime
from uuid import UUID

from app.qdrant import count_points, search_points
from app.embeddings import EmbedRequest, EmbeddingProvider
from app.rag.filter_builder import build_category_filter
from app.rag.schemas import RetrievalSubquery


class FilterEvalRunner:
    def __init__(self, qdrant_client, collection_name: str, provider: EmbeddingProvider) -> None:
        self.qdrant_client = qdrant_client
        self.collection_name = collection_name
        self.provider = provider

    async def is_chunk_filtered(
        self,
        chunk_id: str,
        subquery: RetrievalSubquery,
        now: datetime | None = None,
    ) -> bool:
        if now is None:
            now = datetime.utcnow()
        q_filter = build_category_filter(subquery, now)
        count = await count_points(
            self.qdrant_client,
            self.collection_name,
            query_filter=q_filter,
        )
        return count == 0

    async def assert_chunk_not_returned(
        self,
        chunk_id: str,
        search_text: str,
        subquery: RetrievalSubquery,
        now: datetime | None = None,
    ) -> str | None:
        if now is None:
            now = datetime.utcnow()
        q_filter = build_category_filter(subquery, now)
        vector = (await self.provider.embed(EmbedRequest(texts=[search_text]))).embeddings[0].vector
        results = await search_points(
            self.qdrant_client,
            self.collection_name,
            vector=vector,
            query_filter=q_filter,
            limit=10,
        )
        returned_ids = {r.payload["chunk_id"] for r in results}
        if chunk_id in returned_ids:
            return chunk_id
        return None


async def verify_privacy_boundary(
    privacy_profile: dict,
    knowledge_points: list[dict],
) -> list[str]:
    pii_fields = ["owner_name", "owner_phone", "owner_email", "address_text", "vat_number", "exact_location"]
    detected = []
    for kp in knowledge_points:
        payload_text = kp.get("text", "")
        payload_json = json.dumps(kp, ensure_ascii=False)
        for field in pii_fields:
            if field == "exact_location":
                raw_value = privacy_profile.get("exact_location", {})
                lat = raw_value.get("lat", "")
                lng = raw_value.get("lng", "")
                if lat and str(lat) in payload_json:
                    detected.append(f"PII leak in {kp.get('chunk_id')}: field 'exact_location.lat' found in payload")
                if lng and str(lng) in payload_json:
                    detected.append(f"PII leak in {kp.get('chunk_id')}: field 'exact_location.lng' found in payload")
            else:
                raw_value = privacy_profile.get(field, "")
                if raw_value and raw_value in payload_text:
                    detected.append(f"PII leak in {kp.get('chunk_id')}: field '{field}' found in payload")
    return detected
