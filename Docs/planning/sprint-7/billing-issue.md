## Title
Implement Billing: Prepaid Points Wallet (end-user only)

## Summary

Replace the current artifact-count entitlement model with a **prepaid points
wallet**. Owners buy a fixed EGP bundle (Starter 150 / Growth 300 / Pro 500
points) via a one-time Paymob checkout, and every successful AI action spends
a fixed, published number of points (posts = 2, revisions = 1, images = 8,
strategy phase = 50, strategy revision = 10). Points roll over, never expire
quickly, and are never shown to the owner as tokens or EGP-per-token.

This is a **pricing-shape change only**. The existing payment plumbing
(hosted checkout, signed webhooks, idempotency, provider events, transactions,
outbox) is being reused as-is — this issue does not touch that layer's design,
only the entitlement/ledger logic sitting on top of it.

Full spec and rationale: `billing-points-model.md`
Full implementation plan: `billing-plan.md`

(Both should be added to the repo under `Docs/planning/` — e.g.
`Docs/planning/sprint-7/` or wherever the next sprint folder lands — as part
of this work, since `Docs/planning/` is the project's source of truth per
`AGENTS.md`.)

## Scope

**In scope:** end-user (owner-facing) billing only —
- Data model additions (`BillingPointBalance`, `BillingPointLedger`) and the
  `pointsGranted` addition to the bundle catalog.
- Contracts: point price menu, bundle catalog, wallet/ledger response types.
- Backend: `BillingService` (top-up grant, trial grant, `spendPoints`,
  `refundPoints`, wallet/ledger/bundle reads), `BillingEntitlementsService`
  internals swapped from quota checks to balance checks, controller routes for
  wallet/ledger/bundles.
- Enforcement call-site updates in strategy/content/image processors (claim
  keys, charge timing, reserve-and-refund for the strategy phase).
- Frontend: owner-facing wallet balance, bundle purchase, spend history,
  per-action price display, low-balance nudge.

**Explicitly out of scope — do not touch:**
- Any admin-facing billing views, admin tooling, or admin routes/controllers.
  Admin support for the points model will be a separate, later piece of work.
- The Paymob provider adapter itself and the underlying checkout/webhook
  plumbing — reuse it, don't redesign it.
- `recurring_card` / subscription billing — stays gated/unused at launch.

If any admin surface currently reads the old subscription/usage entitlement
fields, leave it working against the retained (read-only) legacy tables rather
than modifying it — flag it in the PR description instead of changing it.

## Why (context for reviewers)

- Owners can't reason about tokens, and per-run token cost is unpredictable
  (retries, length). A flat points-per-action price is honest and legible.
- Paymob doesn't yet support recurring card charging, so a subscription isn't
  possible at launch — a one-time-topup wallet is. A subscription layer can be
  added later on top of the same ledger once recurring is approved.
- Charging only on the successful artifact (not per provider attempt) means a
  bad night of retries never silently drains a paying customer's balance.

## Hard prerequisites (must land first — see `billing-plan.md` §0)

1. Cap retries end-to-end at 3 across the content/strategy/image processors
   (currently can amplify to 3×3 = 9 provider calls).
2. Run production on the real image model (`IMAGE_PROVIDER_MODE=openrouter`,
   `IMAGE_MODEL=gemini-3.1-flash-image`, fixed 1024×1024) instead of the
   `mock` default — the flat 8-point image price depends on this.
3. Turn on `BillingProviderCostLedger` writes for every provider-backed run so
   margins (especially images and the strategy phase) are measured, not
   guessed.

These gate the trustworthiness of the published point prices — do not skip
them to get to the ledger work faster.

## Implementation outline

Follow the phased plan in `billing-plan.md` §6:
- **P0** Prerequisites above.
- **P1** Prisma additions + contracts (bundle catalog, `POINT_PRICES` menu,
  wallet/ledger types) — versioned so future price changes never retroactively
  reprice already-granted points.
