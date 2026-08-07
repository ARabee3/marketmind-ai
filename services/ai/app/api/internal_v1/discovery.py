from secrets import compare_digest

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.core.config import Settings, get_settings
from app.discovery.schemas import (
    AiDiscoveryRespondRequest,
    AiDiscoveryResult,
    AiDiscoveryStartRequest,
    AiDiscoverySummarizeRequest,
)
from app.discovery.service import DiscoveryService
from app.providers.factory import create_provider
from app.voice_transcription.provider import VoiceTranscriptionProvider
from app.voice_transcription.schemas import LanguageHint, VoiceTranscriptionResponse

router = APIRouter(prefix="/internal/v1/ai/discovery", tags=["internal-ai-discovery"])


def get_discovery_service(settings: Settings = Depends(get_settings)) -> DiscoveryService:
    return DiscoveryService(create_provider(settings))


@router.post(
    "/start",
    response_model=AiDiscoveryResult,
    response_model_exclude_none=True,
)
async def start_discovery(
    request: AiDiscoveryStartRequest,
    service: DiscoveryService = Depends(get_discovery_service),
) -> AiDiscoveryResult:
    return await service.start(request)


@router.post(
    "/respond",
    response_model=AiDiscoveryResult,
    response_model_exclude_none=True,
)
async def respond_discovery(
    request: AiDiscoveryRespondRequest,
    service: DiscoveryService = Depends(get_discovery_service),
) -> AiDiscoveryResult:
    return await service.respond(request)


@router.post(
    "/summarize",
    response_model=AiDiscoveryResult,
    response_model_exclude_none=True,
)
async def summarize_discovery(
    request: AiDiscoverySummarizeRequest,
    service: DiscoveryService = Depends(get_discovery_service),
) -> AiDiscoveryResult:
    return await service.summarize(request)


@router.post(
    "/transcribe",
    response_model=VoiceTranscriptionResponse,
)
async def transcribe_voice(
    request: Request,
    x_voice_internal_token: str | None = Header(None, alias="X-Voice-Internal-Token"),
    x_discovery_language_hint: LanguageHint = Header(
        "ar-EG", alias="X-Discovery-Language-Hint"
    ),
    content_type: str | None = Header(None, alias="Content-Type"),
    settings: Settings = Depends(get_settings),
) -> VoiceTranscriptionResponse:
    if not settings.voice_transcription_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DISCOVERY_TRANSCRIPTION_UNAVAILABLE",
        )
    if not settings.voice_transcription_internal_token or not compare_digest(
        x_voice_internal_token or "", settings.voice_transcription_internal_token
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="UNAUTHORIZED",
        )

    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    if media_type not in {"audio/wav", "audio/wave", "audio/x-wav"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="DISCOVERY_TRANSCRIPTION_INVALID_AUDIO",
        )

    audio_bytes = await read_bounded_body(request, settings.voice_transcription_max_bytes)
    provider = VoiceTranscriptionProvider(settings)
    transcript = await provider.transcribe(audio_bytes, language_hint=x_discovery_language_hint)

    return VoiceTranscriptionResponse(
        transcript=transcript,
        language_hint=x_discovery_language_hint,
    )


async def read_bounded_body(request: Request, max_bytes: int) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="DISCOVERY_TRANSCRIPTION_TOO_LARGE",
                )
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="DISCOVERY_TRANSCRIPTION_INVALID_AUDIO",
            )

    chunks: list[bytes] = []
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="DISCOVERY_TRANSCRIPTION_TOO_LARGE",
            )
        chunks.append(chunk)

    return b"".join(chunks)
