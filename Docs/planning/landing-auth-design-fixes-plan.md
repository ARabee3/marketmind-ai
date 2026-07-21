# Landing & Auth Pages — Design / A11y Fix Plan

**Target implementer:** Gemini (or any agent following opencode conventions).
**Scope:** `apps/web` landing page and auth flow only. Do not touch the API,
the AI service, contracts, or the dashboard/discovery features.
**Base branch:** work on a new branch off `main`; do not push or open a PR
unless asked.

## 0. Read this first

Before writing any code:

1. Read `apps/web/AGENTS.md` in full — it defines i18n ownership, RTL rules,
   the shadcn-first component policy, the design tokens, and the testing
   requirements. Every change in this plan must comply with it.
2. Read the root `AGENTS.md` sections **Design System**, **Design & Voice
   Brief**, and **Anti-patterns**. The MarketMind voice is *trustworthy,
   practical, Arabic-first, grounded in evidence* — **not** futuristic,
   glassy, or sci-fi. Do not introduce purple gradients, glassmorphism,
   sparkle/robot imagery, or industry-specific decoration.
3. Use two-space indentation, LF endings, final newlines (`.editorconfig`).
4. Never hard-code user-visible strings — all text comes from
   `messages/{en,ar}.json` via the `Auth`, `Common`, or `Landing.*`
   namespaces.
5. After every change, run from `apps/web`:
   - `npm run check` (or the root equivalent)
   - `npm run typecheck`
   - `npm run check:dictionary`
   - `npm run test`
   - `npm run test:e2e -- --grep "landing|auth|locale"` (or rename as needed)
6. Do not commit unless the user explicitly says so.

## 1. Global conventions to follow on every edit

- **RTL:** use Tailwind logical properties (`ps`/`pe`, `ms`/`me`,
  `start-`/`end-`, `inset-inline-start`). Never `left`/`right` unless the
  physical direction is truly immutable. Directional icons flip with
  `scaleX(-1)` or the `dir` attribute.
- **Focus:** every interactive element already has or must gain
  `focus-visible:ring-*`. Never use `outline-none` without a replacement.
- **i18n:** all new strings go into *both* `messages/en.json` and
  `messages/ar.json` under the correct namespace, then run
  `npm run check:dictionary`.
- **Forms:** inputs need `label` (or `aria-label`), `name`, correct `type`,
  `autoComplete`, `spellCheck`, and `inputMode` where relevant.
- **Tests:** update the co-located Vitest tests and the Playwright specs
  touched by the change. Add assertions for the new behaviour, not just a
  re-snapshot.

## 2. Issues grouped by file (with exact fixes)

Each item lists the file path, the line range as it is today, the rule that
is broken, and the concrete change. Lines may shift; match on the text.

### 2.1 `apps/web/src/components/ui/button.tsx`

**Issue:** base CVA class uses `transition-all` (Web Interface Guidelines
anti-pattern; also re-renders box-shadow/transform too broadly and conflicts
with the tactile hover we use elsewhere).

**Fix:**
- Replace `transition-all` in line 7 with an explicit property list:
  `transition-colors, transition-shadow, transition-[transform]`.
- Keep the existing `focus-visible:*` and `active:translate-y-px` behaviour
  intact.
- The `transition-[transform]` keeps `active:translate-y-px` working.

**Verify:** run `apps/web` unit tests; every auth Button and CTA Button must
still visually press. The Google button (which uses `buttonVariants`) must
not jump unexpectedly on hover.

---

### 2.2 `apps/web/src/app/[locale]/(auth)/layout.tsx`

**Issue A (a11y):** the aside renders an `<h2>` (line 38) **before** the
`<h1>` rendered by `AuthCard` (inside `children` further down). Screen
reader outlines see `<h2> → <h1>` which is out of order.

**Fix A (preferred):**
- In `AuthCard`, demote the title to `<h2>` and add a visually-hidden `<h1>`
  on each auth page that names the page purpose (e.g.
  `<h1 className="sr-only">{t('loginTitle')}</h1>` at the top of
  `login/page.tsx`, `register/page.tsx`, etc.). The visible card heading
  stays as `<h2>`.
