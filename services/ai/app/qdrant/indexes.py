from qdrant_client import AsyncQdrantClient
from qdrant_client.models import PayloadSchemaType

from app.qdrant.collection import QdrantCollectionError


# Fields that support equality filtering and benefit from payload indexes.
PAYLOAD_INDEXED_FIELDS: list[tuple[str, PayloadSchemaType]] = [
    ("review_status", PayloadSchemaType.KEYWORD),
    ("evidence_tier", PayloadSchemaType.KEYWORD),
    ("kind", PayloadSchemaType.KEYWORD),
    ("locale", PayloadSchemaType.KEYWORD),
    ("markets", PayloadSchemaType.KEYWORD),
    ("industries", PayloadSchemaType.KEYWORD),
    ("business_models", PayloadSchemaType.KEYWORD),
    ("objectives", PayloadSchemaType.KEYWORD),
    ("funnel_stages", PayloadSchemaType.KEYWORD),
    ("channels", PayloadSchemaType.KEYWORD),
    ("seasons", PayloadSchemaType.KEYWORD),
    ("budget_modes", PayloadSchemaType.KEYWORD),
    ("effective_at", PayloadSchemaType.DATETIME),
    ("expires_at", PayloadSchemaType.DATETIME),
]


async def create_payload_indexes(
    client: AsyncQdrantClient,
    collection_name: str,
) -> None:
    """Create payload indexes for all commonly filtered fields.

    Idempotent: Qdrant ignores duplicate index creation requests.
    """
    try:
        for field_name, field_schema in PAYLOAD_INDEXED_FIELDS:
            await client.create_payload_index(
                collection_name=collection_name,
                field_name=field_name,
                field_schema=field_schema,
            )
    except Exception as exc:
        raise QdrantCollectionError(
            f"Failed to create payload indexes for {collection_name}: {exc}"
        ) from exc
