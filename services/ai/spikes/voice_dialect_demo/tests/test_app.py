from __future__ import annotations

from fastapi.testclient import TestClient

from spikes.voice_dialect_demo.app import (
    MAX_AUDIO_BYTES,
    TranscriptResult,
    create_app,
)


class FakeTranscriber:
    model = "fake-gemini-audio"

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def transcribe(
        self,
        *,
        audio: bytes,
        mime_type: str,
        language_hint: str,
    ) -> TranscriptResult:
        self.calls.append(
            {
                "audio": audio,
                "mime_type": mime_type,
                "language_hint": language_hint,
            }
        )
        return TranscriptResult(
            transcript="الدنيا هادية بالليل ومش عايز أصرف كتير على إعلانات.",
            provider="gemini-native-audio",
            model=self.model,
        )


def make_client() -> tuple[TestClient, FakeTranscriber]:
    transcriber = FakeTranscriber()
    return TestClient(create_app(transcriber=transcriber)), transcriber


def test_index_serves_the_isolated_recorder() -> None:
    client, _ = make_client()

    response = client.get("/")

    assert response.status_code == 200
    assert "Voice-note transcription spike" in response.text
    assert "MarketMind" in response.text


def test_transcribe_passes_ephemeral_wav_to_the_adapter() -> None:
    client, transcriber = make_client()

    response = client.post(
        "/api/transcribe",
        content=b"RIFF-demo-wav",
        headers={
            "content-type": "audio/wav",
            "x-voice-language-hint": "ar-EG",
        },
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "transcript": "الدنيا هادية بالليل ومش عايز أصرف كتير على إعلانات.",
        "provider": "gemini-native-audio",
        "model": "fake-gemini-audio",
        "language_hint": "ar-EG",
        "latency_ms": response.json()["latency_ms"],
        "audio_persisted": False,
        "transcript_persisted": False,
    }
    assert transcriber.calls == [
        {
            "audio": b"RIFF-demo-wav",
            "mime_type": "audio/wav",
            "language_hint": "ar-EG",
        }
    ]


def test_transcribe_rejects_non_wav_audio_before_the_adapter() -> None:
    client, transcriber = make_client()

    response = client.post(
        "/api/transcribe",
        content=b"not-audio",
        headers={"content-type": "audio/webm"},
    )

    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "VOICE_SPIKE_UNSUPPORTED_AUDIO"
    assert transcriber.calls == []


def test_transcribe_rejects_an_oversized_recording_before_the_adapter() -> None:
    client, transcriber = make_client()

    response = client.post(
        "/api/transcribe",
        content=b"0" * (MAX_AUDIO_BYTES + 1),
        headers={"content-type": "audio/wav"},
    )

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "VOICE_SPIKE_AUDIO_TOO_LARGE"
    assert transcriber.calls == []
