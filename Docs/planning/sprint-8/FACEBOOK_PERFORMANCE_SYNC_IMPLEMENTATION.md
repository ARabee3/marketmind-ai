# Facebook Performance Sync Implementation

Issue: [#220](https://github.com/ARabee3/marketmind-ai/issues/220)

This document describes the backend monitoring slice only. It does not claim
Meta production onboarding, a web workspace, Instagram analytics, charts, or
optimization recommendations.

## Runtime boundary

Only an immutable, real Facebook publication is eligible:

```text
PublishingResult(PUBLISHED, provider=meta, remotePublicationId != null)
  -> PublishingAttempt
  -> PublishingIntent(mode=REAL, business-owned target)
  -> PublishingCandidate(channel=facebook)
```

The reconciler derives three idempotent PostgreSQL rows from the publication
time: `24h`, `72h`, and `7d`. A missing queue notification does not remove the
rows or the work they represent.

```text
PostgreSQL window -> atomic lease -> BullMQ signal
        ^                                  |
        |                                  v
        +-- expired lease <--- worker -> Meta adapter
                                      |
                                      v
                         immutable snapshot + succeeded window
```

BullMQ carries only `{ syncWindowId, leaseOwner }`. The worker resolves the
owner, business, publication chain, target, and encrypted credential inside
the API. Tokens, Graph headers, and raw Graph responses never enter a job,
log, snapshot, or API projection.

## Provider and snapshot rules

- The Meta adapter requests only the frozen #218 allowlist:
  `post_media_view`, `post_total_media_view_unique`, and `post_clicks`.
- `0` is stored as `available`; missing values are stored as
  `unavailable/not_returned` and are never coerced to zero.
- A snapshot stores safe provenance (metric count, periods, Graph version, and
  observation time) plus the immutable publishing identity. It does not copy
  caption/media payloads.
- Snapshot insertion and completion of the claimed window use one transaction.
  A replay first checks the immutable snapshot and avoids a second provider
  call.

## Recovery and errors

The reconciler runs every 30 seconds, discovers eligible publications, returns
expired leases to `retryable`, and claims a bounded batch. Queue jobs have a
deterministic ID (`performance-sync:<window-id>:<attempt>`). A failed enqueue
releases the lease with a future retry time.

Discovery selects only publications that are missing at least one required
window. Completed publications therefore leave the bounded scan instead of
permanently starving newer posts. Snapshot replay uses PostgreSQL
`createMany(skipDuplicates)` followed by an immutable equality check, so an
identical duplicate remains recoverable inside the same transaction without a
unique violation aborting that transaction.

429s, timeouts, and eligible 5xx responses retry with bounded exponential
backoff. Expired/revoked credentials and missing Insights permission become a
terminal permission blocker. Deleted or unsupported posts become terminal
provider-unavailable rows. Logs contain only the publication/window identity
and a stable error code.

## Owner API

The global `api/v1` prefix produces these routes:

- `GET /api/v1/performance/facebook/overview`
- `GET /api/v1/performance/facebook/posts?cursor=&format=`
- `GET /api/v1/performance/facebook/posts/:publishingResultId/snapshots`
- `POST /api/v1/performance/facebook/posts/:publishingResultId/refresh`

All routes require the existing JWT and `business:read` permission. Business
scope is derived from the authenticated owner; the client cannot select a
business or provider object ID. Refresh only marks due/stale windows and asks
the reconciler to enqueue them. It never calls Meta inline and is protected by
the PostgreSQL cooldown.

Publishing readiness and monitoring capability are separate. A valid Facebook
publishing target remains usable when Insights permission or the monitoring
credential is blocked. Capability follows the credential source referenced by
the current target (vault record or legacy SocialConnection), includes the
permission result recorded during Page selection, and treats a later verified
reconnect or successful snapshot as recovery from older terminal failures.

## Verification

Focused automated checks:

```bash
npm run build -w @marketmind/contracts
npm run check -w @marketmind/contracts
npm run typecheck -w @marketmind/api
npm test -w @marketmind/api -- --runInBand src/modules/performance src/modules/publishing/performance/performance.repository.spec.ts
```

The live closeout still requires the credential-redacted team-Page worker path
and must be performed with the controlled Meta account. Use an isolated
database/Redis namespace for integration or E2E work; never reset
`marketmind_dev`. A passing mock/unit suite is not live provider evidence.
