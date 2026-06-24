# AI, i18n, and Documentation Governance

## AI Model Selection Plan

### Provider Modes

| Mode | Use |
|---|---|
| `mock` | Default for no-key local development and deterministic tests. |
| `gemini_dev` | Temporary free/dev fallback if available. |
| `openai` | Intended default when the key is available. |

### Selection Criteria

The chosen model must support:

- Arabic, English, and mixed-language conversation.
- Structured output or reliable JSON response mode.
- Low enough latency for interactive Discovery turns.
- Safe retry behavior for invalid output.
- Cost suitable for repeated student/demo usage.

Provider configuration rule:

- Do not hardcode the model name in application logic.
- Configure `AI_PROVIDER_MODE` and provider model names through environment variables.
- Record actual selected model names in `.env.example` comments and sprint PR notes when keys are available.

Recommended env shape:

```text
AI_PROVIDER_MODE=mock
OPENAI_API_KEY=
OPENAI_MODEL=
GEMINI_API_KEY=
GEMINI_MODEL=
AI_REQUEST_TIMEOUT_MS=30000
```


## i18n Architecture

### Backend

- Store UTF-8 text everywhere.
- Store `preferred_locale` on `users`.
- Store `primary_locale` on `businesses`.
- Store `language_mode` on `discovery_sessions`.
- Store message language on each `discovery_messages` row.
- Error responses use stable `error.code`; frontend can translate later.
- WebSocket progress uses both `message_key` and fallback `message_text`.

### AI

Discovery prompt rules:

- Reply in the owner's current language when clear.
- Support Egyptian Arabic, English, and mixed language.
- Do not translate business names unless the owner does.
- Ask one question at a time.

### Deferred Frontend Work

Frontend string catalogs, RTL layout, and route-level language switching are intentionally not covered here.

## Documentation Change Management

Source-of-truth order:

1. This architecture pack for Prepared Discovery feature architecture.
2. `Docs/planning/PROJECT_STRUCTURE_AND_REUSABLE_COMPONENTS.md` for project-wide folder boundaries.
3. Sprint issue packets for task execution.
4. Older planning docs for product context.

Rules:

- Any architecture or database decision change updates this file first.
- If a route, table, permission, or status changes, update the issue packet in the same PR.
- Add a short decision note with date, owner, and reason.
- Do not leave old endpoint names or storage decisions in docs after changing them.