- Alternatively, keep `AuthCard` `<h1>` and demote the aside's
  `authShellTitle` from `<h2>` to a `<p>` (since it is marketing, not the
  page's primary heading). Use the second option if the team prefers.

Implement option B (simpler, fewer test changes) unless the team prefers
option A:
- Replace `<h2 className="max-w-xl text-3xl ...">{auth('authShellTitle')}</h2>`
  with `<p className="max-w-xl text-3xl ...">` keeping the same classes.
- Keep the eyebrow `<p>` and the list `<ol>` as-is.

**Issue B (contrast):** step list items use `bg-white/[0.06]` on `bg-navy`
(~1.05:1). The "1 / 2 / 3" cards visually merge.

**Fix B:** bump the item background to `bg-white/[0.12]`, and bump the
border `border-white/15` → `border-white/20`. Re-check contrast in both
locales (the navy text on `bg-journey-mint` circle is fine; the surrounding
card is the issue).

**Issue C (design voice):** line 16 radial `--color-soft-teal` plus line 17
`bg-primary/10 blur-3xl` blob stacks two soft decorations in the same
region. The MarketMind brief disallows glassmorphism / "excessive floating
cards" and asks for grounded, evidence-led visuals.

**Fix C:** keep exactly one decoration in the top region — drop line 17
(the `bg-primary/10` blob) and keep the radial. Keep the aside's two blobs
(lines 31–32) since they are on a dark navy surface where they read as
intentional texture, not glassmorphism.

**Verify:** Playwright `locale.spec.ts` — open both locales, screenshot the
auth shell, confirm the step list reads as three distinct cards and the top
decoration is no longer doubled.

---

### 2.3 `apps/web/src/features/auth/auth-card.tsx`

**Issue:** description on top and footer both use
`text-muted-foreground`. `--color-muted-foreground` is `#5B6B7B` on
`#FFFFFF` surface → ~4.6:1 (passes AA for normal text), so this is OK. No
change required, but **audit** before merging: confirm `text-sm` description
still passes with the rendered font weight.

**Optional polish:** add `min-h-[1.25rem]` to the description slot so the
card height doesn't shift on pages without a description (verify / reset
password pages).

---

### 2.4 Auth forms — shared fix pattern

Applies to each of:
- `apps/web/src/features/auth/login-form.tsx`
- `apps/web/src/features/auth/register-form.tsx`
- `apps/web/src/features/auth/forgot-password-form.tsx`
- `apps/web/src/features/auth/reset-password-form.tsx`
- `apps/web/src/features/auth/resend-verification-form.tsx`

**Shared fix 1 — email inputs:** add `spellCheck={false}` and
`autoCapitalize="none"` and `inputMode="email"` to every email `<Input>`.

**Shared fix 2 — focus first invalid field on submit:**
- Add a `useRef` per field (or one ref container object). On submit, if
  `!validate()`, call `firstErrorRef.current?.focus()` on the earliest
  errored input. Use `refs` rather than `document.getElementById` so the
  pattern composes.
- Keep the existing `aria-describedby` wiring; wrap each inline error `<p>`
  with `role="alert"` (or add `aria-live="polite"` — choose `role="alert"`
  for `errors.root` and inline field errors so they announce on
  appearance). Do **not** add `role="alert"` to the success/state banners
  that already use `role="status"`; those should stay as-is.

**Shared fix 3 — submit affordance:**
- Keep `disabled={isSubmitting}` (acceptable) **or** switch to the
  recommended pattern: keep the button enabled, set `aria-busy={isSubmitting}`
  on the form, render a small spinner inside the button with
  `aria-hidden`, and keep the loading label. Prefer the existing
  `disabled` pattern for minimal churn unless the team wants the spinner
  affordance.

Apply these per file. Add or update the co-located Vitest test to assert:
- the email `<Input>` has `spellCheck={false}`;
- submit with empty fields moves focus to the first invalid input;
- an inline error appears with `role="alert"` on submit.

---

### 2.5 `apps/web/src/features/auth/register-form.tsx`

**Issue:** `register-form.tsx:130` calls
`{t(errors.name, { min: MIN_PASSWORD_LENGTH })}` — the `min` param only
applies to password errors; passing it to a *name* error is a copy/paste
bug.

