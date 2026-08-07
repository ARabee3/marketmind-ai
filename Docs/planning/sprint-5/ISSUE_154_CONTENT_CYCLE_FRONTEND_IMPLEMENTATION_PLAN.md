# Issue #154 Content Cycle Frontend Implementation Plan

- **Issue:** [#154 — Content cycle, weekly context, readiness, and generation workspace](https://github.com/ARabee3/marketmind-ai/issues/154)
- **Owner:** Ahmed Rabie (`@ARabee3`)
- **API/contract reviewer:** Mostafa (`@MostafaAhmed22`)
- **Cross-workspace reviewer:** Gerges (`@GergesYoussef-hub`)
- **Companion issue:** [#155 — Content pack review workspace](https://github.com/ARabee3/marketmind-ai/issues/155)
- **Parent:** [#106](https://github.com/ARabee3/marketmind-ai/issues/106)
- **Dependencies:** [#107](https://github.com/ARabee3/marketmind-ai/issues/107) and [#110](https://github.com/ARabee3/marketmind-ai/issues/110)
- **Reviewed baseline:** `main@4c9d8d1` on 2026-08-06
- **Frontend versions:** Next.js `16.2.10`, React `19.2.4`, next-intl `4.x`
- **Status:** Slice A is implementation-ready. Slice B remains blocked by the
  two API readiness gates in section 4.

## 1. Objective

Build one bilingual Content workspace that turns an exact owner-approved
Strategy into a truthful rolling 12-week content cycle.

The owner must be able to answer these questions without understanding the
backend architecture:

1. Which exact Strategy and confirmed profile are being used?
2. Which week of the 12-week plan am I looking at?
3. What weekly context did I confirm, or did the system use a safe default?
4. Is the context still editable, and when does it become frozen?
5. Is generation queued, running, validating, ready, or failed?
6. What action is safe now: start, save context, generate, retry, or review?
7. Does any action publish content? The answer on this page is always no.

The core journey is:

```text
confirmed profile
  -> exact approved Strategy version and approval decision
  -> owner confirms Week 1 context
  -> create one 12-week cycle
  -> Week 1 is queued by the server exactly once
  -> owner navigates the 12-week editorial ledger
  -> owner confirms future-week context before its cutoff
  -> exact next eligible week is queued
  -> real server progress is shown
  -> draft pack opens in the companion review workspace
```

This page is an **editorial planning desk**, not a dashboard, content editor,
AI chat, social calendar, or publishing surface.

## 2. Mandatory sources of truth

The implementing agent must read these files before changing code:

1. `AGENTS.md`
2. `apps/web/AGENTS.md`
3. `.agents/skills/marketmind-frontend-workflow/SKILL.md`
4. `.agents/skills/frontend-design/SKILL.md`
5. `.agents/skills/vercel-react-best-practices/SKILL.md`
6. `.agents/skills/marketmind-frontend-workflow/references/product-visual-brief.md`
7. `.agents/skills/marketmind-frontend-workflow/references/frontend-definition-of-done.md`
8. `Docs/planning/sprint-5/CONTENT_AGENT_AND_AUTOMATION_HANDOFF_ARCHITECTURE.md`
9. `packages/contracts/src/content/content-cycle.ts`
10. `packages/contracts/src/content/content-interfaces.ts`
11. `packages/contracts/src/content/content-types.ts`
12. `packages/contracts/src/journey/current-journey.ts`
13. `packages/contracts/src/strategy/strategy-plan.ts`
14. `packages/contracts/src/strategy/strategy-lifecycle.ts`
15. `apps/api/src/modules/content/content.controller.ts`
16. `apps/api/src/modules/content/content.service.ts`
17. `apps/api/src/modules/content/dto/create-content-cycle.dto.ts`
18. `apps/api/src/modules/content/dto/upsert-week-context.dto.ts`
19. `apps/api/src/modules/content/dto/generate-content-week.dto.ts`
20. the existing Strategy and Publishing frontend implementations under
    `apps/web/src/features/strategy` and `apps/web/src/features/publishing`.

Because this repository uses Next.js 16, read the vendored version-matched
guidance rather than relying on remembered Next.js APIs:

```text
node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md
node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md
node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md
node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md
```

Run this before implementation:

```bash
npm run agent:doctor -- --available-mcp context7
```

The reviewed checkout passes that doctor command as of 2026-08-06. The setup
script does not currently list Gemini as a supported `--agent` value, so do not
invent `npm run agent:setup -- --agent gemini`. Use a supported local harness
only if that is how Gemini is being run.

Source priority when two descriptions appear to disagree:

1. persisted HTTP behavior in the NestJS controller/service;
2. shared `@marketmind/contracts` types;
3. approved Sprint 5 architecture;
4. issue text;
5. fixtures and wireframe example values.

Report any mismatch instead of silently choosing a convenient shape.

## 3. Non-negotiable product and technical rules

### 3.1 The frontend must do these things

- Start Content only from the exact current approved Strategy version and its
  exact owner approval decision.
- Cross-check the Strategy version, decision, and profile identities before
  enabling the start action.
- Render exactly 12 week slots. Never render, route to, or request Week 13.
- Treat the route week as a strict integer from 1 through 12.
- Use server-returned context provenance and pack lifecycle state.
- Keep `owner_confirmed` and `system_defaulted` visibly different in text, not
  only in color.
- Use one idempotency key per logical create/generate action.
- Reuse that key only when retrying the same uncertain transport operation.
- Disable repeated mutation clicks while a request is in flight.
- Localize stable error codes. Never render raw server `message` or progress
  `message_text` as owner-facing copy.
- Preserve owner-entered business text exactly. Do not translate it.
- Use `Africa/Cairo` for schedule and cutoff display.
- State beside every generation action that generation creates drafts and does
  not publish anything.

### 3.2 The frontend must never do these things

- Do not call `POST /content-cycles/:id/weeks/1/generate` after creating a
  cycle. `POST /content-cycles` already queues Week 1 before returning.
- Do not create fake progress with elapsed-time percentages or timers.
- Do not infer an old week's pack status from its week number.
- Do not invent a pack ID for a week.
- Do not create a mock asset library in the production route.
- Do not allow arbitrary UUID entry as a substitute for an approved-photo
  picker.
- Do not imply that generated drafts are approved, scheduled, or published.
- Do not edit Strategy decisions or confirmed profile facts in Content.
- Do not add backend, database, Prisma, queue, contract, or AI-service changes
  to this issue's frontend branch.
- Do not add a state-management or data-fetching dependency for this page.
- Do not create a route-local sidebar or mobile navigation.
- Do not introduce gradients, glassmorphism, purple AI styling, robots,
  sparkles, industry-specific decoration, or a grid of metric cards.

## 4. API capability audit and readiness gates

The implementation must distinguish what works on the reviewed baseline from
what is still dependency-gated.

| Need | Current source | Baseline status | Frontend treatment |
| --- | --- | --- | --- |
| Entry and latest cycle | `GET /journey/current` | Available | Use `content.cycle` and the latest `content.pack` only |
| Exact approved Strategy | `GET /strategies/:id` | Available | Require `status=approved`, brief, plan, and current version ID |
| Exact approval receipt | `GET /strategies/:id/versions` | Available | Match current version and approved decision exactly |
| Start the cycle | `POST /content-cycles` | Available | Send Week 1 context and one stable idempotency key |
| Queue Week 1 | Performed inside cycle creation | Available | Never send a second generate request |
| Cycle identity/status | `GET /content-cycles/:id` | Available | Treat returned cycle fields as authoritative |
| Context history | `GET /content-cycles/:id/weeks` | Available | Shows persisted contexts and provenance only |
| Save context | `PUT /content-cycles/:id/weeks/:week/context` | Available | Server re-derives week number/start and enforces freeze |
| Queue later week | `POST /content-cycles/:id/weeks/:week/generate` | Available | Only expose for the exact next eligible week |
| Latest pack | `GET /content-packs/:id` | Available when its ID is known | Use the latest pack ID from journey or mutation response |
| Pack progress | `GET /content-packs/:id/progress` | Available | Poll only while the pack is active |
| Retry failed pack | `POST /content-packs/:id/retry` | Available | Show only when `failed` and `retry_eligible=true` |
| Every week's pack ID/status/history | No typed cycle-week summary endpoint | **Blocked** | Mark unknown history as unavailable; never infer it |
| Owner approved-photo list/upload | Retrieval exists, list/upload does not | **Blocked** | Show capability notice; preserve existing IDs; add none |
| Pack review destination | Owned by issue #155 | Parallel dependency | Emit the correct href when a known pack is draft-ready |

### 4.1 Readiness gate A: full 12-week pack history

`GET /content-cycles/:id/weeks` currently returns this shape:

```ts
type ContentWeekListResponse = {
  readonly weeks: readonly ContentWeekContext[];
};
```

It does not return a pack ID, pack status, pending decision count, or retry
state for each week. `GET /journey/current` returns only the latest pack.

Slice A must still render 12 structural week slots, context provenance, current
week, next week, and the one latest pack known from journey. For any past week
whose pack is not the latest known pack, show localized copy equivalent to
`Pack history unavailable`, not `Approved`, `Draft`, or `Failed`.

Slice B starts only after the API reviewer supplies an additive typed read
model and exact endpoint. Do not guess a route such as `/summary` or `/packs`.

### 4.2 Readiness gate B: approved owner-photo picker

The current API can download a known asset ID. It cannot list the owner's
approved assets or upload/select a new one. Therefore:

- a new cycle sends `approved_asset_ids: []`;
- an existing context retains every returned `approved_asset_id` unchanged
  when the owner saves other fields;
- the UI displays the retained asset count and explains that adding/removing
  approved photos is not available yet;
- the UI does not render a file input, a fake thumbnail library, or a raw UUID
  field.

Slice B replaces that notice with a real picker only after a reviewed list or
upload/select capability exists.

### 4.3 Transport contract mismatch to record, not hide

The shared type named `GenerateContentWeekResponse` describes generated item
versions and validation. The current HTTP controller actually returns an
accepted queue response from `ContentService.generateWeek`:

```ts
type QueuedContentPackResponse = {
  readonly content_pack: ContentPack;
  readonly status: "queued";
  readonly correlation_id: string;
};
```

The retry endpoint returns the same queue-oriented shape. For this frontend
issue, define an adapter-local transport type named
`QueuedContentPackResponse`, with a comment linking the mismatch for contract
review. Do not lie with a type assertion to `GenerateContentWeekResponse`, and
do not modify shared contracts in this branch.

## 5. Scope

### 5.1 Slice A: implement on the current baseline

- `/content` authenticated entry route.
- `/content/:cycle_id/weeks/:week_number` canonical cycle route.
- exact Strategy approval and profile provenance resolution.
- cycle creation with Week 1 context.
- 12-week ledger with truthful known/unknown states.
- read-only approved Strategy handoff.
- weekly promotion, instructions, CTA, and retained-assets context form.
- context save and freeze handling.
- exact-next-week generation.
- latest-pack progress polling and retry.
- link to `/content/packs/:pack_id` for issue #155.
- English/Arabic dictionaries and structural RTL.
- shared desktop and mobile navigation changes.
- unit, component, and Playwright coverage.

### 5.2 Slice B: implement only when dependencies land

- complete per-week pack history in the ledger;
- per-week pack selection from its real pack ID;
- approved photo listing, selection, upload, removal, and thumbnail display;
- end-to-end click-through into the merged issue #155 pack page.

### 5.3 Out of scope

- item preview, revision, decisions, item history, candidate freezing, or bulk
  pack review; those belong to issue #155;
- pause/resume controls; this issue displays paused/completed states but the
  issue does not request lifecycle administration;
- Strategy or profile editing;
- social scheduling, publishing, analytics, optimization, or spend;
- backend implementation for the missing read models;
- production demo switches or query parameters that replace live API data with
  fixtures.

## 6. Visual direction

### 6.1 Subject, audience, and page job

- **Subject:** one evidence-grounded, owner-controlled 12-week editorial plan.
- **Audience:** Arabic-first and bilingual Egyptian SME owners across
  industries.
- **Single page job:** confirm weekly context and understand the resulting
  draft-generation state.

The memorable element is one continuous editorial ledger. The rest of the
page should be calm, document-like, and easy to verify.

### 6.2 Visual hierarchy

1. Navy thesis header: page purpose, cycle week, Cairo timezone, exact Strategy
   version, and Strategy link.
2. Continuous 12-week ledger: current/next/selected, context provenance, and
   truthful pack state.
3. Readiness/blocker banner when the next safe action is unavailable.
4. Main editorial document: approved Strategy handoff, weekly context, and
   real progress.
5. Sticky owner-control rail on wide screens: readiness, cutoff, consequence,
   and exactly one primary action.

Use the existing IBM Plex Sans/Arabic fonts and only the existing semantic
tokens:

| Meaning | Token | Hex |
| --- | --- | --- |
| Page | `--color-background` | `#F7F8FA` |
| Bounded surface | `--color-surface` | `#FFFFFF` |
| Primary information | `--color-navy` | `#102A43` |
| Confirmed/current | `--color-primary` | `#0B6F71` |
| Owner action | `--color-action` | `#246BFD` |
| Warning/defaulted/frozen | `--color-warning` | `#A15C00` |
| Failure | `--color-danger` | `#B42318` |
| Structure | `--color-border` | `#D9E2EC` |

Color is never the only state signal. Every badge or line marker also includes
visible state text and an icon where useful.

### 6.3 Desktop wireframe

```text
+--------------------------------------------------------------------------------+
| CONTENT CYCLE                                           Africa/Cairo            |
| Turn the approved Strategy into weekly drafts · Week 3 of 12                   |
| Strategy v4 · Owner-approved 2 Aug 2026                    [View Strategy]      |
+--------------------------------------------------------------------------------+
| W1  context confirmed · history unavailable                                    |
| W2  safely defaulted · history unavailable                                     |
| W3  CURRENT + SELECTED · validating                                             |
| W4  NEXT · context open                                                         |
| W5  planned | W6 planned | ... | W12 planned                                   |
| <-------------- one connected, horizontally scrollable editorial ledger ------>|
+------------------------------------------------------+-------------------------+
| MAIN EDITORIAL DOCUMENT                              | OWNER CONTROL           |
|                                                      | sticky on wide screens  |
| APPROVED STRATEGY HANDOFF                            |                         |
| Week 3 theme                                         | Readiness               |
| channels · pillars · tone · language                 | ✓ exact Strategy       |
| capacity · constraints                               | ✓ profile matches      |
| Strategy v4 · decision ID · profile v2               | ✓ Week 3 context       |
| ---------------------------------------------------- |                         |
| WHAT IS HAPPENING THIS WEEK?                         | Context cutoff          |
| Approved photos: capability unavailable              | exact server time       |
| Promotion: ( ) No promotion  ( ) Owner-approved      | or before next week     |
| [offer] [terms] [valid from] [valid until]            |                         |
| [must include — repeatable]                          | Consequence             |
| [must avoid — repeatable]                            | Creates drafts only.    |
| CTA: [type] [confirmed value]                        | Nothing is published.   |
| [Save weekly context]                                |                         |
| ---------------------------------------------------- | [one primary action]    |
| GENERATION PROGRESS                                  |                         |
| queued -> generating -> validating -> draft          |                         |
| server-backed events only                            |                         |
| Draft ready · 4 items                   [Review pack] |                         |
+------------------------------------------------------+-------------------------+
```

The example statuses are illustrative. Production rendering must use known
server data and the explicit unavailable treatment from section 4.

At the existing 1200px content maximum, use
`lg:grid-cols-[minmax(0,1fr)_22rem]`. The rail becomes sticky near the existing
desktop top bar and returns to document flow below the wide breakpoint.

### 6.4 Mobile wireframe

```text
+------------------------------------------+
| Content · Week 3 of 12     Africa/Cairo  |
| Strategy v4                 [View]        |
+------------------------------------------+
| < horizontally scrollable 12-week ledger >|
| W1 | W2 | W3 selected | W4 next | ...   |
+------------------------------------------+
| Readiness or blocker banner              |
+------------------------------------------+
| Approved Strategy handoff                |
| theme · channels · pillars · versions    |
+------------------------------------------+
| What is happening this week?             |
| retained photos / capability notice      |
| promotion choice and conditional fields  |
| include / avoid / CTA                    |
| [Save weekly context]                    |
+------------------------------------------+
| Generation progress or failure           |
+------------------------------------------+
| Owner consequence                        |
| [Start / Generate / Retry / Review]       |
+------------------------------------------+
| shared fixed bottom navigation           |
+------------------------------------------+
```

Mobile uses the same reading order. Do not hide required context or readiness
inside a desktop-style side drawer. The primary action may be visually strong,
but it must not cover focused inputs, errors, or the shared bottom navigation.

### 6.5 Weekly context interaction wireframe

```text
<fieldset>
  Promotion for this week (required)
  ( ) No promotion
      No offer will be added to generated drafts.
  ( ) Owner-approved promotion
      Offer text        [................................]
      Terms             [............................] [+]
      Valid from        [Cairo date and time]
      Valid until       [Cairo date and time]

  Must include          [............................] [+]
  Must avoid            [............................] [+]

  CTA destination (required)
  [None / Phone / WhatsApp / Website / Address]
  Confirmed value       [................................]

  Approved photos
  Existing: 2 retained
  Adding or removing photos is unavailable until the asset library is ready.

  [Save weekly context]
</fieldset>
```

Use native `fieldset`, `legend`, radio inputs, buttons, inputs, `textarea`, and
`select` where their semantics are sufficient. Reuse the existing local
`Button`, `Input`, and `Label` primitives. Do not install a form library or a
second component system.

## 7. Routing and canonical URL behavior

### 7.1 `/[locale]/content`

The route file is a server wrapper that supplies metadata and renders the
client entry component. Protected API calls stay client-side because the
current authenticated API client uses the in-memory access token and refresh
cookie.

Entry behavior:

1. Fetch `GET /journey/current`.
2. If `journey.content?.cycle` exists and its `current_week` is an integer from
   1 to 12, call the locale-aware router's `replace` with:
   `/content/{cycle.id}/weeks/{current_week}`.
3. If the server returns a current week outside 1 through 12, render a localized
   integrity error. Do not clamp it and do not request Week 13.
4. If no cycle exists, resolve the exact approved Strategy and render the
   start workspace.
5. Preserve `/content` as the stable navigation destination; it always resolves
   the owner's current cycle after login.

### 7.2 `/[locale]/content/[cycle_id]/weeks/[week_number]`

In Next.js 16, `params` is a Promise. The route should await it in the server
page and pass plain validated values to a client component.

Required behavior:

- Parse `week_number` before mounting a component that can fetch data.
- Call `notFound()` for non-integers, zero, negative values, or values above
  12. This guarantees `/weeks/13` does not issue content API requests.
- Load the route's cycle and verify that journey data refers to the same cycle
  before using journey's latest pack.
- If journey points to a different current cycle, show a localized stale-route
  state with a link back to `/content`; do not combine one cycle with another
  cycle's pack.
- Week selection changes the URL using `Link` or `router.push`, so refresh,
  browser back, copied URLs, and locale switching preserve the selected week.
- Use `Link` and `useRouter` from `@/i18n/navigation`; use Next's `notFound`
  only for the server validation boundary.

### 7.3 Proxy and shared navigation

Add `content` to `WORKSPACE_SEGMENTS` in `apps/web/src/proxy.ts`. Do not create
another proxy file.

Add Content between Strategy and Publishing in `NAV_ITEMS`:

```text
Discovery -> Dashboard -> Strategy -> Content -> Publishing -> Billing
```

Keep the existing order otherwise. Extend the href, label-key, and icon unions
with `/content`, `navContent`, and a content/editorial icon.

The mobile bottom navigation now has six destinations. Replace the fixed
five-column/truncated-label assumption with an internally scrollable row:

- each destination has a minimum width around 4.5rem;
- labels may wrap to two short lines and must not use `truncate`;
- the nav itself may scroll horizontally, but the document body must not gain
  horizontal overflow;
- leave a partially visible next destination at narrow widths when possible so
  scrollability is understandable;
- keyboard focus must scroll an off-screen destination into view;
- retain safe-area padding and `aria-current="page"`;
- verify English and Arabic at 320px and 375px, plus text zoom.

Do not shrink six labels into unreadable equal columns.

## 8. Target file map and ownership

The names below are the intended structure. A file may be combined only when
it remains small and has one responsibility; do not collapse the whole feature
into one client component.

```text
apps/web/src/app/[locale]/(workspace)/content/page.tsx
apps/web/src/app/[locale]/(workspace)/content/[cycle_id]/weeks/[week_number]/page.tsx

apps/web/src/features/content/cycle/
  components/
    content-cycle-entry.tsx
    content-cycle-workspace.tsx
    cycle-thesis-header.tsx
    content-week-ledger.tsx
    approved-strategy-handoff.tsx
    content-readiness.tsx
    week-context-form.tsx
    content-generation-progress.tsx
    content-cycle-badge.tsx
    __tests__/
      content-cycle-entry.test.tsx
      content-week-ledger.test.tsx
      approved-strategy-handoff.test.tsx
      week-context-form.test.tsx
      content-generation-progress.test.tsx
  hooks/
    use-content-cycle-workspace.ts
    use-content-pack-progress.ts
    __tests__/
      use-content-pack-progress.test.ts
  lib/
    content-cycle-state.ts
    content-cycle-form.ts
    content-cycle-schedule.ts
    content-cycle-errors.ts
    content-cycle-idempotency.ts
    content-cycle-fixtures.ts
    __tests__/
      content-cycle-state.test.ts
      content-cycle-form.test.ts
      content-cycle-schedule.test.ts
      content-cycle-errors.test.ts

apps/web/src/lib/api/content-cycle.ts
apps/web/src/lib/api/__tests__/content-cycle.test.ts
apps/web/e2e/content-cycle.spec.ts

apps/web/src/components/layout/app-shell.tsx
apps/web/src/components/layout/app-shell-mobile-nav.tsx
apps/web/src/components/layout/app-shell-icons.tsx
apps/web/src/components/__tests__/app-shell.test.tsx
apps/web/e2e/mobile-shell.spec.ts
apps/web/src/proxy.ts
apps/web/messages/en.json
apps/web/messages/ar.json
```

### 8.1 Responsibility table

| File | Single responsibility |
| --- | --- |
| route pages | metadata, Next.js 16 param validation, and feature mounting only |
| `content-cycle-entry.tsx` | load journey/Strategy approval and create the cycle |
| `content-cycle-workspace.tsx` | compose the route workspace and coordinate mutations |
| `cycle-thesis-header.tsx` | page purpose, exact version summary, Cairo zone, Strategy link |
| `content-week-ledger.tsx` | semantic 12-week navigation and state text |
| `approved-strategy-handoff.tsx` | immutable plan, provenance, capacity, and constraints |
| `content-readiness.tsx` | blockers, cutoff, consequence, and primary owner action |
| `week-context-form.tsx` | accessible form UI and inline validation presentation |
| `content-generation-progress.tsx` | real pack status/events, failure, retry, and review link |
| `content-cycle-state.ts` | pure entry, ledger, readiness, and action resolvers |
| `content-cycle-form.ts` | form types, validation, initialization, and API serialization |
| `content-cycle-schedule.ts` | Week 1-to-12 date math and Cairo local conversion helpers |
| `content-cycle-errors.ts` | stable error code to translation-key mapping |
| `content-cycle-idempotency.ts` | session-scoped logical-action key lifecycle |
| `content-cycle-fixtures.ts` | test/story fixtures only; never a production data switch |
| `content-cycle.ts` API adapter | authenticated endpoint calls and transport error normalization |
| `use-content-pack-progress.ts` | non-overlapping, visibility-aware server polling |

Every feature component exports one named function. Next.js route pages remain
the only default exports in this feature.

## 9. Domain view models and pure state resolvers

Keep API resources immutable. Convert them to explicit view models instead of
spreading string comparisons throughout JSX.

### 9.1 Exact approved Strategy reference

Define a view model equivalent to:

```ts
type ApprovedContentStrategy = {
  readonly strategyId: string;
  readonly businessId: string;
  readonly strategyVersionId: string;
  readonly strategyVersion: number;
  readonly strategyDecisionId: string;
  readonly decisionAt: string;
  readonly profileVersionId: string;
  readonly profileVersion: number;
  readonly brief: StrategyBrief;
  readonly plan: StrategyPlan;
};
```

`resolveApprovedContentStrategy` returns either this object or a discriminated
blocker. It succeeds only when all checks pass:

1. journey has a confirmed profile;
2. `future_phase.availability === "available"` and supplies a Strategy ID;
3. `getStrategy` returns that same ID and business ID;
4. Strategy status is exactly `approved`;
5. `currentVersionId`, `brief`, and `latestPlan` all exist;
6. one version summary has `version_id === currentVersionId`;
7. that summary is `approved` and has `decision.decision === "approved"`;
8. summary version, plan version, and decision strategy version are equal;
9. the summary's profile ID, plan profile ID, brief profile ID, and journey's
   active confirmed profile ID are equal;
10. the plan contains exactly one roadmap entry for every week 1 through 12.

Return distinct blocker keys for no profile, no Strategy, Strategy in progress,
Strategy awaiting approval, missing approval receipt, stale profile, malformed
12-week plan, and provenance mismatch. Never convert a mismatch into a generic
ready state.

For an existing cycle, perform the same resolution and additionally require
the cycle's `strategy_id`, `strategy_version`, `strategy_decision_id`, and
`profile_version_id` to match. If they do not, render a blocking provenance
error and disable all mutations.

### 9.2 Page state

Use discriminated unions. Do not represent page readiness with unrelated
booleans.

```ts
type ContentEntryState =
  | { phase: "loading" }
  | { phase: "load_error"; errorKey: ContentErrorKey }
  | { phase: "redirecting"; cycleId: string; week: number }
  | { phase: "blocked"; reason: ContentEntryBlocker; destination: string | null }
  | { phase: "ready_to_start"; approved: ApprovedContentStrategy };

type ContentWorkspaceState =
  | { phase: "loading" }
  | { phase: "load_error"; errorKey: ContentErrorKey }
  | { phase: "stale_route"; currentCycleId: string | null }
  | { phase: "provenance_blocked"; reason: ContentEntryBlocker }
  | { phase: "ready"; snapshot: ContentWorkspaceSnapshot };
```

Store the smallest authoritative remote snapshot. Derive ledger slots,
readiness rows, form editability, and the primary action with pure functions.
Do not duplicate them in React state.

### 9.3 Week ledger slot

Build exactly 12 slots with `Array.from({ length: 12 }, (_, index) => index + 1)`.

```ts
type ContentWeekSlot = {
  readonly weekNumber: number;
  readonly href: `/content/${string}/weeks/${number}`;
  readonly isSelected: boolean;
  readonly timing: "past" | "current" | "next" | "future";
  readonly context:
    | { kind: "owner_confirmed"; value: ContentWeekContext }
    | { kind: "system_defaulted"; value: ContentWeekContext }
    | { kind: "not_saved" };
  readonly pack:
    | { kind: "known"; id: string; status: ContentPackStatus; pendingDecisions: number | null }
    | { kind: "not_eligible_yet" }
    | { kind: "history_unavailable" };
};
```

Rules:

- `journey.content.pack` is usable only when its cycle and week match the route
  snapshot.
- Fetch that known pack to obtain `retry_eligible` and `item_ids`.
- A future week greater than `current_week + 1` cannot yet have been manually
  generated under the current API rules, so it may be `not_eligible_yet`.
- A past or current week without a known pack ID is
  `history_unavailable`, not assumed complete.
- Context is known independently from pack history because the weeks endpoint
  returns contexts.
- The selected state uses `aria-current="page"`; the temporal current-week
  state is separate visible text.

### 9.4 Primary action resolver

`resolveContentPrimaryAction` should return one of these explicit variants:

```text
go_to_discovery
go_to_strategy
review_strategy
start_cycle
save_context
generate_week
retry_generation
review_pack
refresh_status
none
```

The resolver applies this priority:

1. provenance or load blocker;
2. cycle paused/completed treatment;
3. known failed latest pack with retry eligibility;
4. known draft/partially-approved/approved pack with review link;
5. active generation treatment;
6. unsaved editable context;
7. saved context for the exact next eligible week;
8. future planning or read-only history.

Never expose `generate_week` for Week 1 after cycle creation. If Week 1's pack
ID is temporarily missing, expose `refresh_status`; the server already owns
the Week 1 queue claim.

## 10. API adapter specification

Create `apps/web/src/lib/api/content-cycle.ts` using the existing
`apiRequest` client and snake_case contract shapes.

Export these functions:

```ts
createContentCycle(
  payload: CreateContentCycleRequest,
  signal?: AbortSignal,
): Promise<ContentCycleResponse>

getContentCycle(
  cycleId: string,
  signal?: AbortSignal,
): Promise<ContentCycle>

listContentWeeks(
  cycleId: string,
  signal?: AbortSignal,
): Promise<ContentWeekListResponse>

updateContentWeekContext(
  cycleId: string,
  weekNumber: number,
  payload: UpdateContentWeekContextRequest,
  signal?: AbortSignal,
): Promise<ContentWeekContext>

generateContentWeek(
  cycleId: string,
  weekNumber: number,
  payload: GenerateContentPackRequest,
  signal?: AbortSignal,
): Promise<QueuedContentPackResponse>

getContentPack(
  packId: string,
  signal?: AbortSignal,
): Promise<ContentPack>

getContentPackProgress(
  packId: string,
  signal?: AbortSignal,
): Promise<readonly ContentProgressEvent[]>

retryContentPack(
  packId: string,
  signal?: AbortSignal,
): Promise<QueuedContentPackResponse>
```

Endpoint mapping:

| Function | Request |
| --- | --- |
| `createContentCycle` | `POST /content-cycles` |
| `getContentCycle` | `GET /content-cycles/:id` |
| `listContentWeeks` | `GET /content-cycles/:id/weeks` |
| `updateContentWeekContext` | `PUT /content-cycles/:id/weeks/:week/context` |
| `generateContentWeek` | `POST /content-cycles/:id/weeks/:week/generate` |
| `getContentPack` | `GET /content-packs/:id` |
| `getContentPackProgress` | `GET /content-packs/:id/progress` |
| `retryContentPack` | `POST /content-packs/:id/retry` |

Use one normalized error type:

```ts
type ContentCycleApiError = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
};
```

The adapter may retain `message` for diagnostics, but components receive a
localized error key from `content-cycle-errors.ts`. JSX must not display the
raw message.

Pass payload objects to `apiRequest`; its `buildBody` already serializes JSON.
Do not create a second token or refresh implementation.

## 11. Data-loading and mutation flows

### 11.1 No-cycle entry load

```text
getCurrentJourney
  |
  +-- cycle exists --> validate week 1..12 --> replace canonical URL
  |
  +-- no cycle
       |
       +-- no available Strategy --> blocker and recovery destination
       |
       +-- Strategy ID exists
            --> Promise.all(getStrategy, getStrategyVersions)
            --> resolveApprovedContentStrategy
            --> ready-to-start or exact blocker
```

Do not fetch Strategy resources until a Strategy ID exists. Once it exists,
fetch the Strategy and versions in parallel.

### 11.2 Existing cycle route load

Use this order to avoid unnecessary waterfalls while respecting the fact that
the Strategy ID lives on the cycle:

```text
Promise.all(
  getContentCycle(route cycle ID),
  listContentWeeks(route cycle ID),
  getCurrentJourney(),
)
  -> verify route cycle against journey
  -> Promise.all(
       getStrategy(cycle.strategy_id),
       getStrategyVersions(cycle.strategy_id),
       known latest pack? getContentPack(pack.id) : resolved null,
       known latest pack? getContentPackProgress(pack.id) : resolved [],
     )
  -> resolve exact provenance
  -> build one workspace snapshot
```

If the latest pack becomes known only after the first journey read, the pack
polling hook may attach after a refresh. Do not request every possible pack ID;
they are not available.

### 11.3 Create cycle

The start button remains unavailable until the weekly form is valid and the
exact Strategy resolver succeeded.

Construct this payload:

```ts
{
  business_id: approved.businessId,
  strategy_id: approved.strategyId,
  strategy_version: approved.strategyVersion,
  strategy_decision_id: approved.strategyDecisionId,
  idempotency_key: stableLogicalActionKey,
  initial_week_context: serializeWeekContext(form, {
    weekNumber: 1,
    weekStartDate: cairoDateFromStrategyStart(approved.brief.start_date),
    retainedAssetIds: [],
  }),
}
```

After success:

1. retain the returned cycle ID and initial context;
2. clear the completed create-action key;
3. route to `/content/{cycle.id}/weeks/1`;
4. discover the server-created Week 1 pack by refreshing journey;
5. if the pack is not visible after a short bounded discovery period, show
   `Queue status is not available yet` and a Refresh action;
6. never compensate by calling Week 1 generate.

The bounded discovery checks server state. It must not animate fake lifecycle
progress.

### 11.4 Save weekly context

1. Validate the form locally.
2. Derive `week_number` and `week_start_date`; never let the owner edit them.
3. Preserve returned `approved_asset_ids` exactly until the real asset picker
   exists.
4. Send the `PUT` once and disable duplicate submission.
5. Replace the local context with the server response, including authoritative
   `generation_cutoff_at`, `weekly_claim_id`, provenance, and confirmed time.
6. If the server returns `CONTENT_WEEK_ALREADY_CLAIMED`, refetch cycle/weeks,
   retain the unsent owner text in the browser long enough to copy it, and show
   localized frozen/defaulted treatment. Do not report a successful save.

Context editability is server-authoritative. The client may predict that a
date has passed to disable an obviously stale form, but any mutation conflict
must refetch and display the returned state.

### 11.5 Generate a later week

Expose generation only when all are true:

- cycle status is `active`;
- selected week is exactly `cycle.current_week_number + 1`;
- selected week is at most 12;
- a persisted context exists for the selected week;
- no known pack already exists for that week;
- provenance checks pass;
- no mutation is already in flight.

Build the request with route and body identities equal:

```ts
{
  content_cycle_id: cycle.id,
  week_number: selectedWeek,
  idempotency_key: stableLogicalActionKey,
}
```

Use the returned `content_pack.id` immediately, begin real polling, and refresh
cycle/journey when the pack becomes terminal.

Although the backend can create a safe default when manual generation has no
saved context, this UI should not silently turn an owner-clicked Generate
action into a safe-default decision. Ask the owner to save an explicit weekly
context first. The scheduler remains responsible for unattended safe defaults.

### 11.6 Retry

Show Retry only when the known pack has `status === "failed"` and
`retry_eligible === true`.

- one click sends one retry request;
- disable it while pending;
- use the returned queued pack and restart polling;
- on `CONTENT_PACK_RETRY_CONFLICT`, refetch authoritative pack state;
- a failed pack with `retry_eligible=false` gets explanation and Refresh, not a
  disabled mystery button.

## 12. Idempotency-key lifecycle

Implement session-scoped keys so a browser refresh after an uncertain network
response can safely retry the same logical action. A logical action includes
the normalized request content, not only the route identity.

Suggested storage identities:

```text
content-cycle:create:{strategyId}:{strategyVersion}:{decisionId}
content-cycle:generate:{cycleId}:{weekNumber}
```

Rules:

1. Build the final normalized request without `idempotency_key`, serialize it
   with stable field order, and hash it with browser `crypto.subtle.digest`
   using SHA-256. Do not store raw promotion, instruction, or CTA text in
   `sessionStorage`.
2. Store an object equivalent to `{ idempotencyKey, requestFingerprint }` for
   the action scope.
3. `getOrCreate(scope, requestFingerprint)` returns the stored UUID only when
   the fingerprint also matches; otherwise it creates a new key with
   `crypto.randomUUID()` and replaces the stored entry.
4. Keep the key after a network failure or ambiguous 5xx response.
5. Clear it only after an authoritative success, after journey proves the
   resource exists, or after the owner changes the logical input enough to
   create a genuinely new action.
6. Never reuse a Week 2 key for Week 3.
7. Never reuse a cycle-create key for another Strategy version/decision or a
   changed Week 1 context payload.
8. Do not send idempotency keys to the context `PUT` or retry endpoint because
   those DTOs do not accept them.

Guard access to `sessionStorage` and `crypto` inside client-only functions so
tests and server route wrappers do not evaluate browser globals.

## 13. Weekly context form specification

### 13.1 Form state

Use a UI-specific mutable draft, then serialize to the immutable contract.

```ts
type WeekContextDraft = {
  promotionMode: null | "none" | "owner_approved";
  promotionText: string;
  promotionTerms: readonly string[];
  validFromLocal: string;
  validUntilLocal: string;
  mustInclude: readonly string[];
  mustAvoid: readonly string[];
  ctaType: null | "phone" | "whatsapp" | "website" | "address" | "none";
  ctaValue: string;
  retainedAssetIds: readonly string[];
};
```

Do not default the promotion choice. The owner must explicitly choose
no-promotion or owner-approved promotion. Also require an explicit CTA type;
`none` is a valid deliberate choice.

### 13.2 Field rules

| Field | UI control | Validation and serialization |
| --- | --- | --- |
| Promotion mode | radio group in `fieldset` | required; visible consequence for each choice |
| Offer text | text input or textarea | required and trimmed only for `owner_approved` |
| Terms | repeatable text rows | trim, drop blank rows, preserve owner wording |
| Valid from/until | `datetime-local` | required for promotion; convert as Cairo; from must precede until |
| Must include | repeatable text rows | trim and drop blank rows; do not translate |
| Must avoid | repeatable text rows | trim and drop blank rows; do not translate |
| CTA type | native select or radio group | required |
| CTA value | input | required and trimmed unless CTA type is `none` |
| Approved photos | read-only retained count plus notice | preserve existing IDs; new cycle sends `[]` |

Do not invent contract maximums that the server does not define. Prevent blank
repeatable rows from entering the request, and use stable row IDs so removing a
row does not move focus unpredictably.

### 13.3 Promotion serialization

When mode is `none`, send exactly:

```ts
{
  promotion_mode: "none",
  promotion: null,
}
```

Do not include offer text, terms, `valid_from`, or `valid_until` anywhere else
in the body. Tests must inspect the serialized request.

When mode is `owner_approved`, send:

```ts
{
  promotion_mode: "owner_approved",
  promotion: {
    text: trimmedOwnerText,
    terms: trimmedNonBlankTerms,
    valid_from: cairoLocalDateTimeToIso(validFromLocal),
    valid_until: cairoLocalDateTimeToIso(validUntilLocal),
  },
}
```

### 13.4 CTA serialization

- `none` serializes as `{ type: "none", value: null }`.
- every other type requires a nonblank owner-confirmed value and preserves that
  value unchanged apart from surrounding whitespace.
- do not silently normalize Egyptian phone numbers or rewrite URLs without a
  reviewed business rule.

### 13.5 Cairo date/time helpers

Never hardcode Cairo as `+02:00` or `+03:00`; daylight-saving rules differ by
date and may change.

Implement and test pure helpers using `Intl.DateTimeFormat` with
`timeZone: "Africa/Cairo"`:

- ISO instant -> Cairo `datetime-local` value;
- Cairo local date/time -> ISO instant using the runtime's zone offset;
- Strategy start instant -> Cairo `YYYY-MM-DD`;
- add exactly seven calendar days per week without fixed millisecond math;
- reject a local time that cannot round-trip through the zone formatter.

Use server `generation_cutoff_at` whenever a context exists. Before the server
has persisted a future context, display a truthful relative statement such as
`Before Week 4 begins in Africa/Cairo`, rather than inventing an exact 6 PM
cutoff from the wireframe.

## 14. Approved Strategy handoff

This section is read-only. It should show only exact approved-plan data:

- selected week's theme from `plan.content_strategy.weeks`;
- selected channels and their primary/supporting role;
- content pillars from `plan.content_strategy.pillars`;
- tone from `plan.tone`;
- plan language;
- weekly cadence;
- team capacity from the Strategy brief;
- owner constraints from the Strategy brief;
- Strategy number and immutable version ID;
- approval decision ID and decision time;
- confirmed profile number and immutable profile ID.

Use localized labels around plan/owner text, but render the actual theme,
pillar, tone, capacity, and constraints unchanged inside `<bdi>` where mixed
direction is possible.

Show compact version numbers normally. Put full UUIDs in an accessible
`details/summary` provenance disclosure so the page remains readable while the
exact identities remain inspectable.

The Strategy link is `/strategy/{strategyId}/review`. This page does not offer
edit controls.

## 15. Context provenance and cutoff treatment

### 15.1 Owner-confirmed

Show:

- `Confirmed by owner` text;
- confirmed time in the active locale and Cairo timezone;
- exact cutoff time;
- editable state only if cycle is active, the cutoff has not passed, and the
  context is not frozen by a pack;
- owner-entered fields unchanged.

### 15.2 System-defaulted

Show a warning treatment with explicit copy:

```text
Safe default used
No owner context was confirmed before this week was claimed. MarketMind used
promotion-free defaults and did not invent an offer.
```

The form is read-only. Do not style this as owner confirmation and do not offer
Save.

### 15.3 Not saved

Show `Context open` only when it is still legitimately editable. If the client
believes the cutoff has passed but the server has not yet returned a context,
show `Status needs refresh` and fetch again rather than letting the owner submit
into a known conflict.

## 16. Generation progress and polling

### 16.1 Authoritative states

Map `ContentPack.status` to localized owner states:

| Pack status | Owner label | Poll? | Primary treatment |
| --- | --- | --- | --- |
| `queued` | Waiting to start | yes | calm pending state |
| `generating` | Creating weekly drafts | yes | active progress |
| `validating` | Checking drafts | yes | active progress |
| `draft` | Draft pack ready | no | review link |
| `partially_approved` | Review still needed | no | review link |
| `approved` | Pack approved | no | view pack link |
| `failed` | Generation stopped | no | retry only if eligible |

Progress events explain completed stages, but the pack resource determines the
current lifecycle. Sort events by `seq`, de-duplicate repeated sequence values,
and map `stage`/`status` or known `message_key` values to local translation
keys. Never show `message_text` directly.

### 16.2 Polling algorithm

Use recursive `setTimeout`, not `setInterval`, so slow requests cannot overlap.

1. Fetch pack and progress in parallel immediately.
2. If status is active and the tab is visible, schedule the next read about two
   seconds after the current read settles.
3. If `document.visibilityState === "hidden"`, cancel the timer and wait for a
   `visibilitychange` event.
4. When the tab becomes visible, refresh immediately.
5. Abort in-flight reads and remove listeners on unmount or pack-ID change.
6. Stop permanently for `draft`, `partially_approved`, `approved`, or `failed`.
7. Track a read error as a localized visible state with Refresh. Do not erase
   the last known pack or pretend it progressed.
8. On terminal state, ask the parent workspace to refresh journey/cycle once.

Tests use fake timers and a mocked visibility state to prove no overlap,
hidden-tab pause, visibility refresh, and terminal stop.

## 17. Stable error localization

Create a pure `contentErrorKey(error)` mapper. Include at least these codes:

```text
CONTENT_STRATEGY_NOT_APPROVED
CONTENT_PROFILE_STALE
CONTENT_CYCLE_PAUSED
CONTENT_CYCLE_COMPLETED
CONTENT_WEEK_OUT_OF_RANGE
CONTENT_WEEK_ALREADY_CLAIMED
CONTENT_PROVIDER_FAILURE
CONTENT_PACK_NOT_FAILED
CONTENT_RETRY_NOT_ALLOWED
CONTENT_PACK_RETRY_CONFLICT
```

Also handle HTTP/status classes:

- 400: invalid request;
- 401: session expired;
- 403: permission unavailable;
- 404: cycle or pack not found;
- 409: state changed; refresh required;
- 429: too many Content actions; wait and retry;
- 5xx/network: service temporarily unavailable;
- unknown: generic localized failure with Refresh.

Specific code mapping wins over status mapping. Log raw diagnostic data only
through the project's accepted development path; never place server text in
the DOM.

## 18. Translation namespace

Add a top-level `ContentCycle` object to both dictionaries and `navContent` to
`Common`.

Use this key structure as the baseline:

```text
ContentCycle
  metadata
    entryTitle
    weekTitle
  header
    eyebrow
    title
    entryTitle
    subtitle
    weekOfTotal
    timezone
    strategyVersion
    approvedAt
    viewStrategy
  entry
    loading
    loadError
    noProfileTitle/body/action
    noStrategyTitle/body/action
    strategyPreparingTitle/body
    approvalRequiredTitle/body/action
    staleProfileTitle/body/action
    malformedPlanTitle/body
    readyTitle/body
  ledger
    label
    week
    selected
    current
    next
    past
    future
    contextOpen
    ownerConfirmed
    systemDefaulted
    notSaved
    packHistoryUnavailable
    notEligibleYet
    pendingDecisions
  strategy
    label
    title
    theme
    channels
    primaryChannel
    supportingChannel
    pillars
    tone
    language
    cadence
    capacity
    constraints
    noConstraints
    provenance
    strategyVersionId
    decisionId
    profileVersion
    profileVersionId
  context
    label
    title
    body
    promotionLegend
    noPromotion
    noPromotionHelp
    approvedPromotion
    approvedPromotionHelp
    offer
    terms
    addTerm
    removeTerm
    validFrom
    validUntil
    mustInclude
    mustAvoid
    addInstruction
    removeInstruction
    ctaLegend
    ctaType
    ctaValue
    ctaTypes.none/phone/whatsapp/website/address
    assets
    retainedAssets
    assetCapabilityUnavailable
    save
    saving
    saved
    frozen
    cutoff
    relativeCutoff
    safeDefaultTitle/body
    errors.*
  progress
    label
    title
    statuses.queued/generating/validating/draft/partiallyApproved/approved/failed
    stages.queued/context/generating/validating/ready/failed
    loadError
    retryableBody
    nonRetryableBody
    itemCount
  readiness
    label
    readyTitle
    blockedTitle
    strategyApproved
    profileMatches
    weeklyPlanReady
    contextConfirmed
    contextNeeded
    assetsOptionalUnavailable
    cyclePaused
    cycleCompleted
    consequenceTitle
    consequenceBody
  actions
    startCycle
    startingCycle
    saveContext
    generateWeek
    generatingWeek
    retryGeneration
    retryingGeneration
    reviewPack
    refresh
    goToDiscovery
    goToStrategy
    reviewStrategy
  errors
    strategyNotApproved
    profileStale
    cyclePaused
    cycleCompleted
    weekOutOfRange
    weekAlreadyClaimed
    providerFailure
    packNotFailed
    retryNotAllowed
    retryConflict
    badRequest
    unauthorized
    forbidden
    notFound
    conflict
    rateLimited
    unavailable
    unknown
    provenanceMismatch
    staleRoute
    invalidServerWeek
```

All visible strings, placeholders, button labels, helper text, status text,
error text, and ARIA labels come from the dictionaries. Run dictionary parity
after every key change.

Arabic should be natural owner-facing Arabic consistent with the existing
application. Do not translate business names, owner instructions, offer text,
CTA values, Strategy claims, UUIDs, or server-authored owner content.

## 19. Accessibility, RTL, responsive, and motion requirements

### 19.1 Semantics and keyboard

- One page `h1`; section headings follow a logical hierarchy.
- The ledger is a `<nav>` containing an `<ol>` of links.
- The selected week link uses `aria-current="page"`.
- Promotion fields are inside a `fieldset` with a visible `legend`.
- Repeatable-row remove buttons name the row they remove.
- Validation summary uses `role="alert"`; fields use `aria-invalid` and
  `aria-describedby`.
- Mutation success uses a restrained `role="status"` live region.
- Progress status uses polite announcements and must not re-announce an
  unchanged state every two seconds.
- Focus moves to the first invalid field after a failed client validation.
- After a successful mutation, focus moves to the resulting status heading,
  not back to the page top.
- Every icon is decorative unless it conveys state that has no adjacent text.

### 19.2 RTL and protected mixed content

- Use logical `start/end`, `ms/me`, and `ps/pe` utilities.
- Directional icons use `rtl:scale-x-[-1]`.
- Let the 12-week chronology follow document direction; do not force the whole
  Arabic ledger into LTR.
- Wrap UUIDs, ISO timestamps, phone numbers, URLs, and mixed owner text with
  `<bdi>` or the existing `.bidi-iso` helper where needed.
- Test long Arabic labels and long unbroken technical values.

### 19.3 Responsive checks

Verify at minimum:

- 1440 x 900 desktop;
- 1280 x 720 desktop;
- 768px tablet;
- 375 x 812 mobile;
- 320 x 568 narrow mobile;
- English LTR and Arabic RTL for each material layout;
- 200% browser text zoom;
- no document-level horizontal overflow.

Internal horizontal scrolling is allowed only for the editorial ledger and
mobile bottom navigation, both with visible/focusable content.

### 19.4 Reduced motion

- No ambient animation.
- A short state transition or selected-week scroll may be used only for
  orientation.
- Use immediate behavior under `prefers-reduced-motion: reduce`.
- Do not pulse terminal success, safe-default, or failure states.

## 20. Implementation phases for Gemini

Gemini should implement one phase at a time, run the phase checks, inspect the
diff, and only then continue. It must not claim completion when a gate in
section 4 is still open.

### Phase 0 — Baseline and guardrails

Actions:

1. Confirm `git status --short` and preserve all unrelated user changes.
2. Run the approved doctor command.
3. Read every source in section 2.
4. Run the current web checks before editing.
5. Record any pre-existing failure separately.

Commands:

```bash
npm run agent:doctor -- --available-mcp context7
npm run check -w @marketmind/web
npm run build -w @marketmind/web
```

Exit condition: baseline is understood and failures are not attributed to this
issue.

### Phase 1 — Pure contracts, state, scheduling, and fixtures

Actions:

1. Add the API adapter and adapter tests.
2. Add exact Strategy resolver, ledger builder, action resolver, form
   serializer, Cairo helpers, idempotency helper, and error localization.
3. Add contract-aligned test fixtures for:
   - no cycle;
   - unapproved Strategy;
   - stale profile;
   - active, paused, and completed cycles;
   - owner-confirmed and system-defaulted contexts;
   - queued, generating, validating, draft, and failed packs;
   - retryable and non-retryable failure;
   - missing pack-history capability;
   - retained asset IDs with unavailable picker.
4. Keep fixtures out of production route selection.

Tests:

- every API method, URL, method, body, error shape, and abort signal;
- exact approval-resolution success and each mismatch;
- exactly 12 unique weeks and no Week 13;
- promotion-none serialization contains `promotion: null` and no nested data;
- owner-approved promotion and Cairo conversions;
- retained asset IDs survive serialization;
- primary-action priority;
- stable error mapping never returns server text.

Exit condition: all pure behavior passes before JSX is built.

### Phase 2 — Routes, proxy, dictionaries, and shared navigation

Actions:

1. Add both route pages and metadata.
2. Validate dynamic week params in the server route.
3. Add `content` to the existing proxy set.
4. Add `navContent` and the `ContentCycle` namespace to both dictionaries.
5. Insert Content between Strategy and Publishing in desktop/mobile nav.
6. Adapt mobile nav to the six-item scrollable layout.
7. Extend app-shell unit and mobile-shell Playwright coverage.

Exit condition: `/content` is protected, navigation has six accessible
destinations, dictionaries match, and invalid Week 13 makes no API call.

### Phase 3 — Entry workspace and exact start gate

Actions:

1. Build entry loading, failure, blocked, and ready states.
2. Load current journey and exact Strategy/version resources.
3. Build the thesis header, approved handoff, readiness, and Week 1 context
   form.
4. Implement cycle creation with stable idempotency.
5. Redirect using the returned cycle ID.
6. Prove no Week 1 generate request exists anywhere in the frontend flow.

Exit condition: an exact approved Strategy can start one cycle; every other
state has a truthful blocker and recovery link.

### Phase 4 — Existing cycle, ledger, and context workflow

Actions:

1. Build the route data loader and provenance cross-check.
2. Build the semantic 12-week ledger.
3. Build selected-week Strategy handoff.
4. Initialize the form from a returned owner context.
5. Render safe-default context as immutable.
6. Implement future context save and authoritative refresh.
7. Show unknown pack history honestly.

Exit condition: route refresh and browser history preserve the selected week,
and no ledger state is fabricated.

### Phase 5 — Generation, polling, failure, and pack link

Actions:

1. Implement exact-next-week generation.
2. Attach the returned pack to the polling hook.
3. Render localized server lifecycle stages.
4. Stop polling in all terminal states and while hidden.
5. Implement retry gating and conflicts.
6. Render `/content/packs/{packId}` only for a known ready/reviewable pack.

Exit condition: progress always comes from API reads; failure is visible; only
retryable failure has Retry.

### Phase 6 — Component and E2E verification

Add component tests and `apps/web/e2e/content-cycle.spec.ts` with the scenario
matrix in section 21. Use Playwright route mocks that return contract-aligned
responses and record mutation bodies/call counts.

Exit condition: targeted unit and E2E tests pass in both desktop Chromium and
the configured mobile project.

### Phase 7 — Visual and accessibility audit

Actions:

1. Run the page interactively in English and Arabic.
2. Capture desktop/mobile screenshots for ready, safe-default, generating,
   draft, and failure states.
3. Verify keyboard order, focus after errors/mutations, screen-reader names,
   zoom, reduced motion, RTL, and protected text.
4. Run the final web-design-guidelines review.
5. Fix high- and medium-severity findings inside issue scope.

Exit condition: no open frontend-owned accessibility or responsive defect.

### Phase 8 — Final checks and handoff

Run:

```bash
npm run check -w @marketmind/web
npm run build -w @marketmind/web
npm run test:e2e -w @marketmind/web -- content-cycle.spec.ts --project=chromium
npm run test:e2e -w @marketmind/web -- content-cycle.spec.ts --project=mobile-chrome
```

Then report:

- files changed;
- commands and results;
- screenshots reviewed;
- Slice A acceptance satisfied;
- the two Slice B gates still open;
- whether issue #155 was available for click-through testing;
- no Week 1 generate call was added.

## 21. Required test matrix

### 21.1 API adapter tests

- `POST /content-cycles` sends the exact snake_case payload.
- `GET /content-cycles/:id` returns the shared cycle shape.
- `GET /content-cycles/:id/weeks` returns contexts only.
- context `PUT` uses the same route/body week number.
- generation `POST` uses the actual queued transport response.
- pack and progress reads use the known pack ID.
- retry posts once.
- non-JSON errors retain a safe status/code fallback.
- nested and top-level error codes normalize consistently.
- supplied AbortSignal reaches `fetch` through `apiRequest`.

### 21.2 Pure-state tests

- no confirmed profile blocks Content.
- unavailable Strategy blocks start.
- approved status without an approval decision blocks start.
- a decision for a different version blocks start.
- a stale profile blocks start.
- a malformed roadmap missing Week 12 blocks start.
- an exact approved Strategy resolves all immutable IDs.
- ledger has weeks 1 through 12 exactly once.
- current and selected are independent labels.
- latest journey pack is attached only to its matching cycle/week.
- past unknown pack is `history_unavailable`.
- Week 13 cannot produce a view model or action.
- Week 1 never resolves to manual generation.

### 21.3 Form tests

- promotion mode is initially unselected for a new context.
- choosing no promotion hides conditional fields and serializes `null`.
- promotion requires text and valid Cairo date range.
- repeated blank rows are removed from the payload.
- CTA none serializes `value: null`.
- a non-none CTA requires a value.
- owner Arabic/English mixed text is submitted unchanged.
- existing approved asset IDs are preserved.
- unavailable asset capability exposes no upload/UUID control.
- validation sends focus to the first invalid field.

### 21.4 Component tests

- ledger is a navigation list with 12 week links.
- current, selected, next, defaulted, and history-unavailable states have text.
- Strategy handoff displays exact version/profile provenance.
- protected Strategy/owner text is unchanged.
- safe default is read-only and not labeled owner-confirmed.
- paused and completed cycles expose no save/generate action.
- progress never renders a raw server `message_text` fixture.
- retry exists only for retryable failed pack.
- review link targets `/content/packs/{packId}`.

### 21.5 Polling-hook tests

- immediate pack/progress read;
- one request pair at a time;
- next timer begins after settlement;
- hidden tab cancels/pause polling;
- visible tab refreshes immediately;
- draft stops polling;
- failed stops polling;
- changing pack ID aborts the prior sequence;
- unmount removes timers/listeners and prevents state updates.

### 21.6 Playwright scenarios

1. Unauthenticated `/en/content` redirects through the existing login flow.
2. Exact approved Strategy starts a cycle with explicit no-promotion and CTA
   choices.
3. The cycle-create route is called once even after a double click.
4. No request matching `/weeks/1/generate` occurs.
5. Existing `/content` redirects to the canonical current-week URL.
6. Refresh on the canonical route restores the same selected week.
7. Ledger renders W1 through W12 and no W13.
8. Owner-confirmed and safe-default contexts have distinct visible copy.
9. Week 2 context saves, then Week 2 generation queues with one idempotency key.
10. Server responses drive queued -> generating -> validating -> draft.
11. Draft exposes the issue #155 pack href.
12. Retryable failure posts once and restarts polling.
13. Non-retryable failure has no Retry button.
14. Paused and completed cycles are read-only.
15. Invalid `/weeks/13` does not call content APIs.
16. Arabic route has `dir=rtl`, Arabic controls, and unchanged owner text.
17. English route has `dir=ltr` and the same feature set.
18. Mobile navigation exposes Content and every other destination without
    clipped labels.
19. Narrow viewport has no document-level horizontal overflow.
20. Material English/Arabic desktop/mobile screenshots are captured.

## 22. Acceptance traceability

| Issue acceptance | Implementation proof | Status on baseline |
| --- | --- | --- |
| `/content` authenticated and in nav | proxy, app shell, auth E2E | Implement now |
| exact approved Strategy only | pure resolver + entry E2E | Implement now |
| exact Strategy/profile identities visible | handoff + component test | Implement now |
| exactly 12 weeks, never Week 13 | route validation + ledger tests | Implement now |
| textual cycle/context/pack states | ledger/readiness components | Partial: full old pack history gated |
| explicit promotion choice | form validation/E2E | Implement now |
| no promotion removes promotion payload | serializer/API assertion | Implement now |
| safe default visibly distinct | provenance component/E2E | Implement now |
| cycle queues Week 1 exactly once | call-count and forbidden-route assertion | Implement now |
| real server progress only | polling tests/E2E | Implement now for known latest pack |
| retry only when eligible | state resolver/component/E2E | Implement now |
| pack review href | component/E2E href assertion | Implement now; destination owned by #155 |
| no raw server messages | localization tests | Implement now |
| Arabic/English parity | dictionary check and E2E | Implement now |
| usable six-item mobile nav | shell tests and manual zoom | Implement now |
| keyboard/focus/zoom/reduced motion | component, E2E, human audit | Implement now |
| approved photo picker | real asset-list interaction | **Blocked by API gate B** |
| truthful full 12-week pack history | additive per-week pack read model | **Blocked by API gate A** |
| web check and production build | final commands | Implement now |

## 23. Stop conditions and prohibited shortcuts

Gemini must stop the affected subtask and report the exact blocker if any of
these occur:

- API behavior differs from the audited controller/service;
- Strategy version history lacks an exact approval decision;
- the implementing branch contains overlapping unrelated user changes;
- the dictionary checker reveals unrelated pre-existing drift;
- the requested full history or asset picker still has no real endpoint;
- issue #155's route contract differs from `/content/packs/[pack_id]`;
- a new dependency appears necessary;
- the agent cannot run the required web check or production build.

Allowed progress while a stop condition is isolated:

- continue pure/UI work that does not depend on the missing capability;
- keep the gated state visibly unavailable;
- write a focused follow-up note for the reviewer.

Prohibited shortcuts:

- fake API fixture mode in production;
- `as unknown as` to hide the queued-response mismatch;
- raw `any` for API payloads;
- hardcoded English/Arabic JSX;
- raw server errors/progress text in the DOM;
- inferred pack status;
- duplicate Week 1 generation;
- disabled buttons with no explanation;
- silent data loss of retained asset IDs;
- hardcoded Cairo UTC offset;
- unbounded or overlapping polling.

## 24. Suggested commit sequence

Keep review slices small enough for Ahmed to explain and test:

1. `feat(content-web): add typed cycle adapter and state resolvers`
2. `feat(content-web): add protected routes and workspace navigation`
3. `feat(content-web): build exact strategy start gate`
4. `feat(content-web): build 12-week editorial ledger and handoff`
5. `feat(content-web): add weekly context workflow`
6. `feat(content-web): add generation progress and retry`
7. `test(content-web): cover cycle flow in both locales`
8. `fix(content-web): address responsive and accessibility audit`

Do not commit automatically unless Ahmed explicitly asks the implementing
agent to commit.

## 25. Ready-to-paste Gemini implementation prompt

```text
You are implementing GitHub issue #154 in the MarketMind AI repository.

Your authoritative implementation plan is:
Docs/planning/sprint-5/ISSUE_154_CONTENT_CYCLE_FRONTEND_IMPLEMENTATION_PLAN.md

Read that file completely before editing anything. Then read every mandatory
source listed in its section 2, including AGENTS.md, apps/web/AGENTS.md, the
project-local frontend workflow, the pinned frontend-design and React guidance,
the vendored Next.js 16 docs, the shared Content/Strategy/Journey contracts,
and the NestJS Content controller/service/DTOs.

Work only on issue #154's frontend scope. Preserve unrelated changes. Do not
modify backend, Prisma, shared contracts, AI service, Publishing, or the pack
review implementation owned by issue #155.

Implement phases 0 through 8 in order. After each phase:
1. run the focused tests for that phase;
2. inspect the diff for scope and type safety;
3. report what passed before continuing.

Critical rules:
- POST /content-cycles already queues Week 1. Never call Week 1 generate.
- Render exactly 12 weeks and reject Week 13 before any API request.
- Resolve the exact current approved Strategy version, exact approved owner
  decision, and matching confirmed profile before enabling Start.
- Use real pack/progress reads. No fake time-based progress.
- GET /content-cycles/:id/weeks exposes contexts, not full pack history. Mark
  unknown history unavailable; never infer it.
- There is no approved asset list/upload API. New contexts send no asset IDs;
  existing IDs are preserved unchanged. Do not build a fake picker.
- The actual generate/retry HTTP response is a queued pack response, not the
  misleading shared GenerateContentWeekResponse type. Use the adapter-local
  type defined by the plan and report the mismatch.
- Use one stable idempotency key per logical create/generate action.
- Never render raw server message or progress message_text.
- Put every visible string and ARIA label in both ContentCycle dictionaries.
- Preserve owner and Strategy text unchanged and handle mixed bidi content.
- Use the existing shell, palette, IBM Plex fonts, and shadcn-first policy.
- The visual is an editorial planning desk with one continuous 12-week ledger,
  not a dashboard/card grid or AI-themed page.
- Use recursive, non-overlapping, visibility-aware polling and stop in every
  terminal pack state.
- Do not install new dependencies.

Required final verification:
npm run check -w @marketmind/web
npm run build -w @marketmind/web
npm run test:e2e -w @marketmind/web -- content-cycle.spec.ts --project=chromium
npm run test:e2e -w @marketmind/web -- content-cycle.spec.ts --project=mobile-chrome

At handoff, list files changed, tests run and results, material screenshots
reviewed, remaining API gates, whether #155 click-through was testable, and
explicit proof that no Week 1 generate call was added. Do not claim the two
dependency-gated acceptance items are complete.
```

## 26. Owner review checklist

Ahmed should be able to demonstrate and explain all of these before requesting
review:

- why the exact Strategy decision is needed, not only `status=approved`;
- where Week 1 is queued and why the frontend does not queue it again;
- how the 12 ledger slots distinguish known state from unavailable history;
- how owner-confirmed context differs from safe-default context;
- how `promotion: null` is serialized for no-promotion;
- how retained assets avoid accidental deletion while the picker is gated;
- how Cairo local times are converted without a fixed UTC offset;
- how idempotency keys survive uncertain transport retries;
- how polling avoids overlap and stops while hidden/terminal;
- why raw server messages are never displayed;
- how the selected week survives refresh, back navigation, and locale change;
- how mobile navigation remains accessible with six destinations;
- which two acceptance items remain blocked outside the frontend lane.

The issue is ready for review when Slice A passes all automated and human
checks, the remaining gates are stated in the PR, and the UI never suggests
that generating a draft publishes it.
