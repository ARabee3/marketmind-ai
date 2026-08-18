# Facebook Content Performance Workspace

Issue: [#221](https://github.com/ARabee3/marketmind-ai/issues/221)

This document describes the owner-facing web slice built on the Facebook
performance contract from [#220](https://github.com/ARabee3/marketmind-ai/issues/220).
It is Facebook-only and does not claim Instagram analytics, manual metric
entry, charts, or automatic optimization.

## Owner journey

The protected localized route is `/{locale}/performance` (`en` and `ar`). It
is available from the desktop sidebar and the mobile primary navigation. The
dashboard links to it only after the API returns at least one eligible,
really published Facebook post. The dashboard request is secondary: a
monitoring outage cannot replace or delay the primary journey action.

The workspace presents each eligible post as real evidence tied to its
publication identity:

```text
Published -> 24 hours -> 72 hours -> 7 days
```

Each stage is mapped from the API's immutable snapshot and mutable sync-window
state. The UI distinguishes `scheduled`, `collecting`, `retrying`, `blocked`,
`unavailable`, and `complete`. A missing metric remains `Unavailable` with its
reason; a provider value of `0` remains a displayed zero.

## Comparison and recovery

The baseline panel reports the API's observed and required completed seven-day
snapshot counts and explains when comparison is not ready. Metrics are shown
as a semantic table on larger screens and stacked metric rows on small
screens; no chart library or inferred cohort is introduced.

The connection panel surfaces sanitized capability blockers and links to the
existing Connections page for recovery. Post refresh uses the API cooldown
endpoint, reports queued/not-due/rate-limited outcomes, and never calls Meta
from the browser. Load, retry, empty, blocked-permission, and refresh states
are all explicit.

## Contracts and files

- `apps/web/src/lib/api/performance.ts` validates the frozen overview and sync
  window contracts before exposing data to the UI.
- `apps/web/src/features/performance/performance-state.ts` maps collection
  state and metric availability without inventing values.
- `apps/web/src/features/performance/performance-page.tsx` owns the bilingual
  workspace, evidence rail, baseline, connection, and recovery states.
- `apps/web/messages/en.json` and `apps/web/messages/ar.json` keep the
  workspace, navigation, and dashboard copy in parity.
- `apps/web/src/features/dashboard/dashboard-home.tsx` adds only the
  secondary performance entry point when eligible posts exist.

## Verification

```bash
npm run check -w @marketmind/web
npm run build -w @marketmind/web
CI=1 npm run test:e2e -- performance.spec.ts
CI=1 npm run test:e2e -- mobile-shell.spec.ts
```

The browser fixtures use contract-shaped responses only to verify rendering,
localization, accessibility, and responsive behavior. They are not production
analytics and must not be presented as live Meta evidence. Live provider
verification remains the controlled Facebook Page/account closeout described
in the backend sync document.
