<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Frontend Conventions

## i18n Ownership

- All user-visible text must come from translation keys in `messages/{locale}.json`.
- Namespaces: `Common`, `Auth`, `DiscoveryIntake`, `DiscoveryProgress`, `DiscoveryInterview`, `DiscoveryReview`, `Errors`.
- Use `useTranslations('Namespace')` in client components and `getTranslations('Namespace')` in server components.
- Never hard-code strings in JSX, labels, placeholders, aria-labels, or error messages.
- Dates, numbers, currencies, and percentages must use locale-aware formatting (use `next-intl` formatters).
- To add a new feature's translations, add a new namespace object to both `messages/en.json` and `messages/ar.json` — no i18n framework changes needed.
- Run `npm run check:dictionary` before committing to ensure key parity.

## RTL & Direction

- Use Tailwind logical CSS properties where possible: `ps`/`pe` over `pl`/`pr`, `ms`/`me` over `ml`/`mr`, `inset-inline-start` over `left`.
- Icons that imply direction (arrows, chevrons) must flip horizontally in RTL using `scaleX(-1)` or the `dir` attribute.
- Test all layout changes in both `ltr` and `rtl` modes.
- Do not use `left`/`right` positioning where `inset-inline-start`/`inset-inline-end` works.

## Fonts

- IBM Plex Sans (`--font-body`) for Latin text and IBM Plex Sans Arabic (`--font-body-arabic`) for Arabic text.
- Applied via CSS variable `--font-sans` in `globals.css` as `var(--font-body), var(--font-body-arabic), sans-serif`.
- Both loaded at weights 400, 500, 600, 700 via `next/font/google` with `display: swap`.
- Do not add additional font files without team review.

## Component Conventions

- Components go in `src/components/`, co-located with their unit test in `src/components/__tests__/`.
- Feature-specific components go in `src/features/{feature}/`.
- UI primitives (buttons, inputs, dialogs) use `src/components/ui/` once shadcn/ui is configured.
- Each component file exports a single named function, not a default export.
- Use the `cn()` helper from `@/lib/utils` for conditional class merging.

## Accessibility

- Every interactive element must have an accessible name (`aria-label`, `aria-labelledby`, or visible label).
- Use semantic HTML (`<nav>`, `<main>`, `<button>`, `<a>`) — avoid `<div>` click handlers.
- Ensure color contrast meets WCAG AA for all text.
- Language switches must announce the new language to screen readers.
- Test keyboard navigation: all interactive elements must be reachable and operable via keyboard.

## Testing

### Unit & Component (Vitest + Testing Library)
- `npm run test` — runs Vitest with jsdom environment.
- Tests are in `src/**/__tests__/*.test.{ts,tsx}`.
- Mock `next-intl`, `@/i18n/navigation`, and `@/i18n/routing` in component tests.

### E2E (Playwright)
- `npm run test:e2e` — runs Playwright against the dev server.
- Tests are in `e2e/*.spec.ts`.
- Smoke-test both locales and language switching in every PR.

### Dictionary Parity
- `npm run check:dictionary` — validates that `en.json` and `ar.json` export matching key sets.
- Must pass before merging any PR that touches message files.

