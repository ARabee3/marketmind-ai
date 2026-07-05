# Frontend Definition of Done

A frontend change under `apps/web` is done only when **all** of the following
are true. Use this as the closing checklist.

## Code correctness

- `npm run check` (`typecheck && lint && test && check:dictionary`) is green.
- `npm run build` produces a successful production build.
- No new TypeScript `any` introduced without justification.
- shadcn primitives render styled — every semantic token referenced by
  `src/components/ui/*` is defined in `src/app/globals.css` (Tailwind v4
  `@theme inline`). Missing tokens silently drop styles; verify visually.

## i18n

- No hard-coded user-visible strings in JSX, labels, placeholders,
  `aria-label`s, or error messages. Everything comes from
  `messages/{en,ar}.json`.
- `npm run check:dictionary` passes — both locale files have identical key
  sets.
- `next-intl` is type-augmented (`src/i18n/types.ts` augments `use-intl`'s
  `AppConfig`); invalid keys fail `npm run typecheck`.
- Dates, numbers, currencies, and percentages use locale-aware formatters.

## Routing & locales

- Next.js 16 uses `src/proxy.ts` (not `middleware.ts`). Unprefixed URLs are
  negotiated via `NEXT_LOCALE` cookie → `Accept-Language` → default `ar`, and
  the rest of the path is preserved. No custom locale redirects.
- Both directions of language switching preserve the current route.

## Responsive shell

- Page content renders inside `AppShell` (desktop sidebar 240px + mobile top
  bar + mobile bottom nav; content in a centered `max-w-[1200px]` container,
  desktop offset `md:ms-[240px]`).
- Verified at ≥1 desktop (≥1280px) and ≥1 mobile (≤375px) breakpoint.
- No layout relies on `left`/`right`; logical properties (`ms`/`me`,
  `ps`/`pe`, `inset-inline-start`) are used so RTL flips correctly.

## Accessibility

- Every interactive element has an accessible name (visible label,
  `aria-label`, or `aria-labelledby`).
- Semantic HTML (`<nav>`, `<main>`, `<button>`, `<a>`); no `<div>` click
  handlers.
- Keyboard reachable and operable; visible focus styles.
- Color contrast meets WCAG AA for all text in both light and dark mode.
- Directional icons flip in RTL (`scaleX(-1)` or `dir`).
- `prefers-reduced-motion` respected for any animation.

## Visual direction (when styling/designing)

- `frontend-design` skill was used to establish direction.
- Output does not fall into generic AI aesthetics (purple gradients,
  glassmorphism, sparkle/robot imagery, sci-fi styling) or industry-specific
  decoration.
- The product reads as a trustworthy, practical, Arabic-first SME workspace —
  not a generic SaaS dashboard.
- Palette/type decisions draw only from the approved tokens in
  `references/product-visual-brief.md` and `src/app/globals.css`.

## Evidence & owner control (product rules)

- AI suggestions are explainable and cite business evidence when available.
- Failed integrations are surfaced, not hidden. Demo/simulated data is clearly
  labeled.
- Owner approval gates and undo paths remain visible.

## Verification evidence

- Committed Vitest / Playwright tests cover the new behavior and pass.
- Playwright MCP may be used for exploratory checks, but the committed tests
  are authoritative.
- Both LTR and RTL Playwright traces captured for layout-affecting changes.
- A final `web-design-guidelines` review pass was performed.