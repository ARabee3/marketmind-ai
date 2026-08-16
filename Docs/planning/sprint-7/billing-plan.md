# Billing Implementation Plan — Points Wallet (Paymob)

- **Status:** Ready to implement
- **Prepared:** 2026-08-16
- **Model spec:** [`billing-points-model.md`](./billing-points-model.md)
- **Goal:** Replace artifact-count entitlements with a **prepaid points wallet**
  (pure pay-as-you-go, points roll over), funded by **one-time Paymob top-ups**.
  No subscription at launch.

The existing billing code already implements most of the payment plumbing
(hosted checkout, signed webhooks, idempotency, provider events, transactions,
outbox). This plan **reuses that** and swaps the *entitlement* layer from
"count remaining artifacts" to "spend points."

---

## 0. Prerequisites (hard gates — do first)

These must land before the point prices are trustworthy:

1. **Cap retries end-to-end at 3.** Remove the 3×(queue) × 3×(provider) = 9
   amplification in the content path so one logical artifact costs at most one
   bounded attempt-set. Files: `content.processor.ts`, strategy/asset processors,
   BullMQ job options.
2. **Run production on the real image model, not the mock default.** Config
   defaults to `image_provider_mode=mock` / `image_model=gpt-image-1`. Production
   must run `IMAGE_PROVIDER_MODE=openrouter` + `IMAGE_MODEL=gemini-3.1-flash-image`
   (Gemini flash-image via OpenRouter, **fixed 1024×1024**). Confirm OpenRouter's
   live per-image price (≈ $0.039/image ≈ EGP 2 assumed); the 8-point image price
   depends on it.
3. **Enable `BillingProviderCostLedger` writes** for every provider-backed run
   (provider, model, tokens, native + EGP cost, retry count, success flag) so
   margins are measured, not guessed.

---

## 1. Data model (Prisma) — `apps/api/prisma/schema.prisma`

**Reuse as-is:** `BillingAccount`, `BillingCheckoutAttempt`,
`BillingPaymentTransaction`, `BillingProviderEvent`, `BillingProviderCostLedger`,
`BillingOutbox`.

**Repurpose:** `BillingPrice` → the **bundle catalog** (points packs) instead of
subscription plans. Add `pointsGranted Int` and drop subscription-only meaning of
`periodDays`.

**Retire from the enforcement path (keep tables for history/migration):**
`BillingSubscription`, `BillingUsageLedger`.

**Add:**

```prisma
model BillingPointBalance {
  id               String   @id @default(uuid()) @db.Uuid
  billingAccountId String   @unique @map("billing_account_id") @db.Uuid
  balance          Int      @default(0)          // current spendable points
  lifetimeGranted  Int      @default(0) @map("lifetime_granted")
  lifetimeSpent    Int      @default(0) @map("lifetime_spent")
  updatedAt        DateTime @updatedAt @map("updated_at")
  billingAccount   BillingAccount @relation(fields: [billingAccountId], references: [id], onDelete: Cascade)
  @@map("billing_point_balances")
}

model BillingPointLedger {           // append-only; balance is the running sum
  id               String   @id @default(uuid()) @db.Uuid
  billingAccountId String   @map("billing_account_id") @db.Uuid
  direction        String                          // "credit" | "debit"
  reason           String                          // "topup" | "trial_grant" | "spend" | "refund"
  metric           String?                         // action metric for spends
  points           Int                             // positive magnitude
  balanceAfter     Int      @map("balance_after")
  claimKey         String   @map("claim_key")      // idempotency key
  transactionId    String?  @map("transaction_id") @db.Uuid  // for top-ups
  expiresAt        DateTime? @map("expires_at")     // for credits (rollover/expiry)
  createdAt        DateTime @default(now()) @map("created_at")
  billingAccount   BillingAccount @relation(fields: [billingAccountId], references: [id], onDelete: Cascade)
  @@unique([billingAccountId, claimKey])           // idempotent debits & grants
  @@index([billingAccountId, createdAt])
  @@map("billing_point_ledger")
}
```

Migration: additive (new tables + `pointsGranted` column). No destructive drops.