**Fix:** change to `{t(errors.name)}` (no params). If a name-specific
param is ever needed later, add one then.

---

### 2.6 `apps/web/src/features/auth/reset-password-form.tsx`

**Issue:** success view at line 150 uses
`<Button onClick={() => router.push('/login?reset=true')}>` instead of a
link. Per guidelines, navigations should be `<Link>` so Cmd/Ctrl-click and
middle-click work.

**Fix:** replace the `<Button type="button" onClick={...}>` with
`<Link href="/login?reset=true" className={authStyles.primaryButton}>`.
Import `Link` from `@/i18n/navigation` (already imported in this file).
Add a data-attribute or `role` if styling needs the button look — the
`authStyles.primaryButton` classes already produce a button-shaped CTA.

**Verify:** update `reset-password-form.test.tsx` to click the link (it
should now be an `<a>` rather than `<button>`); the Playwright
`reset-password.spec.ts` should still pass.

---

### 2.7 `apps/web/src/features/auth/verify-email-handler.tsx`

**Issue A:** the "verifying" state (line 57–67) uses an `animate-pulse` dot
as the only affordance. It doesn't read as a progress affordance.

**Fix A:** replace the pulsing dot with a small accessible spinner:
- Render an SVG spinner with `aria-hidden="true"`, animated via CSS
  `animate-spin` (Tailwind built-in) — or a single `border-2 border-primary
  border-t-transparent rounded-full size-6 animate-spin` div (no extra CSS
  file).
- Keep the visible `t('verifyEmailVerifying')` text and the
  `role="status"` + `aria-live="polite"` wrapper.
- Respect reduced motion: if `useReducedMotion()` is true (import from
  `@/features/landing/lib/motion` — already used by Reveal), render a
  static ring instead of `animate-spin`.

**Issue B:** the `<Link>` styled as button at line 75 uses
`buttonVariants()` (default variant = `bg-primary`). Make sure it visually
matches the rest of the auth primary CTAs (which use
`authStyles.primaryButton` tactile styling). If it looks flat compared to
the tactile buttons, switch the className to
`cn(authStyles.primaryButton, 'mt-1 w-full')` and drop
`buttonVariants()`. Verify with a screenshot in both locales.

---

### 2.8 `apps/web/src/features/auth/google-auth-button.tsx`

**Issue A (security):** the `<a href>` to `${API_BASE_URL}/auth/google`
crosses origins and lacks `rel`.

**Fix A:** add `rel="noopener noreferrer"` to the `<a>` at line 15.

**Issue B (hover prominence):** hover styles are `hover:bg-white
hover:text-navy` — same as the rest state. Hovers must *increase*
prominence.

**Fix B:** add a subtle lift and border change:
`hover:-translate-y-px hover:border-primary/40 active:translate-y-px`.
Keep `bg-white text-navy` as the rest state. Make the focus-visible ring
use `focus-visible:ring-action` (currently inherits the default ring; add
classes explicitly because this is an `<a>`, not a `<Button>`).

**Issue C (separator semantics):** the divider wrapper at line 28 has
`role="separator" aria-label={t('orDivider')}`. A horizontal rule wrapped
in a flex layout is an odd AT affordance.

**Fix C:** drop `role="separator"` and `aria-label`; keep the visible
`{t('orDivider')` text. Add `<hr className="sr-only" />` *if* a programmatic
separator is wanted. Simplest: remove `role` and `aria-label` entirely —
the visible "or" text is enough.

**Verify:** add / extend `__tests__` for the Google button asserting
`rel="noopener noreferrer"` is present and the divider no longer advertises
`role="separator"`.

---

### 2.9 `apps/web/src/features/landing/components/Hero.tsx`

**Issue A (RTL bug — high priority):** line 56 uses `-right-3 -top-7` for
the decorative search badge. In Arabic it renders on the wrong side of the
preview card.

**Fix A:** replace `-right-3` with `-end-3`. Tailwind resolves `end-3` to
`inset-inline-end`. Keep `-top-7`.

**Issue B (deep-link scroll):** the `#top` anchor is the Hero section
itself. A `scroll-margin-top` is needed so deep links don't sit under the
fixed nav.

