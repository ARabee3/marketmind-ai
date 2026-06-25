# packages/contracts

Shared contracts and examples for the MarketMind AI monorepo.

Sprint 1 starts here with the Prepared Discovery contract from issue `#1`.
This package intentionally contains contracts and fixtures only. It does not
contain NestJS controllers, FastAPI provider code, repositories, or secrets.

## What Exists Now

- Prepared Discovery lifecycle statuses and allowed transitions.
- Public NestJS request/response TypeScript interfaces.
- Internal FastAPI Discovery request/response TypeScript interfaces.
- WebSocket progress event contract.
- Shared API error envelope.
- JSON examples for start, status, respond, summarize, confirm, progress, AI
  calls, and public errors.
- A lightweight example validator.
- A human-readable contract guide in `PREPARED_DISCOVERY_CONTRACT.md`.

## Useful Commands

Run from the repository root:

```bash
npm run check
```

Run only this package:

```bash
npm --workspace @marketmind/contracts run check
```

## Important Boundaries

- Research happens before chat opens.
- WebSocket progress is live feedback only; HTTP status remains the recovery
  source of truth.
- Owner-visible research observations need source labels or source refs.
- Wrong or low-confidence matches must be discarded before reaching Discovery.
- Strategy remains locked until the owner confirms a profile draft.
