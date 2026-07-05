# Product Visual Brief — MarketMind AI

> MarketMind is a trustworthy, practical, Arabic-first growth workspace for
> Egyptian SMEs across different industries. AI should feel helpful,
> explainable, and grounded in business evidence — not futuristic or
> mysterious.

## Audience

Egyptian small and medium business (SME) owners across industries: retail,
services, hospitality (cafés/restaurants), education, healthcare, and others.
The owner is non-technical, often Arabic-first, and wants clear control over
what AI proposes and what gets published. They value evidence and
explainability over flash.

## Voice & tone

- Helpful, practical, grounded. Calm and confident, not hyped.
- Explainable: every AI suggestion says *why* and points to business
  evidence when available.
- Owner-respecting: progress, readiness, and approval gates are visible.
  Never hide failed integrations; never present simulation data as real.
- Bilingual by default: Arabic and English are first-class; RTL is not an
  afterthought.

## Distinctiveness comes from

- Guided business journeys (Discovery → Strategy → Content → Publish →
  Monitor → Improve), not a generic dashboard.
- Bilingual typography (IBM Plex Sans + IBM Plex Sans Arabic) as a cohesive
  type system.
- Visible readiness / progress / approval gates.
- Evidence and citations for AI output.
- Clear owner control and undo paths.

## Anti-patterns (do not use)

- Generic AI conventions: purple gradients, glassmorphism, excessive floating
  cards, sparkle / robot imagery, sci-fi styling.
- Industry-specific decoration or iconography (e.g. café-only theming). The
  product serves SMEs across industries; a café may appear as one example,
  never as the framing identity.
- Hiding failed integrations or presenting simulation/demo data as real.
  Demo/simulated data must be clearly labeled.
- Generic SaaS dashboard looks (default navy/teal paired without intent,
  template hero of "big number + small label + gradient accent" unless truly
  justified by content).
- Emoji decoration unless explicitly requested.

## Palette (use only these tokens; do not invent new ones ad hoc)

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

Dark mode overrides are defined in `apps/web/src/app/globals.css`; reuse them
rather than introducing separate dark palettes.

## Layout shell

`apps/web/src/components/layout/app-shell.tsx` provides the shared page frame:
desktop sidebar (240px start edge) + mobile top bar + mobile bottom nav; page
content sits in a centered `max-w-[1200px]` container, offset on desktop by
`md:ms-[240px]` (logical, RTL-safe). Feature owners should render inside this
shell, not invent their own chrome.