- **P2** `BillingService` points ledger: top-up grant on verified webhook,
  trial grant (`TRIAL_GRANT_POINTS = 65`), `spendPoints`, `refundPoints`.
- **P3** `BillingEntitlementsService` swap (interface unchanged, internals
  become balance checks) + claim-key review at each call site
  (`content-item:<id>`, `image:<assetId>`, `strategy-cycle:<id>`) so retries
  and queue replays never double-charge.
- **P4** Frontend wallet UI (balance, bundle purchase, ledger history,
  per-action price display, low-balance nudge). No token/usage-count surfaces
  anywhere.
- **P5** Migration (backfill `BillingPointBalance` + trial grant for existing
  accounts), retain old subscription/usage tables read-only for history, docs/
  ADR update.

Key implementation details are already specified in `billing-plan.md` §§1–5
(schema, contracts, service methods, controller routes, frontend files) —
follow them as written rather than re-deriving the design.

## Acceptance criteria

- Owner buys a bundle via Paymob one-time checkout; points are credited
  **only** after a verified, signed webhook (never on browser redirect).
- Every AI action spends exactly its published point price on success;
  failed/retried provider attempts never charge the owner.
- Strategy phase points are reserved at phase start and refunded on failure
  (closes the free-research leak on discovery).
- Balance, bundle catalog, and spend history render for the owner in AR/EN;
  no tokens, EGP-per-token, or provider names are ever shown.
- Points roll over across top-ups; all prices are server-resolved (client only
  sends a bundle code); duplicate webhook callbacks never double-grant.
- Retry cap (≤3 end-to-end) is proven in tests; `BillingProviderCostLedger`
  shows real per-action EGP cost so margins can be checked against the model
  doc's assumptions.
- No admin surface is modified.
- `npm run check` passes.

## Testing

Per `billing-plan.md` §7: ledger atomicity under concurrent spends, top-up
grant exactly-once, refund exactly-once, insufficient-balance blocking (at
request time and at worker start), retry-cap charging once per artifact,
server-controlled bundle pricing, rollover/expiry behavior. Reuse/extend
`billing.service.webhook.spec.ts`, `paymob-payment.provider.spec.ts`,
`apps/web/e2e/billing.spec.ts`.

## Non-blocking follow-ups (tracked, not required for this issue)

- Final points expiry duration (recommended 12-month sliding) — needs
  accounting sign-off.
- Trial grant real cost (~EGP 30) exceeds the ~EGP 20 target — either cap
  trial research or accept pending measured conversion data.
- "Prepaid credit, non-refundable, no cash value" framing needs legal/tax
  confirmation for the Egyptian context before public launch.
- Admin-facing billing/points views and controls (separate future issue).
- Subscription-as-auto-topup layer once Paymob recurring is approved.

---

## Note to the implementing agent

- Read `billing-points-model.md` and `billing-plan.md` in full before writing
  any code — they are the source of truth for prices, schema, and file
  locations; do not re-derive the pricing model or invent different numbers.
- Follow `AGENTS.md` at the repo root: two-space indentation, LF endings,
  UTF-8, final newlines; respect the existing module boundaries; `npm run
  check` must pass before this is considered done.
- Respect the project's git conventions — work on a feature branch, keep
  commits scoped and readable, and open a PR rather than pushing to `main`.
  Match whatever commit-message and branch-naming convention is already in
  use in this repo's history (check recent commits/PRs before starting) rather
  than introducing a new one.
- **Do not touch anything under admin.** This plan is end-user (owner-facing)
  only. If you find billing code shared with or read by an admin surface,
  leave that surface working as-is against the retained legacy tables and
  call it out in the PR description — do not modify or extend it.
- Do not modify the Paymob provider adapter's checkout/webhook design — reuse
  it exactly as `billing-plan.md` describes.
- If anything in the two docs is ambiguous or conflicts with existing code you
  find while implementing, stop and flag it rather than guessing — don't
  invent business rules (pricing, expiry, refund policy) that aren't written
  down in the model doc.
