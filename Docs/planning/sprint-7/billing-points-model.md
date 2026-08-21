# MarketMind Points Wallet — Billing Model

- **Status:** Implemented direction (team decision, 2026-08-16)
- **Model:** prepaid points wallet with hosted checkout, signed webhooks,
  idempotent ledger handling, reconciliation, and server-owned pricing.
- **Implementation record:** see [`billing-plan.md`](./billing-plan.md).

---

## 1. What we are building

A **prepaid points wallet**. The owner buys a bundle of points, and every
AI action spends a **fixed, published number of points**. When the balance runs
low, they buy more. There is **no subscription and no recurring charge** at
launch.

- **Points are the only currency the owner ever sees. Tokens are never shown.**
  Internally we still measure real token/EGP cost (for margin control), but that
  is invisible to the customer.
- **Points roll over** and have a long expiry. The owner paid cash for them, so
  expiring them quickly would feel like theft.
- **The app itself is free to use.** Logging in, viewing past work, editing
  plans, and exporting cost nothing. **Only AI generation spends points.**

### Why points, not tokens

1. **The customer can't model tokens.** A bakery or salon owner does not know
   what a token is. "Will 150 points last me?" is answerable; "will 150k tokens
   last me?" is not.
2. **Tokens are unpredictable per action.** The same post costs different tokens
   each run (length, retries). A **fixed points-per-action** price is
   predictable — the owner always knows what an image or a post will cost.
3. **Retries must never leak to the owner.** A bad night of provider retries
   must not silently drain a paying customer. Points are charged per
   **successful artifact**, not per provider attempt.

### Why a pure wallet, not a subscription (at launch)

- **It ships now.** A subscription needs automatic recurring card charging,
  which is **not yet approved by Paymob** (the adapter deliberately refuses
  `recurring_card` today). Every points top-up is a **one-time payment**, so
  cards, mobile wallets, and kiosk/reference all work immediately.
- **It matches Egyptian prepaid habits** (mobile credit, Fawry, wallets).
- **The lifecycle is trivial:** you either have points or you don't. No grace
  period, dunning, `past_due`, or cancellation flows.
- **A subscription can be added later** as an "auto-buy N points each month"
  layer once recurring card charging is approved — underneath it is the _same_
  points ledger, so nothing built now is wasted.

---

## 2. Bundles

| Bundle  | Points | Price (EGP) | EGP per point | Who it's for                 |
| ------- | -----: | ----------: | ------------: | ---------------------------- |
| Starter |    150 |         100 |         0.667 | Light users / first purchase |
| Growth  |    300 |         200 |         0.667 | Typical monthly buyer        |
| Pro     |    500 |         300 |     **0.600** | Heavy users (best value)     |

The 500-point bundle is deliberately cheaper per point (EGP 0.60 vs 0.667) as a
**volume kicker** — it rewards buying larger and topping up less often.

Prices are **server-controlled and versioned**. The browser only sends a bundle
code; NestJS resolves the exact EGP amount from the catalog.

---

## 3. Action price menu

Every AI action costs a fixed number of points, charged **on the successful
artifact only**. A failed generation does **not** spend the owner's points.

| Owner action                                | Internal metric      | Points | ≈ EGP value | Our cost (EGP) |        Margin |
| ------------------------------------------- | -------------------- | -----: | ----------: | -------------: | ------------: |
| Post (content item)                         | `content_item`       |  **2** |        ~1.3 |          ~0.07 |     very high |
| Post revision                               | `content_revision`   |  **1** |        ~0.7 |          ~0.08 |     very high |
| Image                                       | `static_image`       |  **8** |          ~5 |           ~2.3 |         ~2.2× |
| Strategy phase (incl. discovery + research) | `strategy_cycle`     | **50** |         ~33 |         ~22–25 | **~1.3–1.4×** |
| Strategy revision                           | `strategy_revision`  | **10** |        ~6.7 |          ~0.55 |     very high |
| Discovery (part of strategy phase)          | `discovery`          |  **0** |           — |     (in phase) |             — |
| Connect / publish target                    | `publication_target` |  **0** |           — |             ~0 |             — |

Notes:

