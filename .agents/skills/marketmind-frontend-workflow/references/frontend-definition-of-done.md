# Frontend Definition of Done

A frontend change under `apps/web` is done only when all applicable checks below pass.

## Toolchain and correctness

- `npm run agent:doctor -- --available-mcp context7` verifies the reviewed skills and default MCP before agent-assisted frontend work.
- `npm run check -w @marketmind/web` passes typecheck, lint, unit tests, and dictionary parity.
- `npm run build -w @marketmind/web` produces a successful production build.
- No new TypeScript `any` is introduced without justification.
- Every semantic token used by `src/components/ui` is defined in `src/app/globals.css` and verified visually.

## Component reuse and ownership

- The change follows the shadcn-first order in `apps/web/AGENTS.md`: semantic
  HTML, existing local primitive, smallest missing official shadcn primitive,
  justified shared product pattern, then feature-local composition.
- New standard controls are not rebuilt when an existing local or official
  shadcn primitive provides the required accessible behavior.
- Official shadcn primitives are added individually through the existing
  `components.json`, then reviewed as owned project code.
- No bulk registry dump, second UI system, or unreviewed component dependency
  is introduced.
- New shared components have demonstrated reuse or clear MarketMind semantics;
  speculative abstractions remain feature-local.
- Primitive changes preserve semantic tokens, keyboard and focus behavior,
  English/Arabic content, and structural RTL behavior, with affected tests.
- `Card` is used only for a meaningful bounded surface, not as the automatic
  wrapper for every section or dashboard cell.

## Internationalization

- User-visible strings, labels, placeholders, accessibility labels, errors, loading states, and empty states come from `messages/en.json` and `messages/ar.json`.
- English and Arabic dictionaries have identical key sets.
- Invalid translation keys fail TypeScript validation.
- Dates, numbers, currencies, and percentages use locale-aware formatters.
- Owner messages, AI responses, evidence, and business names are not silently translated.

## Routing and locales

- Next.js 16 uses `src/proxy.ts` rather than `middleware.ts`.
- Unprefixed URLs resolve through the locale cookie, then `Accept-Language`, then Arabic fallback while preserving the remaining path.
- Language switching works in both directions and preserves the current route and Discovery session.

## Responsive shell and RTL

- Page content renders inside `AppShell`: desktop sidebar, mobile top bar, and mobile bottom navigation.
- On desktop, a wrapper uses logical `md:ms-[240px]`; the nested main content remains centered with `max-w-[1200px]` inside the available area.
- Verify at desktop width of at least 1280px and mobile width of at most 375px.
- No horizontal overflow occurs in English or Arabic.
- Layout uses logical start/end properties instead of left/right assumptions.
- Directional icons flip in RTL without changing message meaning.

## Accessibility

- Every interactive element has an accessible name.
- Use semantic HTML; do not use clickable `div` elements.
- Controls are keyboard reachable and show visible focus.
- Color contrast meets WCAG AA in the currently supported light theme.
- Dark mode is deferred until every semantic and brand token has an intentional dark value; do not add partial automatic dark-mode overrides.
- Respect `prefers-reduced-motion` for animation.

## Visual direction

- Use `frontend-design` whenever a task designs or styles UI.
- Avoid generic AI decoration such as purple gradients, glassmorphism, sparkle or robot imagery, and sci-fi styling.
- Avoid hospitality-specific decoration: MarketMind serves SMEs across industries.
- Follow the approved palette, type, density, and component guidance in `product-visual-brief.md`.
- Standard shadcn interactions are customized into the MarketMind system; the
  default shadcn composition is not treated as the product's visual direction.

## Product trust

- AI suggestions remain explainable and cite business evidence when available.
- Failed integrations are visible, and simulated data is clearly labeled.
- Owner review, approval gates, and recovery paths remain visible.

## Verification evidence

- Add committed Vitest or Playwright coverage for repeatable behavior.
- MCP sessions are exploratory and never replace committed tests.
- Verify both LTR and RTL for layout-affecting work.
- Perform a final `web-design-guidelines` review before marking a frontend PR done.
