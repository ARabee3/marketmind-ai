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
- next-intl is type-augmented in `src/i18n/types.ts` (augments `use-intl`'s `AppConfig` with `Messages: typeof en`). Translation keys are checked at compile time; invalid keys fail `npm run typecheck`.
- Unprefixed URLs (e.g. `/auth`) are negotiated by `src/proxy.ts` via the `NEXT_LOCALE` cookie then `Accept-Language`, then redirected to `/<locale>/...` preserving the rest of the path (`ar` default). Do not add custom locale redirects.
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
- Each component file exports a single named function, not a default export.
- Use the `cn()` helper from `@/lib/utils` for conditional class merging.

### shadcn-first selection policy

shadcn/ui is already configured in `components.json`; `src/components/ui/` is
the owned local primitive boundary. Use this order for every component choice:

1. Use semantic HTML when it already provides the required behavior.
2. Reuse an existing local primitive from `src/components/ui/`.
3. For a standard interaction that is still missing, add the smallest relevant
   official shadcn primitive through the existing configuration, one component
   at a time.
4. Create a shared MarketMind component only when product semantics and real
   reuse justify it, such as a decision trail, evidence treatment,
   readiness/blocker state, journey progress, or owner-action bar.
5. Keep a composition inside `src/features/{feature}/` until cross-feature
   reuse is demonstrated.

Treat generated shadcn source as code the project owns: adapt it to the
MarketMind semantic tokens, bilingual content, RTL behavior, focus behavior,
and tests. Do not bulk-import registry blocks, add a second UI system, copy an
unreviewed registry, or preserve default shadcn styling when it conflicts with
the product brief. `Card` is not a default page-section wrapper; prefer
semantic grouping, headings, whitespace, and dividers unless a bounded surface
has a real information or interaction purpose.

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

## DESIGN SYSTEM

- **Responsive app shell:** implemented in `src/components/layout/app-shell.tsx`.
  Desktop: fixed 240px sidebar on the start edge containing brand, primary
  navigation, and the language switcher. Mobile: sticky top bar (brand +
  switcher) and a fixed bottom nav. Page content is centered in a
  `max-w-[1200px]` container inside a wrapper offset from the sidebar using
  `md:ms-[240px]` (logical, RTL-safe).
- **Colour tokens** are defined in `src/app/globals.css` under `@theme inline`.
  Brand palette:

  | Token | Hex | Usage |
  | --- | --- | --- |
  | `--color-bg` / `--color-background` | `#F7F8FA` | Page background |
  | `--color-surface` / `--color-card` | `#FFFFFF` | Cards, modals, sheets |
  | `--color-navy` / `--color-foreground` | `#102A43` | Headings, primary text |
  | `--color-primary` | `#0B6F71` | Buttons, links, active states |
  | `--color-action` | `#246BFD` | Call-to-action, interactive elements |
  | `--color-warning` | `#A15C00` | Warning banners, caution icons |
  | `--color-danger` / `--color-destructive` | `#B42318` | Error states, destructive buttons |
  | `--color-border` / `--color-input` | `#D9E2EC` | Dividers, input borders, card strokes |

  Plus the shadcn semantic surface (`--color-muted`, `--color-accent`,
  `--color-secondary`, `--color-ring`, `--color-primary-foreground`, etc.)
  and the radius scale (`--radius-sm/md/lg/xl`). The shadcn primitives in
  `src/components/ui/` reference these tokens; do not delete them or the
  primitives will render unstyled.

## DESIGN & VOICE BRIEF

> MarketMind is a trustworthy, practical, Arabic-first growth workspace for
> Egyptian SMEs across different industries. AI should feel helpful,
> explainable, and grounded in business evidence — not futuristic or
> mysterious.

Suitable for retail, services, hospitality, education, healthcare, and other
SMEs. **Anti-patterns** (do not use):

- generic AI conventions: purple gradients, glassmorphism, excessive floating
  cards, sparkle / robot imagery, sci-fi styling;
- industry-specific decoration / iconography;
- hiding failed integrations or presenting simulation data as real.

Distinctiveness comes from guided business journeys, bilingual typography,
visible readiness / progress, evidence, and clear owner control.

## APPROVED AI CODING SKILLS

AI-generated frontend work under `apps/web` must follow the approved skill
set below. Sources are pinned to a reviewed commit; the full install
configuration and MCP policy live in
`../../.agents/skills/marketmind-frontend-workflow/references/approved-tools.md`.

| Skill | Official source | Pinned commit | Status | When |
| --- | --- | --- | --- | --- |
| Next.js best practices (bundled docs + workflow skills) | `vercel/next.js` canary `skills/` (migrated from `vercel-labs/next-skills`) | `vercel/next.js@00598045` (canary) | Required | Pages, layouts, RSC, fonts, data patterns, routing (Next.js 16 `proxy.ts`, app router) |
| `vercel-react-best-practices` | `vercel-labs/agent-skills/skills/react-best-practices` | repo commit `f8a72b9` | Required | Components, hooks, state, composition, performance |
| `web-design-guidelines` | `vercel-labs/agent-skills/skills/web-design-guidelines` | repo commit `f8a72b9` | Required (final review) | Final accessibility / UX review pass |
| `frontend-design` | `anthropics/skills/skills/frontend-design` | repo commit `9d2f1ae` | **Required** when designing or styling UI | Visual direction, layout, tone |

Every AI-generated frontend PR must pass `npm run check` and be reviewed by a
human for consistency with these skills and the MarketMind visual brief. Use
the project-local routing skill
`.agents/skills/marketmind-frontend-workflow/` to select the smallest relevant
skill / MCP for a given task; do not apply every tool to every task.

Run `npm run agent:setup -- --agent <agent>` once per checkout/approved pin
change. Before a task, run `npm run agent:doctor` and have the agent report the
available approved MCP names. Missing dependencies must stop the workflow and
show the approved setup command; they must never trigger discovery or silent
installation of a substitute.
