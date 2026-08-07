import io
import wave
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app


def make_valid_wav(duration_sec: float = 1.0, sample_rate: int = 8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        nframes = int(duration_sec * sample_rate)
        wf.writeframes(b"\x00\x00" * nframes)
    return buf.getvalue()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_voice_transcription_is_enabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VOICE_TRANSCRIPTION_ENABLED", raising=False)

    settings = Settings(_env_file=None)

    assert settings.voice_transcription_enabled is True


def test_transcribe_voice_disabled_when_flag_is_false(client: TestClient) -> None:
    settings = get_settings()
    settings.voice_transcription_enabled = False

    wav_data = make_valid_wav(1.0)
    response = client.post(
        "/internal/v1/ai/discovery/transcribe",
        content=wav_data,
        headers={"Content-Type": "audio/wav"},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "DISCOVERY_TRANSCRIPTION_UNAVAILABLE"


def test_transcribe_voice_unauthorized_token(client: TestClient) -> None:
    settings = get_settings()
    settings.voice_transcription_enabled = True
    settings.voice_transcription_internal_token = "secret-token-123"

    wav_data = make_valid_wav(1.0)
    response = client.post(
        "/internal/v1/ai/discovery/transcribe",
        content=wav_data,
        headers={
            "Content-Type": "audio/wav",
            "X-Voice-Internal-Token": "wrong-token",
        },
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "UNAUTHORIZED"


def test_transcribe_voice_missing_token_is_unauthorized(client: TestClient) -> None:
    settings = get_settings()
    settings.voice_transcription_enabled = True
    settings.voice_transcription_internal_token = "secret-token-123"

    response = client.post(
        "/internal/v1/ai/discovery/transcribe",
        content=make_valid_wav(1.0),
        headers={"Content-Type": "audio/wav"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "UNAUTHORIZED"


def test_transcribe_voice_success_mock(client: TestClient) -> None:
    settings = get_settings()
    settings.voice_transcription_enabled = True
    settings.voice_transcription_internal_token = "secret-token-123".strip()
    settings.ai_provider_mode = "mock"

    wav_data = make_valid_wav(2.0)
    headers = {
        "Content-Type": "audio/wav",
        "X-Voice-Internal-Token": "secret-token-123",
        "X-Discovery-Language-Hint": "ar-EG",
    }
    response = client.post(
        "/internal/v1/ai/discovery/transcribe",
        content=wav_data,
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "transcript" in data
    assert len(data["transcript"]) > 0
    assert data["language_hint"] == "ar-EG"


def test_transcribe_voice_invalid_audio_magic_bytes(client: TestClient) -> None:
    settings = get_settings()
    settings.voice_transcription_enabled = True
    settings.voice_transcription_internal_token = "secret-token-123"

    response = client.post(
        "/internal/v1/ai/discovery/transcribe",
        content=b"NOT_A_WAV_FILE_CONTENT_HERE",
        headers={
            "Content-Type": "audio/wav",
            "X-Voice-Internal-Token": "secret-token-123",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "DISCOVERY_TRANSCRIPTION_INVALID_AUDIO"


def test_transcribe_voice_rejects_non_wav_content_type(client: TestClient) -> None:
    settings = get_settings()
    settings.voice_transcription_enabled = True
    settings.voice_transcription_internal_token = "secret-token-123"

    response = client.post(
        "/internal/v1/ai/discovery/transcribe",
        content=make_valid_wav(1.0),
        headers={
            "Content-Type": "application/octet-stream",
            "X-Voice-Internal-Token": "secret-token-123",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "DISCOVERY_TRANSCRIPTION_INVALID_AUDIO"


def test_transcribe_voice_empty_audio(client: TestClient) -> None:
    settings = get_settings()
    settings.voice_transcription_enabled = True
    settings.voice_transcription_internal_token = "secret-token-123"

    response = client.post(
        "/internal/v1/ai/discovery/transcribe",
        content=b"",
        headers={
            "Content-Type": "audio/wav",
            "X-Voice-Internal-Token": "secret-token-123",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "DISCOVERY_TRANSCRIPTION_EMPTY"


def test_transcribe_voice_empty_wav_has_no_samples(client: TestClient) -> None:
    settings = get_settings()
    settings.voice_transcription_enabled = True
    settings.voice_transcription_internal_token = "secret-token-123"

    response = client.post(
        "/internal/v1/ai/discovery/transcribe",
        content=make_valid_wav(0),
        headers={
            "Content-Type": "audio/wav",
            "X-Voice-Internal-Token": "secret-token-123",
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "DISCOVERY_TRANSCRIPTION_EMPTY"


def test_transcribe_voice_duration_overrun(client: TestClient) -> None:
    settings = get_settings()
    settings.voice_transcription_enabled = True
    settings.voice_transcription_internal_token = "secret-token-123"
    settings.voice_transcription_max_seconds = 5

    wav_data = make_valid_wav(10.0)
    response = client.post(
        "/internal/v1/ai/discovery/transcribe",
        content=wav_data,
        headers={
            "Content-Type": "audio/wav",
            "X-Voice-Internal-Token": "secret-token-123",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "DISCOVERY_TRANSCRIPTION_TOO_LARGE"