---

## 2. Contracts — `packages/contracts/src/billing/billing-types.ts`

- Add `BillingPointBundle` catalog (codes `starter_150`, `growth_300`,
  `pro_500`) with `points` and `amount_egp`.
- Add the **action price menu** as a single source of truth:

```ts
export const POINT_PRICES: Record<BillingMetric, number> = {
  content_item: 2,
  content_revision: 1,
  static_image: 8,
  strategy_cycle: 50,   // whole discovery + research + strategy phase
  strategy_revision: 10,
  discovery: 0,         // included in strategy_cycle
  publication_target: 0,
};
export const TRIAL_GRANT_POINTS = 65;
export function pointsForMetric(metric: BillingMetric, units = 1): number { ... }
```

- Add response types: `BillingWalletResponse` (balance, lifetime, low-balance
  flag), `BillingPointLedgerResponse`, `BillingBundlesResponse`.
- Keep the menu **versioned** so future price changes don't rewrite history and
  never retroactively reprice already-granted points.

---

## 3. Backend — `apps/api/src/modules/billing`

### 3.1 `BillingService`
- **Top-ups (reuse `createCheckout`):** checkout amount = bundle EGP; on the
  verified `checkout.paid` webhook, in the same transaction that writes the
  `BillingPaymentTransaction`, **credit points** (ledger `credit`/`topup` +
  balance increment). Idempotent by provider transaction (already deduped).
- **Trial grant:** on first `ensureBillingAccount`, credit `TRIAL_GRANT_POINTS`
  (ledger `credit`/`trial_grant`) instead of creating a trial subscription.
- **`spendPoints(userId, metric, units, claimKey)`** — the core debit. Reuse the
  existing `recordUsage` pattern: `SELECT ... FOR UPDATE` the account row, check
  `balance >= cost`, write a `debit`/`spend` ledger row (unique on `claimKey`, so
  replays are no-ops), decrement balance. Throws `BILLING_INSUFFICIENT_POINTS`.
- **`refundPoints(userId, claimKey)`** — reverse a spend by claim key (credit
  `refund`), idempotent. Generalizes today's `releaseUsageForStrategy`.
- **`getWallet` / `getLedger` / `getBundles`** — read endpoints.
- **Delete** subscription lifecycle methods (`cancelSubscription`,
  `resumeSubscription`, `refreshStateIfExpired`) from the active path.

### 3.2 `BillingEntitlementsService` — keep the interface, change the internals
The call sites in strategy/content don't change. Only semantics do:
- `assertAllowed(userId, metric, units)` → check `balance >= pointsForMetric`.
  Throw `BILLING_INSUFFICIENT_POINTS` (was quota/trial errors).
- `record(userId, metric, units, claimKey)` → `spendPoints(...)`.
- `releaseStrategyCycle(...)` → `refundPoints(...)` for the phase claim key.

