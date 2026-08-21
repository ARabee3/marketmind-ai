# MarketMind shared contracts

Versioned TypeScript and Python contracts shared across the Next.js web app,
NestJS API, and FastAPI AI service. This package defines data shapes, lifecycle
rules, validation helpers, and positive/negative fixtures; it does not contain
controllers, provider clients, persistence, or secrets.

## Contract domains

- Discovery sessions, confirmed profiles, progress, and journey state
- Strategy briefs, retrieval packs, plans, readiness, versions, and decisions
- Content V1/V2 cycles, weekly plans, packs, item versions, assets, and policy
- Publishing candidates, approvals, intents, schedules, attempts, and results
- Meta connection readiness
- Facebook performance snapshots and Optimization proposals
- Billing-facing boundaries where shared with consumers
- Agentic orchestration state, events, start/resume, and terminal results
- Stable API error envelopes

The `examples/` directory intentionally includes valid and invalid fixtures.
Invalid examples are regression evidence for fail-closed validation and must
not be removed just because they cannot pass the positive schema path.

## Commands

```bash
# Complete package validation
npm run check -w @marketmind/contracts

# Build the bundled Node consumer artifact
npm run build -w @marketmind/contracts

# Focused publishing and consumer parity
npm run check:publishing -w @marketmind/contracts
npm run check:consumers -w @marketmind/contracts
```

`npm run check` at the repository root runs the complete contract suite,
including TypeScript/Python parity and fixture validation.

## Invariants

- IDs, owner/business scope, versions, and checksums are explicit.
- Approval applies to one exact immutable version.
- Mock, simulation, export, failed, unknown, and live results cannot collapse
  into the same state.
- Provider payloads are normalized before entering shared product contracts.
- New fields must be reflected in TypeScript, Python, validators, examples, and
  consumer type tests where applicable.
