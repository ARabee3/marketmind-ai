# Product Visual Brief — MarketMind AI

> MarketMind is a trustworthy, practical, Arabic-first growth workspace for Egyptian SMEs across industries. AI should feel helpful, explainable, and grounded in business evidence, not futuristic or mysterious.

## Audience

Egyptian SME owners across retail, services, hospitality, education, healthcare, and other industries. Owners may be non-technical and Arabic-first. They want clear control over what AI proposes and what gets published, and value evidence over visual spectacle.

## Voice and tone

- Helpful, practical, grounded, calm, and confident.
- Explain why AI suggests something and show supporting business evidence when available.
- Keep progress, readiness, failures, review, and approval gates visible.
- Treat Arabic and English as equal product experiences; RTL is structural, not decorative.

## Distinctive product signals

- Guided business journeys rather than a generic dashboard.
- A cohesive bilingual type system using IBM Plex Sans and IBM Plex Sans Arabic.
- Visible readiness, progress, evidence, citations, review, and approval.
- Clear owner control and recovery paths.

## Avoid

- Purple gradients, glassmorphism, excessive floating cards, sparkle or robot imagery, and sci-fi styling.
- Industry-specific decoration. A café may be one example, never the product identity.
- Hidden integration failures or unlabeled simulation data.
- Generic SaaS metric-card compositions without a real information need.
- Emoji decoration unless explicitly requested.

## Palette

Use the existing semantic tokens; do not invent ad hoc colors.

| Token | Hex | Usage |
| --- | --- | --- |
| `--color-bg` / `--color-background` | `#F7F8FA` | Page background |
| `--color-surface` / `--color-card` | `#FFFFFF` | Cards, modals, sheets |
| `--color-navy` / `--color-foreground` | `#102A43` | Headings, primary text |
| `--color-primary` | `#0B6F71` | Buttons, links, active states |
| `--color-action` | `#246BFD` | Calls to action and interactive elements |
| `--color-warning` | `#A15C00` | Warnings and caution icons |
| `--color-danger` / `--color-destructive` | `#B42318` | Errors and destructive actions |
| `--color-border` / `--color-input` | `#D9E2EC` | Dividers, borders, and inputs |

The current application theme is intentionally light-only. Dark mode is deferred until every semantic and brand token has a complete, tested dark value. Do not add partial `prefers-color-scheme` overrides.

## Layout shell

`apps/web/src/components/layout/app-shell.tsx` owns shared chrome: a 240px sidebar on the logical start edge for desktop, plus mobile top and bottom navigation. On desktop, a logical-margin wrapper reserves sidebar space; a nested `max-w-[1200px]` main element centers content within the remaining width. Feature owners render inside this shell rather than creating competing navigation or page frames.