### 3.3 Charge timing (per action)
- **Cheap actions (posts, images, revisions): debit on the successful artifact**
  (existing `record()`-on-success flow). A provider failure does not charge the
  owner; the wasted provider cost is absorbed and bounded by the retry cap
  (prereq #0.1) and recorded in `BillingProviderCostLedger`.
- **Strategy phase (50 pts): reserve on start, refund on failure.** Because its
  cost is front-loaded in third-party research (~EGP 14), debit 50 points when
  the owner commits to the phase (gating discovery/research), and `refundPoints`
  if the phase fails to produce a strategy. This closes the free-research leak.

### 3.4 Controller — `billing.controller.ts`
- Keep: `GET /billing/webhooks/:provider`, `POST /billing/checkouts` (now
  "buy points"), sandbox confirm.
- Add: `GET /billing/wallet`, `GET /billing/wallet/ledger`,
  `GET /billing/bundles`.
- Remove: `subscription`, `subscription/cancel`, `subscription/resume`,
  `manual-renewal`, `usage`.

### 3.5 Config / provider
- No change to `PaymobPaymentProvider` one-time checkout + HMAC webhook — it is
  exactly what top-ups need. `recurring_card` stays gated (unused).

---

## 4. Enforcement call sites (already wired to `BillingEntitlementsService`)

Because we keep the service interface, these need only claim-key review:
- `strategy.service.ts` / `strategy.processor.ts` — reserve 50 pts at phase
  start; refund on terminal failure; 10 pts on a revision.
- `content.service.ts` / `content.processor.ts` / `content-v2.service.ts` —
  2 pts per generated post, 1 pt per revision, checked at request **and** at
  worker start (access can change while queued).
- Image/asset processor — 8 pts per successful image.

Claim keys must be stable per logical artifact (e.g.
`content-item:<id>`, `image:<assetId>`, `strategy-cycle:<id>`) so retries and
queue replays never double-charge.

---

## 5. Frontend — `apps/web`

- `src/features/billing/` and `src/app/[locale]/(workspace)/billing/page.tsx`:
  replace subscription/usage UI with **wallet balance + bundle purchase + ledger
  history**. Localize AR/EN (messages already have a billing namespace).
- Show **points price at each action** ("Generate image · 8 points") and a
  **low-balance nudge** with one-tap top-up when a planned action exceeds
  balance.
- Remove any token/usage-count surfaces. Never display tokens.
- `src/lib/api/billing.ts`: add `getWallet`, `getBundles`, `getLedger`; drop
  subscription calls.
- Follow the `AGENTS.md` frontend workflow: browser verification +
  accessibility/UX pass.

---

## 6. Migration & rollout

Since the live provider is still `fake` (no real payers), risk is low.
1. Backfill: create a `BillingPointBalance` for every existing `BillingAccount`;
   grant existing trial users `TRIAL_GRANT_POINTS`.
2. Switch enforcement from `BillingUsageLedger` counts → point balance.
3. Keep old subscription/usage tables read-only for history.

Phased delivery:
- **P0** Prerequisites (retry cap, image model, cost telemetry).
- **P1** Data model + contracts (bundles, menu, wallet types).
- **P2** `BillingService` points ledger: top-up grant + `spendPoints` +
  `refundPoints`; trial grant.
- **P3** `BillingEntitlementsService` swap + call-site claim-key review.
- **P4** Frontend wallet UI.
- **P5** Migration + `AGENTS.md`/ADR + docs update.

---

## 7. Testing

- **Ledger atomicity:** concurrent spends can't overspend (row lock + balance
  check); replay of a `claimKey` is a no-op (credit *and* debit).
- **Top-up grant:** points credited exactly once per verified webhook; duplicate
  / out-of-order / bad-signature callbacks never double-grant.
- **Refund:** failed strategy phase refunds the 50-pt reserve exactly once.
- **Insufficient balance:** action blocked at request and at worker start.
- **Retry cap:** one logical artifact charges once regardless of retries.
- **Bundle catalog:** server-priced; browser cannot set amount or points.
- **Rollover/expiry:** credits persist across top-ups; expiry honored.
- Reuse existing suites: `billing.service.webhook.spec.ts`,
  `paymob-payment.provider.spec.ts`, `apps/web/e2e/billing.spec.ts`.

---

## 8. Acceptance criteria

- Owner buys a bundle via Paymob one-time checkout; points appear **only** after
  a verified webhook.
- Every AI action spends the exact published points; failures don't charge.
- Balance, bundles, and history render in AR/EN; **no tokens shown anywhere**.
- Points roll over; server controls all prices; duplicate payments never
  double-grant.
- Retry cap proven; `BillingProviderCostLedger` shows real cost per action and
  confirms margins (watch: image, strategy phase).
- `npm run check` passes.

---

## 9. Open items (do not block build)

- Final **expiry duration** (recommended 12-month sliding) — accounting sign-off.
- **Trial grant cost** (~EGP 30) exceeds the EGP 20 target — cap trial research
  or accept, based on measured conversion.
- **Stored-value framing** ("prepaid credit, non-refundable, no cash value") —
  confirm Egyptian legal/tax treatment before public launch.
- Future **subscription-as-auto-topup** layer once Paymob recurring is approved
  (reuses this same ledger).
