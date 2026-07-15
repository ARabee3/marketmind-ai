from fastapi import APIRouter

from app.qdrant.client import check_qdrant_health, QdrantConnectionError

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    status: dict[str, str] = {
        "status": "ok",
        "service": "marketmind-ai-service",
    }
    try:
        qdrant_status = await check_qdrant_health()
        status["qdrant"] = qdrant_status["qdrant"]
        status["qdrant_collections"] = str(qdrant_status["collections"])
    except QdrantConnectionError as exc:
        status["qdrant"] = "unreachable"
        status["qdrant_error"] = str(exc)
    return status