- **"Strategy phase" is one charge (50 pts) that covers the whole
  discovery → research → strategy draft flow**, because the expensive part is the
  third-party research (SerpApi/Apify, ~EGP 14), not the model. Discovery is not
  separately chargeable, so it must be gated _behind_ this 50-point debit to
  avoid a free-research leak (see the plan's "reserve" note).
- **The strategy phase is the thin-margin action (~1.3–1.4×).** It is safe
  because it happens only **once per 12-week cycle (~once a quarter)**, so total
  exposure is small and the rest of the wallet is high-margin. It is the number
  to watch if research or discovery costs rise.
- **Publishing never costs points** and paying never authorizes publication —
  the existing owner-approval and publishing-safety rules are unchanged.

---

## 4. How much a real month costs the owner

From the actual implementation:

- Content is generated **weekly** over a **12-week cycle**; each actionable week
  produces **exactly 3–5 posts** (content-v2 planner). → **12–20 posts/month.**
- Images are capped at **12/month**.
- A **strategy phase runs once per cycle** (~once a quarter), not every month.

| Scenario                                         |           Points spent | ≈ EGP charged | Our cost (EGP) |
| ------------------------------------------------ | ---------------------: | ------------: | -------------: |
| Light month (8 posts, 4 images, no strategy)     |     8×2 + 4×8 = **48** |           ~32 |            ~10 |
| Normal full month (20 posts, 12 images)          |      40 + 96 = **136** |           ~91 |            ~32 |
| Strategy month (20 posts, 12 images, 1 strategy) | 40 + 96 + 50 = **186** |          ~124 |            ~60 |

### How long a bundle lasts (with rollover)

| Bundle  | Covers                                                       |
| ------- | ------------------------------------------------------------ |
| 150 pts | ~1 normal full month                                         |
| 300 pts | ~1 strategy month, or ~2 normal months (leftover rolls over) |
| 500 pts | ~2.5–3 normal months                                         |

This is generous on purpose — rollover builds trust. The trade-off of the pure
wallet is **less frequent purchases** than a subscription. That is accepted for
launch.

---

## 5. Free trial

New owners receive a **one-time free grant of 65 points** — enough to reach the
first real "aha": one strategy phase (50) + a first week of posts (~3×2) + one
image (8).

**Cost caveat:** that grant maps to ~EGP 30 of real provider cost (mostly the
strategy research), which is **above the EGP 20 trial-cost target** in the
architecture doc. Before public launch, either cap trial research (fewer planned
searches / one image) or accept the higher trial cost against measured
conversion. Tracked as an open cost-control item.

The trial never requires a card and never auto-converts. When the free points
run out, the owner simply buys a bundle.

---

## 6. Payments

- Every top-up is a **one-time Paymob hosted checkout** for a fixed EGP bundle
  amount: cards, Egyptian mobile wallets, and kiosk/reference — whatever the
  live merchant account enables.
- **Points are granted only after a verified, signed webhook** confirms the
  payment. A browser redirect never grants points.
- Duplicate clicks / duplicate callbacks never double-grant (idempotency +
  signed provider events, already implemented).
- Indicative gateway fee is **2.75% + EGP 3** per top-up. The fixed EGP 3 is why
  larger bundles are better for margin:

  |  Top-up |   ~Fee | Net to us |
  | ------: | -----: | --------: |
  | EGP 100 |  ~5.75 |    ~94.25 |
  | EGP 200 |  ~8.50 |   ~191.50 |
  | EGP 300 | ~11.25 |   ~288.75 |

---

## 7. What the owner sees

- **Balance:** "You have 180 points."
- **Price at the point of action:** "Generate image — 8 points" / "Generate week
  — 6 points (3 posts)".
- **Low-balance nudge** when a planned action would exceed the balance, with a
  one-tap top-up.
- **History:** top-ups and point spends in plain language. **Never tokens, never
  EGP-per-token, never provider names.**

---

## 8. Prerequisites before prices are final

These gate the numbers above being trustworthy:

1. **Cap retries end-to-end at 3.** Today content can amplify to 3×3 = 9 provider
   calls. Fixed-price-per-action is only honest once one logical artifact costs
   at most one bounded, capped attempt-set.
2. **Run production on the real image model, not the mock default.** The image
   path still defaults to `mock` in config. Production must run
   `IMAGE_PROVIDER_MODE=openrouter` with `IMAGE_MODEL=gemini-3.1-flash-image`
   (Gemini flash-image / "Nano Banana" line via OpenRouter), which is **fixed at
   1024×1024** — the only supported size, so every image costs the same, which is
   what makes the flat 8-point price honest. The **8-point (~EGP 5) price assumes
   ≈ $0.039/image (~EGP 2)**; images are the dominant per-action cost, so confirm
   OpenRouter's live listed price and watch the measured number.
3. **Turn on real cost telemetry** (`BillingProviderCostLedger`) so actual
   per-action EGP cost and margins — especially images and the strategy phase —
   are measured, not estimated.

---

## 9. Rollover & expiry policy

- **Purchased points roll over** across top-ups and do not reset monthly.
- **Long expiry** (recommended: 12 months from purchase, sliding — any new
  top-up or spend refreshes the clock). Final duration is a business/accounting
  decision.
- Points are **non-refundable and have no cash value** — this framing (prepaid
  credit toward MarketMind services, not stored money) should be confirmed with
  an accountant/lawyer for the Egyptian context before public launch, because a
  "wallet" can otherwise raise stored-value / e-money questions.

---

## 10. Cost basis (assumptions behind the numbers)

- Text: Gemini flash-lite — $0.25 / 1M input, $1.50 / 1M output.
- Image: OpenRouter `gemini-3.1-flash-image` (Gemini flash-image, fixed
  1024×1024) ≈ $0.039/image ≈ EGP 2 — same ballpark as the earlier `gpt-image-1`
  medium assumption, so the image economics are unchanged. Confirm against
  OpenRouter's live listed price.
- FX: EGP 52 / USD (conservative planning rate).
- Retries capped at 3 end-to-end.
- Per-action costs derived from the repository's token fixtures (strategy
  8,270/4,812; 5-item pack 3,688/3,539; item revision 1,631/709) and the
  onboarding research allocation (~EGP 14 SerpApi + Apify).

These are planning estimates. Replace with measured `BillingProviderCostLedger`
data before freezing the menu.
