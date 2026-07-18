# PR #89 Review Fix Plan

## Purpose

Address the blocking review findings in
[PR #89](https://github.com/ARabee3/marketmind-ai/pull/89),
`feature/51-owner-journey-experience`, before requesting another review.

The `JourneyModule` and `GET /api/v1/journey/current` endpoint are justified and
should remain. This plan fixes the endpoint's missing-data behavior, the
dashboard and authentication gaps, public landing-page behavior and claims,
accessibility, localization, and verification failures.

## Starting point

- Reviewed PR head: `322271405741f9b9a0c56cee4d75da91f1e66abd`.
- Target branch: `main`.
- PR state at review time: open and mergeable, with no configured GitHub status
  checks.
- Preserve unrelated work. Do not modify or remove local files that are not part
  of this PR.
- Before frontend work, run:

  ```bash
  npm ci
  npm run agent:doctor -- --available-mcp context7
  ```

- Follow `apps/web/AGENTS.md` and the project-local
  `marketmind-frontend-workflow` skill. Use the pinned React guidance for code
  changes and the pinned web-design guidance for the final accessibility pass.

## Required outcomes

1. Every public primary CTA leads to a real localized account or Discovery
   entry route.
2. Unverified owners receive verification guidance and cannot start or continue
   the owner journey.
3. Workspace protection is enforced server-side or at the protected data
   boundary; a client-only layout wrapper must not be presented as the security
   boundary.
4. The landing page describes only implemented behavior and clearly labels
   future phases.
5. Public privacy and performance wording is evidence-backed and approved.
6. Missing business facts remain missing; the API must not invent placeholder
   facts.
7. Landing-page copy uses the approved typed `next-intl` dictionaries.
8. Mobile drawers are keyboard accessible and RTL-correct.
9. The unrelated Nest mail-template watch regression is reverted.
10. All affected static, unit, build, and Playwright checks pass cleanly.

## Implementation plan

### 1. Fix all public CTA destinations

Affected files:

- `apps/web/src/features/landing/components/Hero.tsx`
- `apps/web/src/features/landing/components/Roadmap.tsx`
- `apps/web/src/features/landing/components/FinalCta.tsx`

Current problem:

- The hero and roadmap CTAs scroll to `#start`.
- The final primary CTA is inside the element with `id="start"` and also links to
  `#start`, so it does nothing.

Required change:

- Route the public primary CTA to the localized registration flow, normally
  `/register`.
- If product explicitly wants authenticated users to enter Discovery directly,
  derive the destination from session state and use `/discovery/new` only for an
  authenticated, verified owner.
- Keep the sample/roadmap secondary anchors only where they actually scroll to
  existing page sections.
- Use the project `Link` component for application navigation.

Acceptance:

- English and Arabic hero, roadmap, and final primary CTAs reach the intended
  localized route.
- Cmd/Ctrl-click and middle-click work.
- Playwright covers the final CTA because it was the broken terminal action.

### 2. Add an explicit unverified-owner dashboard state

Affected files:

- `apps/web/src/features/dashboard/dashboard-state.ts`
- `apps/web/src/features/dashboard/dashboard-home.tsx`
- `apps/web/src/features/dashboard/dashboard-panels.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ar.json`
- Dashboard unit and Playwright fixtures/tests

Current problem:

- `CurrentJourneyResponse.owner.email_verified` is discarded while mapping the
  dashboard state.
- An unverified response therefore renders the same journey and primary actions
  as a verified owner.
- A failed `GET /journey/current`, including authentication or authorization
  errors, is collapsed into the generic unavailable state and exposes a Start
  Discovery action.

Required change:

- Preserve verification status in the dashboard projection or branch before
  mapping the journey.
- Render a truthful verification-required panel with the appropriate resend or
  sign-in guidance.
- Do not render start, continue, review, or view-Discovery actions while the
  owner is unverified.
- Handle API errors by status:
  - `401`: clear/refresh the session and redirect to localized login;
  - `403` or an unverified-owner response: show verification guidance;
  - retryable server/network failure: show the retry state without claiming the
    journey is unavailable.
- Do not expose a Start Discovery action merely because the dashboard request
  failed.

Acceptance:

- Unit and Playwright tests cover verified, unverified, `401`, `403`, and `500`
  responses in both locales.
- Unverified owners never receive a journey CTA.
- A `401` after initial session bootstrap returns the user to login instead of
  leaving a stale authenticated shell visible.

### 3. Establish a real workspace authorization boundary

Affected files to inspect first:

- `apps/web/src/app/[locale]/(workspace)/layout.tsx`
- `apps/web/src/features/auth/require-auth.tsx`
- `apps/web/src/features/auth/session-provider.tsx`
- `apps/web/src/proxy.ts`
- `apps/web/src/lib/api/client.ts`
- Relevant API authentication cookie configuration

Current problem:

- `WorkspaceLayout` wraps its children with the client-only `RequireAuth`.
- This is a useful loading/redirect experience, but it is not server-side
  authorization for Server Components or future server-side data reads.
- `proxy.ts` currently handles locale negotiation only.

Required change:

- Inspect the existing refresh-cookie path/domain and token model before
  choosing an implementation.
- Add a server-verifiable session/DAL or a compatible server-side prefilter for
  workspace routes.
- Keep secure authorization next to protected data: Nest endpoints must retain
  JWT and RBAC guards regardless of any Next.js route prefilter.
- Keep `RequireAuth` only as a client UX layer, not the authoritative security
  check.
- Do not implement a cookie-presence check and describe it as secure session
  validation. If the current cookie architecture cannot support server
  verification without a broader BFF/session change, document the blocker and
  request an architecture decision instead of weakening the boundary.

Acceptance:

- An unauthenticated direct request to every workspace route is redirected
  before protected workspace data can be rendered or serialized.
- Client-side navigation between workspace routes cannot bypass authorization.
- Nest API authorization remains the final data-access boundary.
- Regression tests cover direct URL entry and navigation after session expiry.

### 4. Correct public product-scope claims

Affected source:

- Move the final copy into `apps/web/messages/en.json` and
  `apps/web/messages/ar.json` as described in step 7.
- Current copy is in `apps/web/src/features/landing/lib/content.ts`.

Current problems:

- The live research-progress preview includes competitor search and market
  demand research.
- MarketMind's approved boundary says Discovery must not research competitors.
- The page describes the progress preview as connected and showing real work,
  which makes planned behavior look active.

Required change:

- Remove competitor research from the current Discovery flow.
- If competitor and market research remain on the roadmap, place them only in a
  clearly planned later Research/Strategy phase.
- Ensure every `live`, `planned`, `connected`, and `available now` label matches
  actual implementation state.
- Review both Arabic and English for equivalent meaning rather than literal
  translation.

Acceptance:

- Discovery is described only as business-understanding research, evidence
  filtering, owner questions, and owner-confirmed profile creation.
- No future capability appears as an active integration.
- Human product review confirms the page matches the current MVP boundary.

### 5. Replace unsupported privacy and timing claims

Affected source:

- Current FAQ copy in
  `apps/web/src/features/landing/lib/content.ts`.
- Final copy should live under the new landing translation namespace.

Current problems:

- The page says owner data is not shared with any other party, while Discovery
  uses external AI and search service providers.
- The page says most initial research completes within minutes without verified
  measurement or a documented service target.

Required change:

- Replace the no-sharing statement with reviewed wording that distinguishes
  selling/sharing data from processing by approved service providers.
- Do not invent provider, retention, security, or deletion promises. Base the
  wording on an approved privacy policy or have the product owner approve the
  precise temporary copy.
- Remove the timing claim unless the team has measured evidence and an approved
  service expectation.
- Remove or disable placeholder Privacy, Terms, social, and contact destinations
  until they point to real approved destinations; do not use `href="#"` as a
  fake link.

Acceptance:

- No unconditional legal/privacy claim conflicts with the system architecture.
- No unsupported performance number or timing guarantee remains.
- Placeholder links are not exposed as functioning navigation.

### 6. Stop inventing missing journey facts

Affected files:

- `apps/api/src/modules/journey/journey.service.ts`
- `packages/contracts/src/journey/current-journey.ts`
- `packages/contracts/examples/current-journey.response.json`
- `packages/contracts/scripts/validate-examples.mjs`
- Journey service, contract, dashboard-state, and UI tests

Current problem:

- When neither intake nor a confirmed profile provides business details, the
  service emits `Unknown business`, `Unknown type`, and `Unknown city` as if they
  were real values.
- These values are also English-only and can appear in the Arabic dashboard.

Required change:

- Prefer nullable business-summary fields and let the localized frontend render
  its existing unavailable presentation.
- If the domain guarantees that these fields must exist, fail with a clear data
  inconsistency instead of fabricating values. Add a test proving the invariant.
- Update TypeScript contracts, JSON example validation, API mappings, and both
  frontend locales consistently.

Acceptance:

- No fabricated business identity, type, city, area, metric, or source appears.
- Missing fields render through localized UI copy.
- Contract and API tests cover the missing-data case.

### 7. Move landing copy into the approved i18n system

Affected files:

- `apps/web/src/features/landing/lib/content.ts`
- `apps/web/src/features/landing/landing-copy-provider.tsx`
- Landing components under `apps/web/src/features/landing/`
- `apps/web/messages/en.json`
- `apps/web/messages/ar.json`
- `apps/web/src/i18n/types.ts` only if type augmentation genuinely requires a
  change

Current problem:

- Both complete locale trees live in a client TypeScript object.
- Landing copy bypasses typed `next-intl` keys and dictionary parity.
- Every visitor downloads both languages, and the copy provider forces the
  whole landing experience into a client-oriented data path.

Required change:

- Add a `Landing` namespace to both message dictionaries.
- Use `getTranslations('Landing')` in Server Components and
  `useTranslations('Landing')` only in components that require client behavior.
- Keep static copy and sections as Server Components by default.
- Pass only the minimal translated strings/data needed by animated client
  islands.
- Delete the duplicate copy object/provider after all consumers migrate.
- Preserve exact Arabic/English key parity.

Acceptance:

- `npm run check:dictionary -w @marketmind/web` covers all landing copy.
- Invalid landing translation keys fail TypeScript.
- The production client bundle does not include the complete inactive locale.
- Public content remains server-rendered and crawlable.

### 8. Make mobile drawers accessible and RTL-correct

Affected files:

- `apps/web/src/components/layout/app-shell-mobile-nav.tsx`
- `apps/web/src/features/landing/components/Nav.tsx`
- App-shell and Playwright tests

Required change:

- On open, move focus to the drawer's first appropriate control.
- Trap focus within the open drawer.
- Close on Escape and backdrop activation.
- Restore focus to the trigger after closing.
- Prevent background interaction with `inert` or an established accessible
  dialog/sheet primitive.
- Lock background scrolling while open.
- Add visible `focus-visible` styles to open and close controls.
- Use logical positioning so the drawer opens from the start edge in both LTR
  and RTL; remove hard-coded `left`, `right`, `border-r`, and one-direction-only
  transforms where logical equivalents apply.
- Verify reduced motion for every Framer Motion animation, not only selected
  components.

Acceptance:

- Keyboard-only users cannot tab behind the drawer.
- Escape closes it and returns focus to the trigger.
- English opens from the LTR start edge and Arabic from the RTL start edge.
- Mobile tests run at 375 px or narrower in both locales.
- `prefers-reduced-motion: reduce` disables non-essential motion.

### 9. Revert the unrelated Nest CLI side effect

Affected file:

- `apps/api/nest-cli.json`

Required change:

- Restore mail-template `watchAssets` to `true`.
- Keep the final newline normalization.
- Confirm the Journey resource does not require any other Nest CLI
  configuration change.

Acceptance:

- Mail template edits continue to be copied during `nest start --watch`.
- The PR contains no unrelated Nest CLI behavior change.

### 10. Clean verification failures and warnings

Affected files include:

- `apps/web/e2e/dashboard.spec.ts`
- `apps/web/src/features/landing/components/HeroPointerEffect.tsx`
- `apps/web/src/features/landing/components/SampleResult.tsx`
- New landing component files reported by `git diff --check`

Required change:

- Scope the onboarding `Next` locator to the onboarding dialog or use an exact
  accessible-name match so the local Next.js DevTools button is not selected.
- Fix the missing React hook dependencies without introducing stale closures.
- Replace the sample `<img>` with `next/image` and provide stable dimensions and
  responsive sizing.
- Remove all trailing whitespace from the PR.
- Do not commit Playwright reports, screenshots, `.last-run.json` changes, or
  generated build output unless an artifact is intentionally required.

Acceptance:

- No new lint warnings.
- Local and CI-mode dashboard Playwright tests both pass.
- `git diff --check` exits successfully.

## Test additions required

Add or update regression coverage for:

- final public CTA navigation in English and Arabic;
- unverified owner guidance and absence of journey actions;
- `401`, `403`, and `500` journey responses;
- session expiration after the workspace has already rendered;
- direct unauthenticated access to every workspace route;
- null/missing business facts in contract, API, and dashboard mapping;
- mobile drawer Escape, focus trap, focus restoration, and RTL side;
- reduced-motion behavior for landing animations;
- copy/key parity after removing the custom landing-copy provider.

## Verification commands

Run from the repository root unless noted:

```bash
npm run agent:doctor -- --available-mcp context7
npm run check -w @marketmind/contracts
npm run build -w @marketmind/api
npm run test -w @marketmind/api -- --runInBand
npm run check -w @marketmind/web
npm run build -w @marketmind/web
npm run test:e2e -w @marketmind/web -- e2e/dashboard.spec.ts e2e/session.spec.ts
git diff --check
```

Then run the full repository check when its Docker-backed dependencies are
available:

```bash
npm run check
```

Manual/browser verification must cover:

- English and Arabic;
- desktop at 1280 px or wider;
- mobile at 375 px or narrower;
- keyboard-only navigation;
- reduced-motion mode;
- unauthenticated, unverified, verified/no-journey, active Discovery, summary
  review, confirmed profile, expired session, and API-failure states;
- console and network errors during CTA, locale switch, drawer, login redirect,
  and dashboard retry flows.

## Completion checklist

- [ ] Primary landing CTAs navigate to a real localized route.
- [ ] Unverified owners see verification guidance and no journey CTA.
- [ ] Workspace authorization is not dependent solely on client rendering.
- [ ] Current Discovery copy contains no competitor-research claim.
- [ ] Unsupported privacy and timing claims are removed or approved.
- [ ] Missing business facts remain null/explicitly unavailable.
- [ ] Landing copy is covered by typed dictionaries and parity checks.
- [ ] Mobile drawers pass keyboard, focus, RTL, and reduced-motion review.
- [ ] Nest mail assets still watch during development.
- [ ] API, contracts, web checks, builds, and affected Playwright tests pass.
- [ ] `git diff --check` passes with no trailing whitespace.
- [ ] A human can explain and verify every product claim and route decision.

## Re-review handoff

When implementation is complete, provide the reviewer with:

- a mapping from each numbered section above to the fixing commit and tests;
- exact command results, including Playwright project/locale counts;
- screenshots for desktop/mobile English and Arabic;
- any approved privacy/product wording decision;
- confirmation that the PR head was reviewed after the final push.
