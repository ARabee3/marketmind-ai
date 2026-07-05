# @marketmind/web

Next.js 16 frontend for MarketMind AI. Bilingual (English/Arabic, RTL-aware),
powered by `next-intl`, Tailwind CSS v4, and shadcn/ui base primitives.

## Getting started

Run from the repository root (npm workspaces):

```bash
npm install
npm run dev -w @marketmind/web
```

Open [http://localhost:3000](http://localhost:3000). Unprefixed URLs are
negotiated via the `proxy.ts` using the `NEXT_LOCALE` cookie and the
`Accept-Language` header, then redirected to `/<locale>/...` (`ar` default,
the user's preferred locale otherwise).

## Fonts

IBM Plex Sans (Latin) and IBM Plex Sans Arabic (Arabic) loaded via
`next/font/google` and exposed as the `--font-body` / `--font-body-arabic`
CSS variables. See [`docs/font-decision.md`](./docs/font-decision.md).

## Scripts

```bash
npm run check            # typecheck + lint + vitest + dictionary parity
npm run test             # vitest (unit/component)
npm run test:e2e         # Playwright (starts the dev server)
npm run check:dictionary # en.json / ar.json key parity
npm run build            # production build
```

## Conventions

See [`AGENTS.md`](./AGENTS.md) in this directory for the frontend
agent rules: i18n ownership, RTL, fonts, components, accessibility, testing,
the design system, the approved AI coding skill set, and the MarketMind
visual brief.

## Internationalization

Dictionaries live in `messages/{en,ar}.json`. Every user-visible string must
come from a translation key — never hard-code text in JSX. Add new namespaces
and keys to both locale files; `npm run check:dictionary` enforces parity and
`next-intl` is type-augmented (see `src/i18n/types.ts`) so translation keys
are checked at compile time.