**Fix B:** add `scroll-mt-28` (or `scroll-mt-32` to match the ~104–120px
nav offset) to the `<section id="top">` className.

**Issue C (token contrast — verify, do not assume):** the hero "note"
line uses `text-muted`. `--color-muted-foreground` is `#5B6B7B` on
`bg-bg #F7F8FA` → ~4.4:1, borderline at 13px. Two options:
1. Switch the note to `text-ink-soft` (already used in the body line
   above — `ink-soft` is the project's plain secondary text token).
2. Bump the font size from `text-[13px]` to `text-[14px]` (≥14px is
   "large text" for AA purposes and the ratio passes).

Pick option 1 (use `text-ink-soft`) to keep the size and hierarchy.

**Verify:** Playwright `landing.spec.ts` — assert the search badge sits on
the inline-end edge of the preview card in both LTR and RTL (use
`getBoundingClientRect` and compare `left`/`right` against the card).

---

### 2.10 `apps/web/src/features/landing/components/Nav.tsx`

**Issue A (design voice — high priority):** line 98 uses
`bg-surface/90 backdrop-blur-md` which is glassmorphism. MarketMind brief
explicitly bans it.

**Fix A:** use a solid `bg-surface` at rest; only apply a subtle shadow
(`shadow-header`) — that's already in the className. When `scrolled`, keep
the existing deeper shadow. Replace:
```
bg-surface/90 ... backdrop-blur-md transition-shadow
```
with:
```
bg-surface ... transition-shadow
```
Confirm the nav still reads as floating (via the existing `shadow-header`
and rounded full border) without translucent blur.

**Issue B (skip link RTL):** skip link in `landing-shell.tsx:23` uses
`focus:right-4 focus:top-4`. In RTL it should appear at the inline-start
edge.

**Fix B:** change `focus:right-4` to `focus:start-4` (Tailwind logical).
The link is already `sr-only focus:not-sr-only`, so just swap the position
class.

**Issue C (mobile menu button):** already passes. No change.

---

### 2.11 `apps/web/src/components/language-switcher.tsx`

**Issue A (hover prominence):** hover is `hover:bg-background` only.

**Fix A:** add `hover:border-primary/40 hover:text-primary` so the border
and label colour shift visibly.

**Issue B (a11y announcement — defined in `apps/web/AGENTS.md`):** "Language
switches must announce the new language to screen readers." Currently
silent.

**Fix B:** add an `aria-live="polite"` announcement region. Two accepted
options:

1. **Option 1 (preferred):** on locale change, push a hidden status
   region update:
   ```tsx
   const [announce, setAnnounce] = useState('')
   function switchLocale(next: string) {
     router.replace(pathname, { locale: next })
     setAnnounce(t('languageSwitchedTo', { lang: labelFor(next) }))
   }
   // JSX:
   <span aria-live="polite" className="sr-only">{announce}</span>
   ```
   Add a new `Common.languageSwitchedTo` key to both `messages/en.json`
   and `messages/ar.json` (e.g. en: `"Language switched to {lang}"`,
   ar: `"تم التحويل إلى {lang}"`). Re-run `npm run check:dictionary`.

2. **Option 2 (simpler):** rely on the fact that `router.replace` triggers
   a full route change and update `<html lang>` on the new page (Next.js
   app router already sets this from `[locale]`). Add a `useEffect` that
   calls `document.title` change; screen readers often announce title
   changes. Less robust than Option 1.

Use **Option 1**.

**Verify:** add a Vitest test asserting the switcher renders the
announcement region with the expected message after `switchLocale` is
called (mock `next-intl` and the router). Extend `locale.spec.ts` to assert
the `aria-live` region updates after switching.

---

### 2.12 `apps/web/src/features/auth/auth-styles.ts`

**Issue (hover polish):** `primaryButton` uses
`hover:translate-y-px hover:shadow-tactile-pressed active:translate-y-px
active:shadow-tactile-pressed`.

**Fix:** change `hover:translate-y-px` to `hover:-translate-y-px` so the
button lifts on hover (more conventional tactile affordance). Keep
`active:translate-y-px active:shadow-tactile-pressed`.

---

### 2.13 Placeholders and meta — cross-cutting

**Issue A (placeholders):** Web Interface Guidelines require placeholders
end with `…` and show an example pattern. Audit every `*Placeholder` key in
`messages/en.json` and `messages/ar.json` under `Auth` and `Landing.*`:
- each ends with `…` (curly ellipsis), not `...`;
- each shows an example pattern where it helps the user (e.g. email
  placeholders include a sample like `name@example.com`).

Run `rg '"[^"]*Placeholder"\s*:\s*"[^"]*"' apps/web/messages/en.json
apps/web/messages/ar.json` and fix any non-compliant value. Keep meaning
identical across locales.

**Issue B (theme-color meta):** the root layout
`apps/web/src/app/[locale]/layout.tsx` should set
`<meta name="theme-color" content="#F7F8FA">` (or via
`generateMetadata`) so mobile browser chrome matches `bg-bg`. Add it if
absent. If a dark theme is planned later, this becomes a media query; for
now a single light value is correct because the site is light-only.

**Issue C (ellipsis audit):** already verified `Common.loading` uses `…`.
Re-audit any other user-visible strings that show progress ("Submitting…",
"Signing in…", etc.) and convert `...` to `…`. Use
`rg '\.\.\.' apps/web/messages` (escaped) and review hits.

---

## 3. Suggested implementation order

Build in small, test-runnable chunks. Commit after each chunk (if the
user asks). Each chunk should leave `npm run check`, `typecheck`,
`check:dictionary`, and `test` green.

1. **Chunk 1 — primitives and design-tokens hygiene**
   - `button.tsx` `transition-all` → explicit.
   - `auth-styles.ts` hover lift.
   - Run unit tests.

2. **Chunk 2 — RTL and skip-link correctness (high-impact, small)**
   - `Hero.tsx` `-right-3` → `-end-3`; add `scroll-mt-28`.
   - `landing-shell.tsx` skip link `focus:right-4` → `focus:start-4`.
   - Run `locale.spec.ts` in both LTR and RTL.

3. **Chunk 3 — auth layout a11y and decoration**
   - `(auth)/layout.tsx`: demote `<h2>` to `<p>`; bump step card
     `bg-white/[0.06]` → `/[0.12]` and `border-white/15` → `/20`; remove
     the redundant primary blob at line 17.
   - Run auth e2e specs.

4. **Chunk 4 — form a11y (shared fixes)**
   - Apply "Shared fix 1 / 2 / 3" to every auth form listed in §2.4.
   - Fix `register-form.tsx:130` bogus `min` param.
   - Update each co-located Vitest test to assert focus-on-error and
     `role="alert"` on inline errors.

5. **Chunk 5 — Google button and reset success link**
   - `google-auth-button.tsx` `rel`, hover lift, separator cleanup.
   - `reset-password-form.tsx` success Button → `<Link>`.
   - `verify-email-handler.tsx` accessible spinner (reduced-motion aware)
     and primary-CTA styling alignment.

6. **Chunk 6 — language switcher announcement**
   - Add `Common.languageSwitchedTo` to both message files.
   - Add `aria-live` announcement region in `language-switcher.tsx`.
   - Add hover border/text bump.
   - Extend `language-switcher.test.tsx` and `locale.spec.ts`.

7. **Chunk 7 — Nav glassmorphism removal**
   - `Nav.tsx` solid surface (drop `backdrop-blur-md` and `/90`).
   - Screenshot before/after; verify the nav still floats via shadow.

8. **Chunk 8 — messages + meta housekeeping**
   - Placeholder `…` audit in `messages/en.json` and `messages/ar.json`.
   - Add `<meta name="theme-color">` to the root locale layout if absent.
   - Run `npm run check:dictionary`.
   - Smoke both locales with `locale.spec.ts`.

## 4. Verification checklist (Definition-of-Done)

Before declaring done, every item below must be true. The
`apps/web/AGENTS.md` final-review checklist is the canonical source; this
is a condensed version scoped to this plan.

- [ ] `npm run check` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run check:dictionary` passes (en/ar key parity).
- [ ] `npm run test` (Vitest) passes with new assertions for:
  - form focus-on-first-error;
  - inline error `role="alert"`;
  - email input `spellCheck={false}`;
  - Google button `rel="noopener noreferrer"`;
  - language switcher `aria-live` announcement.
- [ ] `npm run test:e2e` passes for: `landing.spec.ts`, `auth.spec.ts`,
  `forgot-password.spec.ts`, `reset-password.spec.ts`, `verify-email.spec.ts`,
  `oauth-callback.spec.ts`, `locale.spec.ts`, `mobile-shell.spec.ts`.
- [ ] Manual screenshot diff (LTR `en` and RTL `ar`) for: landing hero,
  nav (rest + scrolled), footer, every auth page.
- [ ] No new hardcoded strings; all new keys exist in both `messages/*.json`.
- [ ] No `transition: all`, no `outline-none` without a focus replacement,
  no `role="separator"` on the Google divider.
- [ ] Hero decorative badge sits on the inline-end edge in `ar` (RTL).
- [ ] Skip link appears at the inline-start corner in `ar`.
- [ ] Auth layout has a single `<h1>` (visually hidden) or the aside uses
  `<p>` instead of `<h2>`; heading outline is sequential.
- [ ] No glassmorphism (`backdrop-blur-*`) remains on landing or auth.
- [ ] `<meta name="theme-color" content="#F7F8FA">` is present.
- [ ] Commit messages follow the repo's `Docs/planning/07_GIT_CONVENTIONS.md`
  conventions. Do not push or open a PR unless explicitly asked.

## 5. Things explicitly NOT to do

- Do not introduce a dark theme, animations beyond the existing reduced-
  motion-aware set, or new UI libraries / shadcn registry blocks.
- Do not restyle the dashboard, discovery, or any feature outside the
  `(landing)` and `(auth)` route groups.
- Do not change the design tokens in `globals.css` (`--color-*`,
  `--shadow-*`, `--journey-mint`, etc.) without team review. This plan
  never requires editing `globals.css`.
- Do not bulk-add translation keys; add the one new
  `Common.languageSwitchedTo` key only.
- Do not amend, force-push, or open a PR. Leave the work as commits on a
  local branch and hand back to the reviewer.

## 6. Quick reference — files touched

| File | Change |
| --- | --- |
| `apps/web/src/components/ui/button.tsx` | `transition-all` → explicit |
| `apps/web/src/features/auth/auth-styles.ts` | hover lift |
| `apps/web/src/features/landing/components/Hero.tsx` | RTL `end-3`, `scroll-mt`, `text-ink-soft` |
| `apps/web/src/features/landing/landing-shell.tsx` | skip link `focus:start-4` |
| `apps/web/src/app/[locale]/(auth)/layout.tsx` | `<h2>`→`<p>`, step card contrast, remove doubled blob |
| `apps/web/src/features/auth/auth-card.tsx` | optional description min-height |
| `apps/web/src/features/auth/login-form.tsx` | email `spellCheck`, focus-first-error, `role="alert"` |
| `apps/web/src/features/auth/register-form.tsx` | same + drop bogus `min` param |
| `apps/web/src/features/auth/forgot-password-form.tsx` | same |
| `apps/web/src/features/auth/reset-password-form.tsx` | same + success Button → Link |
| `apps/web/src/features/auth/resend-verification-form.tsx` | same |
| `apps/web/src/features/auth/verify-email-handler.tsx` | accessible spinner, CTA styling |
| `apps/web/src/features/auth/google-auth-button.tsx` | `rel`, hover lift, separator cleanup |
| `apps/web/src/features/landing/components/Nav.tsx` | drop glassmorphism |
| `apps/web/src/components/language-switcher.tsx` | hover prominence, `aria-live` announcement |
| `apps/web/messages/en.json`, `apps/web/messages/ar.json` | new `Common.languageSwitchedTo`, placeholder audit |
| `apps/web/src/app/[locale]/layout.tsx` | `<meta name="theme-color">` |
| `apps/web/src/**/__tests__/*.test.{ts,tsx}` | new assertions for the above |
| `apps/web/e2e/*.spec.ts` | extend with RTL/screenshots where noted |