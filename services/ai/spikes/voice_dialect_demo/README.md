# Voice dialect feasibility spike

This is an isolated local experiment, not a MarketMind product route.

It answers one question: **can a short owner voice note in Egyptian Arabic be
transcribed faithfully enough to become editable Discovery input?**

## What it does

- records one WAV voice note in the browser (maximum 45 seconds);
- sends the bytes inline to Gemini for transcription;
- returns an editable transcript, preserving the spoken language/dialect;
- keeps no audio or transcript in the app database, filesystem, or MarketMind
  APIs.

It does **not** write a Discovery message, infer business facts, save a profile,
or change any production behavior.

## Run locally

From `services/ai`, point the spike to an existing local AI-service `.env`
without copying it into this worktree:

```bash
VOICE_SPIKE_ENV_FILE=/path/to/your/normal/services/ai/.env \
uv run uvicorn spikes.voice_dialect_demo.app:app --reload --port 8011
```

Open <http://127.0.0.1:8011> and allow microphone access.

The default model is `gemini-3.6-flash`, selected because the configured-era
`gemini-2.5-flash` endpoint rejects new requests. Override it only for a tested
model:

```bash
VOICE_SPIKE_ENV_FILE=/path/to/your/normal/services/ai/.env \
VOICE_SPIKE_MODEL=gemini-3.6-flash \
uv run uvicorn spikes.voice_dialect_demo.app:app --reload --port 8011
```

## Test protocol

Record three 15-30 second notes, then edit the returned transcript only to mark
mistakes:

1. Egyptian Arabic: natural business description with colloquial words.
2. Modern Standard Arabic: the same kind of business description.
3. English: a short comparison baseline.

For each note, record:

- whether the dialect was preserved rather than translated into formal Arabic;
- words/numbers that were wrong or invented;
- whether the owner could correct the transcript faster than typing it;
- returned model and latency shown by the page.

The result is **applicable** only if the owner can understand and correct the
transcript easily. The transcript remains an editable owner statement, never an
automatically confirmed business fact.

## Safety boundaries

- only same-origin browser requests are accepted;
- only browser-produced WAV is accepted;
- recordings are bounded to 45 seconds / 5 MiB;
- no raw audio or transcript is persisted by the app;
- no prompt, recording bytes, transcript, or API key is emitted to logs;
- provider failures remain visible and never fall back to invented text.

## Automated check

```bash
cd services/ai
uv run pytest spikes/voice_dialect_demo/tests -q
```
