# Publishing Frontend Implementation Plan

- **Issue:** [#122](https://github.com/ARabee3/marketmind-ai/issues/122)
- **Parent:** [#117](https://github.com/ARabee3/marketmind-ai/issues/117)
- **Primary owner:** Ahmed
- **Required reviewers:** Gerges for API states; Abdulazim for provider and
  recovery states
- **Status:** Implementation-ready for Slice A; dependency-gated states are
  named in section 10
- **Reviewed baseline:** `main@d84844d` on 2026-08-05, including the merged
  Strategy Web, Content API, Publishing API, and Billing work
- **Design reference:** the latest Strategy review workspace at
  `/strategy/:strategy_id/review`

## 1. Outcome

Issue #122 should deliver one bilingual Publishing workspace whose single job
is to help an Egyptian SME owner turn one exact approved content candidate into
one safe, understandable outcome:

```text
approved candidate
  -> mode
  -> exact target and time
  -> consequence
  -> owner approval when the action is real
  -> truthful result
  -> safe recovery when needed
```

The workspace is an operations and owner-control surface. It is not an
analytics dashboard, a content editor, an AI assistant, or a social media
management suite.

Success means the owner can always answer these questions without knowing the
publishing architecture:

1. What exact content am I acting on?
2. Is this a real publication, an export, or a simulation?
3. Which account and time will be used?
4. What will happen when I approve this action?
5. What actually happened?
6. If the result is unsafe or uncertain, what may I do next?

**Start decision:** begin Slice A now. The read-only workspace, simulation,
real-publication decision flow against an existing connected target, and every
safety/recovery state have enough contract support to implement. Do not wait
for provider work before starting.

Two final acceptance checks remain gated outside the frontend lane:

1. owner-created Meta connection, because the current owner connect/callback
   API still returns 501;
2. completed export download, because the dependency branch produces a
   checksum manifest but the owner-facing archive persistence/download bridge
   is not merged.

## 2. Product decisions

The following decisions should be treated as the initial implementation
baseline.

1. Use one guided workspace at `/publishing`, not separate dashboard pages for
   calendar, approvals, results, and failures.
2. Keep the selected candidate or intent in the URL so reload, browser history,
   and mobile back navigation preserve context.
3. Make the rolling 12-week publication runway the page's signature element.
4. Keep the candidate preview immutable. Publishing exposes no caption, CTA,
   hashtag, alt-text, channel, locale, or asset editor.
5. Let the owner select the mode before creating the intent. Once an intent
   exists, changing mode means cancelling it and deliberately starting another
   intent; the browser must not silently mutate the mode.
6. Treat the server-normalized UTC instant as authoritative. The browser sends
   Cairo-local input, then shows the exact local and UTC values returned by the
   API before real-publication approval.
7. Use an exact approval receipt for a real external action. A generic
   “Confirm” dialog is insufficient.
8. Derive the terminal owner label from the normalized result, not only from
   `intent.state = succeeded`.
9. Keep `SIMULATION` visible on the runway, selected-candidate workspace,
   result, history, and notifications.
10. Never offer a blind retry for an `unknown` real-provider outcome.
11. Follow the interaction grammar already established by Strategy: one navy
    thesis header, one horizontally scrollable section/runway navigator, one
    readable main column, and one narrow sticky owner-control rail.
12. Follow Strategy's route model once an intent exists: a stable resource
    route, a dedicated immutable review route, and a separate history route.
13. Reuse the shipped Base UI decision-dialog pattern. Do not add a second
    dialog system only for Publishing.
14. Reuse the shared application shell and bring its mobile behavior back to
    the documented fixed bottom navigation in the shared component. Do not add
    a Publishing-only navigation implementation.

## 3. Information architecture

### 3.1 Page regions

The workspace has five regions in reading order:

1. **Publishing thesis header** — an owner-control label, plain-language page
   purpose, current Strategy week, fixed `Africa/Cairo` context, and an intent
   history link when an intent exists. This deliberately mirrors Strategy's
   dark navy review header.
2. **Publication runway** — all 12 Strategy weeks, with current and next week
   identified and each week's decision/result state summarized. It occupies
   the same visual role as Strategy's horizontal section navigator, but each
   segment is an actual week and status filter.
3. **Readiness banner** — missing Content cycle, candidate, target, or backend
   capability is stated before the owner reaches a disabled action.
4. **Main review column** — approved-candidate queue, selected immutable
   preview, mode/target/schedule configuration, and attempt/result history.
5. **Sticky owner-control rail** — readiness checks, the next valid decision,
   its consequence, and the exact primary action.

The selected candidate and its decision form should read as one review
document with calm section surfaces and internal dividers. The sticky rail is
the only intentionally separate control surface. This is the same hierarchy
the latest Strategy design uses for a long decision document.

### 3.2 Desktop wireframe

```text
+----------------------------------------------------------------------------+
| OWNER CONTROL                                             Intent history    |
| Publishing workspace                                                       |
| Decide what happens to approved content · Week 3 · Africa/Cairo             |
+----------------------------------------------------------------------------+
| W1 | W2 | W3 CURRENT | W4 NEXT | W5 | W6 | ... | W12                      |
| continuous publication runway: week, count, blocker, and truthful outcome   |
+-----------------------------------------------------+----------------------+
| MAIN REVIEW COLUMN                                  | STICKY OWNER CONTROL |
|                                                     |                      |
| Approved candidates for selected week              | Readiness            |
| [selected] [waiting] [scheduled]                    | ✓ candidate active   |
|                                                     | ✓ mode understood    |
| Immutable candidate preview                         | ! target required    |
| asset · caption · CTA · hashtags · alt text         |                      |
| source week · content version · checksum            | Next owner decision  |
|                                                     | consequence copy     |
| Mode / target / Cairo schedule                      | [exact primary CTA]  |
| server-returned local + IANA zone + UTC receipt     |                      |
|                                                     | Never hidden behind  |
| Attempt, result, approval, and recovery history     | a generic Confirm    |
+-----------------------------------------------------+----------------------+
```

At the existing 1200px content maximum, use the Strategy review grid as the
starting point: `minmax(0, 1fr) 22rem`. The candidate queue belongs inside the
main column as a compact week-scoped selector, not as a permanent third rail.
The sticky rail releases to normal document flow before it becomes cramped.

### 3.3 Mobile wireframe

```text
+----------------------------------+
| Publishing          Africa/Cairo |
+----------------------------------+
| Week 3 of 12 · Current            |
| [scrollable 12-week runway]       |
+----------------------------------+
| Readiness / blocker banner        |
+----------------------------------+
| Approved candidates (3)          |
| [selected candidate summary]     |
+----------------------------------+
| Immutable preview                |
| asset / caption / CTA / alt text |
+----------------------------------+
| Decision trail                   |
| mode -> target/time -> approval  |
+----------------------------------+
| Result / recovery / history      |
+----------------------------------+
| sticky owner action              |
+----------------------------------+
| shared fixed bottom navigation   |
+----------------------------------+
```

On mobile, preserve the same reading order instead of hiding required fields
behind a desktop-style side panel. The owner action may become sticky, but it
must reserve safe space and must never cover focused controls, errors, or
dialog buttons. The bottom navigation is implemented once in the shared shell,
with safe-area and content padding for every workspace route; Publishing does
not add a route-local navigation.

## 4. Visual direction

### 4.1 Subject, audience, and page job

- **Subject:** safe weekly publication of approved SME marketing content.
- **Audience:** Arabic-first and bilingual Egyptian SME owners who may not be
  technical.
- **Single page job:** make an exact publication decision and understand its
  proven result.

### 4.2 Strategy design alignment

The newest Strategy workspace is the visual and interaction baseline, not a
screen to copy mechanically.

| Strategy pattern                                | Publishing adaptation                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| Dark navy thesis header with owner-review badge | Owner-control header with week, Cairo zone, and history link             |
| Horizontal review-section navigation            | Continuous 12-week runway that also selects and filters week context     |
| Long readable review document                   | Immutable candidate preview, configuration receipt, and result history   |
| Sticky 22rem readiness and owner-decision rail  | Readiness checks, next safe action, consequence, and exact approval CTA  |
| Claim-local evidence and version history        | Checksum/version disclosures, approvals, attempts, and normalized result |
| Explicit dialog naming the immutable decision   | Exact publication receipt plus a consequence-specific decision dialog    |
| Stale-version refetch and owner review          | Intent-version conflict refetch before any new publishing action         |

Publishing differs in one important way: Strategy is one immutable document,
while Publishing is a state machine. The main column may advance from
configuration to result, but it must preserve earlier decisions in history
instead of replacing them with a success screen.

### 4.3 Palette

Use only the approved semantic palette.

| Role                | Token             | Hex       | Use in Publishing                        |
| ------------------- | ----------------- | --------- | ---------------------------------------- |
| Workspace           | `--color-bg`      | `#F7F8FA` | Page and quiet runway background         |
| Bounded surface     | `--color-surface` | `#FFFFFF` | Preview and decision workspace           |
| Primary information | `--color-navy`    | `#102A43` | Headings, exact values, schedule receipt |
| Confirmed/active    | `--color-primary` | `#0B6F71` | Current step, connected, published       |
| Owner action        | `--color-action`  | `#246BFD` | Links and the current primary action     |
| Caution/unknown     | `--color-warning` | `#A15C00` | Simulation, expired auth, unknown result |
| Failure             | `--color-danger`  | `#B42318` | Proven failures and destructive actions  |
| Structure           | `--color-border`  | `#D9E2EC` | Runway rules, dividers, form boundaries  |

Color is never the only state signal. Every state also needs distinct text and
iconography.

### 4.4 Typography

The established bilingual type system overrides any desire to introduce a new
display family.

- IBM Plex Sans and IBM Plex Sans Arabic, weight 700: page and selected-state
  headings.
- The same families, weights 400–600: owner instructions and content preview.
- The same families with tabular numerals: week numbers, local/UTC times,
  versions, and checksum fragments.

Arabic and English must have equal hierarchy rather than treating Arabic as a
translated secondary state.

### 4.5 Signature element: the publication runway

The memorable visual is a continuous 12-segment publication runway. It makes
the Strategy horizon, the current week, the next week, waiting decisions, and
truthful outcomes visible in one sequence.

Each segment contains only information with product meaning:

- week number;
- current or next marker where applicable;
- count of approved candidates;
- one text/icon state such as `Needs decision`, `Scheduled`, `Published`,
  `Exported`, `Simulation`, `Failed`, or `Unknown`.

The runway is not a row of metric cards. It should read as one connected
planning instrument using shared rules, aligned labels, and a visible current
position.

### 4.6 Motion

Use motion only to preserve orientation:

- a short active-step transition when the decision trail advances;
- a restrained progress indicator while an intent is dispatching;
- focus movement to the first invalid field or the new result heading.

Respect `prefers-reduced-motion`. Do not animate the entire runway, pulse
terminal statuses, or use ambient “AI” effects.

### 4.7 Design critique

A generic first pass would likely be a grid of calendar and status cards. That
would fragment one safety-critical decision into dashboard widgets and make
week-to-week continuity harder to understand. The revised direction uses one
runway, one review document, and one owner-control rail. The boldness is spent
on the 12-week runway; the preview, forms, confirmation, and history remain
conventional and calm.

## 5. Owner journeys

### 5.1 Entry and readiness

On entry, load the current Content cycle, current week, candidate inbox,
existing intents, and publishing targets in parallel.

The entry states are:

| State                                 | Owner-facing treatment                                             | Primary action                                      |
| ------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| No active Content cycle               | Publishing is locked because approved Content does not exist yet   | Go to Content                                       |
| Active cycle, no candidates           | Explain that approved items will appear here                       | Review Content                                      |
| Candidates exist, no connected target | Export and simulation remain usable; real mode is visibly blocked  | Connect when available; otherwise show setup status |
| Candidates and targets exist          | Select the current/next-week candidate that needs a decision       | Choose a candidate                                  |
| Load failure                          | Keep the page purpose visible and explain what could not be loaded | Try again                                           |

An empty state must never suggest that content was scheduled or published.

### 5.2 Candidate selection and immutable preview

The candidate queue groups items by Strategy week and orders them by their
recommended publishing window. Each queue item shows:

- week and recommended Cairo window;
- channel and format;
- selected locale;
- short caption excerpt;
- current decision/result label;
- blocker text when the candidate is revoked, replaced, or unsupported.

The selected preview shows the exact frozen fields:

- locale, channel, and format;
- caption;
- CTA;
- hashtags;
- alt text;
- immutable asset;
- Strategy week and recommended window;
- content item version;
- candidate checksum, collapsed to a readable fragment with a way to reveal or
  copy the complete value.

There are no edit affordances. Copy should say that changes must create and
approve a new Content version, not imply that Publishing can repair a
candidate.

### 5.3 Mode selection

Use a semantic radio group with three full consequence descriptions.

| Mode            | Plain-language consequence                                                               | Required configuration                                     |
| --------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Real publishing | MarketMind will publish this exact item to an external Meta account at the approved time | Connected compatible target and Cairo-local schedule       |
| Manual export   | MarketMind will build a downloadable archive; the item will not be posted                | No external target or schedule                             |
| Simulation      | MarketMind will test the workflow without contacting a social platform                   | No external target or schedule; permanent simulation label |

Do not preselect real publishing. If a recommendation is needed for a
no-credentials demo, recommend export in explanatory copy without selecting it
for the owner.

Until the API exposes a reviewed Meta-connect capability, the Web defaults
that capability to unavailable. Existing connected targets still allow Real;
the absence of a target never turns a 501 route into a clickable promise.

### 5.4 Real publication flow

1. The owner selects `Real publishing` and creates the intent.
2. The owner selects one target presented with account name, channel,
   connection state, supported format, and last verification time.
3. The owner enters a Cairo-local date and time with seconds normalized by the
   client.
4. The browser submits the schedule. The API validates the target and time,
   increments the intent version, and returns the normalized UTC instant.
5. The decision trail moves to an exact approval receipt showing:
   - candidate identity and checksum;
   - caption excerpt and asset thumbnail;
   - target display name and channel;
   - mode `Real publishing`;
   - Cairo-local time;
   - literal IANA zone `Africa/Cairo`;
   - exact UTC instant;
   - the consequence: automatic external publication at that time.
6. The owner acknowledges the consequence and activates an action named
   `Approve and schedule`.
7. Only an API-confirmed `scheduled` response becomes Scheduled in the UI.

The approval confirmation should reuse the accessible Base UI dialog pattern
already proven by Strategy, but the exact receipt also remains visible inline
so it is not dependent on a transient modal.

### 5.5 Approval invalidation and reschedule

Changing the target or time is a material change.

Before rescheduling, explain that the existing approval and delayed job will be
replaced. After the API confirms the change:

- show an inline `Previous approval no longer applies` notice;
- return the trail to `Approval needed`;
- show the new intent version and exact local/UTC tuple;
- require a new explicit approval;
- never reuse the old approval dialog state or idempotency key.

On reload, derive invalidation from the latest approval's intent version versus
the current intent version rather than relying only on transient client state.

### 5.6 Cancellation

Cancellation is available only for `draft`, `awaiting_approval`, or
`scheduled`. The confirmation names the candidate and scheduled consequence.

If cancellation races with dispatch and the API returns a stale/state
conflict, refetch the intent and show its authoritative state. Do not replace
that conflict with a success toast.

A cancelled intent is read-only. If the candidate is still active, the owner
may deliberately start a new decision.

### 5.7 Manual export flow

1. The owner selects `Manual export` and sees `This creates files; it does not
publish` next to the action.
2. The owner activates `Create export`.
3. While the archive is being built, show a pending export state rather than
   `Exported`.
4. After the API exposes a completed artifact, show:
   - `Exported — not published`;
   - download action and expiry;
   - manifest label;
   - candidate checksum;
   - every asset path and checksum in an accessible disclosure.
5. If generation fails, preserve the candidate and expose retry only when the
   normalized result says it is retryable.

### 5.8 Simulation flow

1. The owner selects `Simulation` and sees `No social account will change`.
2. The owner activates `Run simulation`.
3. Dispatching copy remains mode-specific: `Running simulation`, not
   `Publishing`.
4. The result reads `Simulation completed — nothing was published`.
5. The permanent `SIMULATION` label remains visible everywhere the result is
   summarized.

Simulation must not borrow the visual treatment or wording of Published.

### 5.9 Failure and unknown-result recovery

Recovery is determined by evidence, not by a generic retry button.

| Condition                              | Explanation                                                                        | Allowed owner action                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Target expired/revoked before dispatch | The account cannot currently authorize the action                                  | Reconnect/verify, then rebuild the exact schedule and approval when supported |
| Proven retryable failure               | The external action is proven not to have succeeded                                | Retry the same intent using the exact latest failed attempt number            |
| Proven non-retryable failure           | The action failed and needs a configuration/content correction outside this screen | Follow the specific recovery link or stop                                     |
| Unknown provider outcome               | MarketMind cannot prove whether Meta accepted the request                          | Refresh status only; never publish or retry blindly                           |
| Revoked/replaced candidate             | Content withdrew the exact version                                                 | Read-only explanation; return to Content                                      |
| Asset unavailable/tampered             | The immutable media could not be verified                                          | Read-only Publishing state; repair through a new Content version              |
| Stale intent conflict                  | Another valid state change won                                                     | Refetch, show what changed, and ask the owner to review again                 |

The unknown state must include a prominent instruction not to manually retry
or repost while reconciliation is incomplete.

## 6. State language and visual distinction

### 6.1 Intent states

| Contract/API state  | Owner label                       | Treatment                                                  |
| ------------------- | --------------------------------- | ---------------------------------------------------------- |
| No intent           | Needs decision                    | Neutral open marker                                        |
| `draft`             | Configure decision                | Current-step marker                                        |
| `awaiting_approval` | Approval needed                   | Action-blue marker plus exact receipt                      |
| `scheduled`         | Scheduled                         | Teal clock and exact local time                            |
| `dispatching`       | Mode-specific in progress         | Progress icon and `aria-live` update                       |
| `succeeded`         | Read the latest normalized result | Never display the word Succeeded by itself                 |
| `failed`            | Failed                            | Danger icon, safe error explanation, conditional recovery  |
| `action_required`   | Needs attention                   | Warning icon; distinguish auth expiry from unknown outcome |
| `cancelled`         | Cancelled                         | Muted stop icon and immutable history                      |

### 6.2 Terminal outcomes

| Outcome     | Required visible text              | Icon/treatment                                        | Forbidden implication                         |
| ----------- | ---------------------------------- | ----------------------------------------------------- | --------------------------------------------- |
| `published` | Published to `{target}`            | Teal check-circle                                     | None; requires provider proof                 |
| `exported`  | Exported — not published           | Action-blue download icon                             | Never imply a social post exists              |
| `simulated` | SIMULATION — nothing was published | Warning test/run icon and permanent label             | Never reuse Published copy or icon            |
| `failed`    | Failed                             | Danger X-circle                                       | Never silently convert to simulation          |
| `cancelled` | Cancelled                          | Neutral stop/slash icon                               | Never imply failure or success                |
| `unknown`   | Unknown — do not retry             | Warning question/shield icon and bordered explanation | Never claim failure, success, or retryability |

## 7. Responsive and bilingual behavior

### 7.1 Arabic and mixed content

- Add a `Publishing` namespace to both message dictionaries.
- Translate controls, instructions, states, errors, and accessible names.
- Preserve the selected candidate/intent search state when switching between
  Arabic and English.
- Keep owner content, account names, hashtags, IDs, checksums, IANA zones, and
  URLs in their original form.
- Wrap mixed-language caption, CTA, and alt text with `dir="auto"` where the
  candidate locale is the correct direction source.
- Use logical spacing and borders throughout.
- Let the main review column and sticky owner-control rail mirror through
  document direction exactly as the latest Arabic Strategy review does; do not
  maintain separate LTR/RTL layout trees.
- Start week 1 at logical inline-start, so the runway reads left-to-right in
  English and right-to-left in Arabic without reversing chronological meaning.
- Flip directional chevrons, not status or provider icons.
- Format dates and numbers through `next-intl`; also expose exact machine
  values where the approval contract requires them.

### 7.2 Accessibility

- The runway is an ordered list. Week selection uses buttons with current,
  selected, status, and candidate-count information in the accessible name.
- Mode and target choices use fieldsets and legends.
- The schedule control has an explicit Cairo label, help text, inline error,
  and error-summary link.
- The approval decision dialog receives initial focus, traps focus, closes with
  Escape before submission, and returns focus to the trigger.
- After a successful mutation, focus moves to the new state heading; after a
  failed mutation, it moves to the error summary or first invalid control.
- Loading uses `aria-busy`; status changes use a restrained `aria-live` region.
- History is an ordered list with real timestamps, not a color-only timeline.
- Content remains usable at 200% zoom and 320 CSS pixels wide.
- No horizontal page overflow is allowed at 375 CSS pixels in either
  direction.
- Any asset image uses the frozen candidate alt text. A missing image retains
  the alt-text copy and explains the asset failure.
- Keep the application light-only; issue #122 must not introduce a partial
  automatic dark theme.

## 8. Component and route plan

### 8.1 Routes

```text
apps/web/src/app/[locale]/(workspace)/publishing/page.tsx
apps/web/src/app/[locale]/(workspace)/publishing/[intent_id]/page.tsx
apps/web/src/app/[locale]/(workspace)/publishing/[intent_id]/review/page.tsx
apps/web/src/app/[locale]/(workspace)/publishing/[intent_id]/history/page.tsx
apps/web/src/app/[locale]/(workspace)/publishing/meta/callback/page.tsx
```

`/publishing` is the runway and candidate-inbox entry. Before an intent exists,
the selected candidate is represented by one `candidate` search parameter.
After creation, navigate to the stable intent resource route. The dedicated
`review` route owns the exact immutable real-publication receipt; `history`
owns the full approval/attempt/result record. These routes mirror Strategy's
resource, review, and history model and make reload/back behavior explicit.

The Meta callback route is capability-gated and ships only when the provider
integration can return the owner through the browser. A 501 backend must
produce a disabled connection explanation, not an active callback journey.

Add Publishing to the authenticated app navigation. Do not create a second
page shell. Add `publishing` to `WORKSPACE_SEGMENTS` in `apps/web/src/proxy.ts`
so the new routes receive the same server-side session gate as Strategy.

### 8.2 Feature files

```text
apps/web/src/features/publishing/
  components/
    publishing-workspace.tsx
    publication-runway.tsx
    publication-readiness.tsx
    candidate-queue.tsx
    immutable-candidate-preview.tsx
    publishing-decision-trail.tsx
    publishing-mode-choice.tsx
    publishing-target-choice.tsx
    publishing-schedule-step.tsx
    publication-approval-receipt.tsx
    publication-decision-dialog.tsx
    publication-outcome-panel.tsx
    publication-attempt-history.tsx
    publication-recovery-panel.tsx
  hooks/
    use-publishing-workspace.ts
    use-publication-intent.ts
    use-publication-asset.ts
  lib/
    publishing-state.ts
    api-error-localization.ts
    publishing-fixtures.ts

apps/web/src/lib/api/publishing.ts
apps/web/src/lib/api/__tests__/publishing.test.ts
apps/web/e2e/publishing.spec.ts
```

Keep these components feature-local until Content issue #111 demonstrates the
exact shared 12-week behavior. The Content and Publishing week rails should
share vocabulary and spacing, but premature extraction must not couple their
different state machines.

### 8.3 shadcn-first selection record

| Need                             | Selection step                         | Decision                                                 |
| -------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| Runway/history                   | Semantic HTML                          | `<ol>`, `<li>`, and buttons                              |
| Mode/target choice               | Semantic HTML                          | Fieldset, legend, and radio inputs                       |
| Schedule                         | Semantic HTML plus existing primitives | Labeled `datetime-local` input                           |
| Exact real approval              | Existing shipped interaction pattern   | Reuse Strategy's `@base-ui/react/dialog` composition     |
| Buttons, labels, inputs          | Existing local primitive               | Reuse current owned primitives                           |
| Status/outcome/receipt semantics | Feature composition                    | Custom Publishing components, not new control primitives |
| Export manifest                  | Semantic HTML                          | `<details>` and a list/table as appropriate              |

Do not bulk-import a registry, add a calendar library for the 12-week runway,
or use `Card` as the default wrapper for every region.

## 9. Data and API integration

### 9.1 Initial reads

Load independent reads in parallel and normalize them once at the API boundary.

| Need                                  | Current source                                       |
| ------------------------------------- | ---------------------------------------------------- |
| Active cycle and current week         | `GET /api/v1/journey/current`                        |
| Week context/history when needed      | `GET /api/v1/content-cycles/:id/weeks`               |
| Candidate queue and immutable payload | `GET /api/v1/publication-candidates`                 |
| Selected asset bytes                  | `GET /api/v1/content-assets/:assetId`                |
| Existing intents                      | `GET /api/v1/publication-intents`                    |
| Selected intent, target, approval     | `GET /api/v1/publication-intents/:intentId`          |
| Targets and connection state          | `GET /api/v1/publishing-targets`                     |
| Attempts/results                      | `GET /api/v1/publication-intents/:intentId/attempts` |
| Export artifact/manifest              | `GET /api/v1/publication-intents/:intentId/export`   |

Do not let raw API casing, Prisma records, or transport-only fields escape
`publishing.ts`. Components should consume one lowercase, browser-safe view
model aligned to `publishing-v1`.

This is an established project pattern, not a new exception: the merged
Strategy client declares the wire response explicitly and maps it into the
shared lowercase `StrategyResource`. Publishing should do the same for current
camelCase/uppercase API projections, with fixture and live-response contract
tests at the boundary. If the API later adopts the frozen lowercase DTO, only
the mapper changes.

Content assets and the eventual export archive are authenticated byte
responses. Do not place their API URLs directly in `<img src>` or a download
link because the in-memory bearer token would be missing. Fetch through
`apiRequest`, validate the response, create a short-lived browser object URL,
and revoke it when the selected candidate changes or the component unmounts.
Keep the frozen alt text rendered even when byte retrieval fails.

### 9.2 Mutations

| Owner action                 | Current API operation                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| Create mode-specific intent  | `POST /api/v1/publication-intents`                               |
| Set initial real target/time | `PUT /api/v1/publication-intents/:intentId/schedule`             |
| Approve exact real action    | `POST /api/v1/publication-intents/:intentId/decisions`           |
| Cancel                       | `POST /api/v1/publication-intents/:intentId/cancel`              |
| Reschedule                   | `POST /api/v1/publication-intents/:intentId/reschedule`          |
| Retry proven failure         | `POST /api/v1/publication-intents/:intentId/retry`               |
| Start export                 | `POST /api/v1/publication-intents/:intentId/dispatch-export`     |
| Run simulation               | `POST /api/v1/publication-intents/:intentId/dispatch-simulation` |
| Connect/verify target        | Capability-gated target connect/callback/verify routes           |

The extra reschedule, local-action, and approval-history routes implemented by
#119 should be added to the public API documentation or represented in an
additive reviewed contract. Until then, the adapter tests lock the exact wire
shape consumed by #122 and make any drift visible in CI.

### 9.3 Version and idempotency safety

- Generate one idempotency key per logical owner action with
  `crypto.randomUUID()`.
- Reuse that key for transport retry of the same action.
- Generate a new key when the owner makes a new decision.
- Disable duplicate submission while a request is in flight, but do not rely
  on the button state as the server guarantee.
- Send the exact expected intent/target version required by the API.
- On `PUBLISHING_STATE_CONFLICT` or `PUBLISHING_VERSION_CONFLICT`, refetch and
  show the authoritative change.
- Never optimistically show Published, Exported, or Simulated.
- Keep the selected intent polling only while a state can advance without a
  local click. Slow or pause polling while the tab is hidden.
- Stop polling terminal results. `unknown` may poll a reconciliation status,
  but it remains Unknown until the server proves another outcome.

### 9.4 Schedule normalization

The client must not invent the authoritative UTC instant from a naive local
string. Cairo has time-zone rule changes, so the safe interaction is:

1. capture a valid local date/time;
2. send it with `Africa/Cairo`;
3. let the API validate and normalize it;
4. display the returned local and UTC values;
5. enable exact approval only after that response.

This makes the approval screen accurate without adding an unreviewed date-time
library.

## 10. Blocker decisions and dependency gates

The audit used `main@d84844d`, the open GitHub issues, and
`origin/feature/120-publishing-automation-and-adapters@4bd770b` (nine commits
ahead of `main`). The result is that #122 can start now. Two final acceptance
states remain dependency-gated; the rest have concrete frontend decisions.

| Concern                     | Current evidence                                                                                                                                                                                                                                                | Decision for #122                                                                                                                                                                                                                                                                                                                                                          | Status / owner                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Browser response shape      | #119 list/read services expose Prisma-style camelCase fields and uppercase enums while frozen contracts are lowercase                                                                                                                                           | Declare exact wire types and normalize once in `apps/web/src/lib/api/publishing.ts`, following the merged Strategy adapter. Add contract tests for every consumed response. Components never read DB projections.                                                                                                                                                          | Resolved inside #122                                                          |
| Current Content week typing | `/journey/current` returns `content` at runtime, but shared `CurrentJourneyResponse` omits it and the API uses a local intersection type                                                                                                                        | In Slice A, export `CurrentJourneyContentReadiness` from the shared journey contract, add `content` to `CurrentJourneyResponse`, and make the API consume that shared type.                                                                                                                                                                                                | Small Slice A prerequisite; Ahmed implements, Gerges reviews                  |
| Meta target connection      | `main` truthfully returns 501 for `meta/connect` and `meta/callback`. The dependency branch contains the deterministic n8n workflow, internal asset serving, and a live-verified Meta adapter, but it still does not implement owner OAuth target provisioning. | Build real-mode UI against an already connected, verified target and the seeded/fake-provider fixture. When no such target exists, show Real as unavailable with a truthful setup explanation; keep export and simulation enabled. Default connect capability to false; enable Connect only from an explicit reviewed runtime capability, never by probing the POST route. | Does not block Slice A/B UI; production connection remains #120/#121/API work |
| Completed export download   | Main leaves manual export in `DISPATCHING` with `manual_archive_pending`. The dependency branch creates and verifies a manifest, but no owner-facing API path yet persists the archive, completes the result, and streams a download.                           | Implement Pending and fixture-backed Ready/Failed UI now. Final integration needs the callback to persist `EXPORTED`, `GET .../export` to return owner-safe ready metadata/manifest, and `GET .../export/download` to stream the archive through the API with expiry. Never expose an internal asset URL.                                                                  | Final export-download criterion gated on #121 plus API bridge                 |
| Unknown-result recovery     | The API automatically sweeps stuck attempts every three minutes, records `UNKNOWN`, exposes attempts/results to the owner, and restricts proof-based resolution to admins.                                                                                      | The owner action is `Refresh status`, which only refetches intent and attempts. Explain automatic review, show last checked time, poll slowly while visible, and offer no reconcile mutation or retry. #123 can drive the admin/provider-proof resolution during E2E.                                                                                                      | Resolved for owner UI                                                         |
| Approval invalidation       | Intent detail includes ordered approvals; approval records include `intentVersionAtDecision`; schedule/reschedule increments the intent version                                                                                                                 | Derive validity from `latestApproval.intentVersionAtDecision === intent.version`. Refetch detail and approvals after schedule/reschedule/conflict. The missing invalidation wrapper is helpful API polish, not a frontend blocker.                                                                                                                                         | Resolved inside #122                                                          |
| Mobile shell                | The project brief and #122 require fixed bottom navigation; the merged app and latest Strategy/Billing screens currently use a mobile drawer                                                                                                                    | Fix `app-shell.tsx` once in Slice A: retain the compact top bar, replace the drawer with shared bottom navigation, add safe-area/content padding, and regression-test Discovery, Dashboard, Strategy, Billing, locale switching, sign-out access, and the new Publishing destination. No feature-local nav.                                                                | Resolved prerequisite inside #122                                             |
| Dependency branch timing    | #120 and #121 remain open; their shared branch is ahead of `main` and changes workflow/assets but not the browser API contract                                                                                                                                  | Do not copy branch internals into Web. Build against frozen fixtures and current owner endpoints; rebase after dependency merge and run the real integration matrix before closing #122.                                                                                                                                                                                   | Coordination gate, not a start blocker                                        |

No frontend adapter should turn a 501, pending archive, raw error, or unknown
provider result into a completed-looking state. The explicit implementation
start gate is therefore: land the shared journey typing adjustment, then begin
the read-only runway and candidate workspace immediately.

## 11. Error localization

Map every stable `PUBLISHING_*` code to:

- a concise owner-facing title;
- what happened;
- whether anything external may have happened;
- the one safe next action;
- the field or step that should receive focus.

Keep raw provider payloads, tokens, signed URLs, stack traces, and internal
workflow details out of translations and browser logs. Unknown codes use a
truthful generic failure with refresh, not a fabricated retry recommendation.

## 12. Test and verification plan

### 12.1 Pure state and API tests

- Map every intent state and all six normalized outcomes.
- Prove `succeeded` cannot be displayed without reading the result.
- Prove `unknown` never exposes retry.
- Prove simulation requires the permanent label.
- Prove export pending is not Exported.
- Prove revoked/replaced candidates are read-only.
- Prove transport retries reuse one idempotency key and new decisions use a new
  key.
- Prove casing/transport normalization stays inside the API adapter.
- Prove backend capability absence disables Meta connection without disabling
  export or simulation.
- Prove approval validity is derived from intent and decision versions after a
  reload.
- Prove authenticated asset/archive helpers revoke object URLs and do not leak
  raw internal or credential-bearing URLs into markup.
- Localize all stable publishing error codes and the unknown fallback.

### 12.2 Component tests

- Twelve-week runway: current, next, empty, selected, and every material state.
- Candidate queue ordering and immutable preview fields.
- Real/export/simulation consequence descriptions.
- Target connected, expired, revoked, error, incompatible, and empty states.
- Schedule local/zone/UTC receipt.
- Base UI decision dialog exact-field completeness and focus restoration.
- Approval invalidation after a material change.
- Cancel/reschedule conflict handling.
- Published, exported, simulated, failed, cancelled, and unknown distinction.
- Attempt history and export manifest disclosure.
- Arabic, English, and mixed candidate content.

### 12.3 Playwright journeys

1. Real with fake provider: candidate -> target/time -> exact approval ->
   scheduled -> published.
2. Reschedule: scheduled -> material change -> approval invalidated -> new
   approval.
3. Cancellation before dispatch and a dispatch-race conflict.
4. Manual export: pending -> downloadable artifact and manifest.
5. Simulation with permanent labels on every relevant view.
6. Proven retryable failure -> explicit retry -> truthful result.
7. Expired authorization -> reconnect/review path.
8. Unknown provider outcome -> no retry -> reconciliation/refresh.
9. Revoked candidate and asset-integrity failure.
10. Empty/loading/network/stale/idempotency-conflict states.

Run each critical journey in English/LTR and Arabic/RTL at desktop and mobile
viewports, including at least 1280px desktop and at most 375px mobile. Complete
the real schedule/approve/cancel/retry path with the keyboard only. Verify
reduced motion, 200% zoom, focus visibility, labels, landmarks, live regions,
language-switch route preservation, and error-summary behavior.

The merge-independent browser suite uses frozen fixtures for connected target,
published, exported, and unknown results. A second integration-gated suite runs
against the merged #120/#121/API boundary. A fixture passing never checks the
live export-download or provider criteria by itself.

### 12.4 Required gates

```bash
npm run check:dictionary --workspace @marketmind/web
npm run test --workspace @marketmind/web
npm run test:e2e --workspace @marketmind/web
npm run check --workspace @marketmind/web
npm run build --workspace @marketmind/web
npm run check
```

Run the final approved `web-design-guidelines` audit after browser verification
and record English/Arabic desktop/mobile screenshots for the material states.

## 13. Delivery sequence

Issue #122 is large enough that it should land through reviewable slices rather
than one oversized frontend PR.

### Slice A — contract alignment and read-only workspace

- Add shared `CurrentJourneyContentReadiness` typing and remove the API-local
  response intersection.
- Add route, navigation, translations, the Strategy-style API adapter, and
  frozen fixtures; include the shared proxy's protected-route allow-list.
- Restore the documented shared mobile bottom navigation in `app-shell.tsx`
  and add regression coverage for every existing workspace destination.
- Build the navy thesis header, runway, readiness banner, candidate queue,
  immutable preview, and all entry states in the `1fr + 22rem` layout.
- Add unit/component coverage for normalization and read-only states.

### Slice B — decision builder and real approval

- Add mode and target choice.
- Add Cairo schedule submission and returned UTC confirmation.
- Add stable intent, review, and history routes.
- Add the exact approval receipt and the proven Base UI decision dialog.
- Add reschedule, invalidation, cancellation, stale-version handling, and
  idempotent action behavior.
- Prove that no-target/501 disables only real mode and never fakes a connection.

### Slice C — simulation, pending export, result, and recovery

- Integrate the current simulation result and permanently label it.
- Implement truthful manual-export Pending plus fixture-backed Ready/Failed
  views without claiming the dependency is complete.
- Add attempt/result history.
- Add failed, expired-auth, revoked-candidate, asset, and read-only unknown
  recovery with `Refresh status`.
- Prove the permanent simulation and exported-not-published labels.

### Slice D — dependency integration and final verification

- Rebase after #120/#121/API bridge merge and wire owner-safe export metadata,
  archive streaming, and any available target-connect capability.
- Verify the shared mobile bottom navigation and Publishing sticky actions do
  not overlap each other or focused controls.
- Complete Arabic/English parity and long mixed-content testing.
- Run all desktop/mobile keyboard and failure journeys.
- Complete the final accessibility/UX audit and #123 handoff.

## 14. Definition of Done for #122

- The 12-week runway shows current and next week and never invents missing
  publication state.
- The selected candidate is complete, immutable, and traceable to its exact
  version/checksum.
- Mode consequences are explicit before an intent action.
- Real mode works with an existing connected target and is truthfully
  unavailable when target-connect capability is absent; export and simulation
  remain usable.
- Real approval cannot occur before the exact candidate, target, mode, local
  time, IANA zone, and UTC instant are visible.
- A target/time change visibly invalidates the earlier approval on mutation and
  after reload.
- Cancel/reschedule and stale/conflict behavior are truthful before dispatch.
- Published, Exported, Simulation, Failed, Cancelled, and Unknown are distinct
  in text, iconography, treatment, history, and announcements.
- Unknown never offers blind retry.
- Export exposes a real verified artifact and manifest; pending export never
  looks complete. This checkbox stays open until the #121/API download bridge
  is merged and verified outside fixtures.
- Simulation remains labeled everywhere and never looks published.
- Arabic/English, RTL/LTR, desktop/mobile, keyboard, focus, loading, empty,
  failure, conflict, and recovery journeys pass.
- Publishing reuses the shared desktop sidebar and fixed mobile bottom
  navigation; it introduces no competing feature-local application navigation.
- The final accessibility/UX audit and root checks pass.
- Gerges and Abdulazim review the states owned by their API/provider lanes, and
  the human owner can explain every external-action consequence.

## 15. Source material

- `Docs/planning/sprint-5/PUBLISHING_AUTOMATION_ARCHITECTURE.md`
- `Docs/planning/sprint-5/CONTENT_AGENT_AND_AUTOMATION_HANDOFF_ARCHITECTURE.md`
- `packages/contracts/PUBLISHING_CONTRACT.md`
- `packages/contracts/src/publishing/`
- `apps/web/src/features/strategy/components/strategy-review.tsx`
- `apps/web/src/lib/api/strategy.ts`
- `apps/web/e2e/strategy.spec.ts`
- `apps/web/AGENTS.md`
- `.agents/skills/marketmind-frontend-workflow/references/product-visual-brief.md`
- [Issue #111 — Content Web](https://github.com/ARabee3/marketmind-ai/issues/111)
- [Issue #119 — Publishing API](https://github.com/ARabee3/marketmind-ai/issues/119)
- [Issue #120 — n8n orchestration](https://github.com/ARabee3/marketmind-ai/issues/120)
- [Issue #121 — adapters and fallbacks](https://github.com/ARabee3/marketmind-ai/issues/121)
- [Issue #123 — end-to-end integration](https://github.com/ARabee3/marketmind-ai/issues/123)
