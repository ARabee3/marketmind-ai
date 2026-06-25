from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.discovery.schemas import (
    AiDiscoveryRespondRequest,
    AiDiscoveryResult,
    AiDiscoveryStartRequest,
    AiDiscoverySummarizeRequest,
)
from app.discovery.service import DiscoveryService
from app.providers.factory import create_provider

router = APIRouter(prefix="/internal/v1/ai/discovery", tags=["internal-ai-discovery"])


def get_discovery_service(settings: Settings = Depends(get_settings)) -> DiscoveryService:
    return DiscoveryService(create_provider(settings))


@router.post("/start", response_model=AiDiscoveryResult)
async def start_discovery(
    request: AiDiscoveryStartRequest,
    service: DiscoveryService = Depends(get_discovery_service),
) -> AiDiscoveryResult:
    return await service.start(request)


@router.post("/respond", response_model=AiDiscoveryResult)
async def respond_discovery(
    request: AiDiscoveryRespondRequest,
    service: DiscoveryService = Depends(get_discovery_service),
) -> AiDiscoveryResult:
    return await service.respond(request)


@router.post("/summarize", response_model=AiDiscoveryResult)
async def summarize_discovery(
    request: AiDiscoverySummarizeRequest,
    service: DiscoveryService = Depends(get_discovery_service),
) -> AiDiscoveryResult:
    return await service.summarize(request)
