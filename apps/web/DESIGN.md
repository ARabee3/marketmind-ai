# MarketMind Landing Design System

## 1. Atmosphere & Identity

MarketMind feels like a practical Arabic-first evidence workspace: calm, clear, trustworthy, and a little tactile. The signature is the contrast between business-document clarity and playful scroll motion — cards, chips, and progress paths should feel guided rather than futuristic.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
| --- | --- | --- | --- | --- |
| Page background | `--bg` | `#F7F8FA` | N/A | Main light page background |
| Surface | `--surface` | `#FFFFFF` | N/A | Cards, header, panels |
| Text primary | `--navy` | `#102A43` | N/A | Headings, dark sections, tactile shadow |
| Accent primary | `--primary` | `#0B6F71` | N/A | Main CTA, active states |
| Action | `--action` | `#246BFD` | N/A | Focus rings and secondary action hints |
| Warning | `--warning` | `#A15C00` | N/A | Caution and competitor/review tags |
| Danger | `--danger` | `#B42318` | N/A | Error/destructive state |
| Border | `--border` | `#D9E2EC` | N/A | Card strokes and dividers |
| Soft teal | `--soft-teal` | `#E6F2F2` | N/A | Soft accent surfaces |
| Muted text | `--muted` | `#5B6B7B` | N/A | Metadata and quiet nav text |
| Body text | `--ink-soft` | `#334E68` | N/A | Secondary body copy |
| Journey accent | `--journey-mint` | `#8EE3D5` | N/A | Dark-section progress, stepper line, numbers |

### Rules

- Use teal accents for real interaction or progress, not decoration alone.
- Dark sections use `--navy` with white text and `--journey-mint` progress accents.
- New raw colors should become tokens first.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Usage |
| --- | --- | --- | --- | --- |
| Display | `clamp(2.3rem, 6vw, 4.8rem)` | 700 | 1.03 | Major section headings |
| Card title | `clamp(1.7rem, 3vw, 2.15rem)` | 700 | 1.12 | Card and step titles |
| Body | `1rem` / `15px` | 400-500 | 1.8-1.85 | Paragraphs |
| Caption | `11px-13px` | 600-700 | 1.3-1.5 | Chips, badges, labels |
| Number | `40px-42px` | 700 | 1 | Phase and step numerals |

### Font Stack

- Arabic primary: `IBM Plex Sans Arabic`
- Latin companion: `IBM Plex Sans`
- Fallback: `system-ui, sans-serif`

### Rules

- Arabic copy owns the rhythm; Latin product terms are isolated with the Latin font.
- Headings may use `clamp()` but should stay readable on narrow screens.

## 4. Spacing & Layout

### Base Unit

All spacing follows a 4px rhythm.

| Token | Value | Usage |
| --- | --- | --- |
| `--space-2` | 8px | Tight inline gaps |
| `--space-3` | 12px | Chips and compact labels |
| `--space-4` | 16px | Mobile section gutters |
| `--space-6` | 24px | Card padding |
| `--space-8` | 32px | Card group separation |
| `--space-10` | 40px | Section internal rhythm |
| `--space-12` | 48px | Stepper vertical rhythm |
| `--space-18` | 72px | Mobile section padding |
| `--space-24` | 96px | Desktop section padding |

### Grid

- Max content width: Tailwind `max-w-content`
- Reading width: `620px`
- Breakpoints follow Tailwind defaults, with major mobile adaptation around `820px`.

### Rules

- Keep content centered and narrow enough for Arabic paragraph scanning.
- Scroll sections may be taller than normal content sections when the motion is the point.

## 5. Components

### Tactile CTA

- **Structure**: inline-flex pill with 2px navy border and a 6px tactile shadow.
- **Variants**: solid teal, solid navy, white secondary.
- **States**: hover compresses shadow from 6px to 3px; focus uses action outline.
- **Motion**: transform-only press effect.

### Sticky Roadmap Stack

- **Structure**: ordered list of cards; each card becomes `position: sticky; top: 0` on desktop.
- **Spacing**: large viewport-bottom gaps create the covering stack rhythm.
- **Motion**: the next card covers the previous card through scroll, not opacity tricks.
- **Accessibility**: remains a semantic ordered list.

### Discovery Progress Stepper

- **Structure**: vertical line, numbered circles, alternating content cards on desktop.
- **States**: line fill draws on scroll; number circles highlight as progress reaches each step.
- **Motion**: `transform: scaleY()` for the line and transform/opacity for step emphasis.
- **Accessibility**: cards remain readable without animation and reduced motion shows the full path.

## 6. Motion & Interaction

### Timing

| Type | Duration | Easing | Usage |
| --- | --- | --- | --- |
| Micro | 160ms | ease | Button press |
| Standard | 300-420ms | decel | Small reveals |
| Emphasis | scroll-driven | linear/scrub | Roadmap stack and stepper progress |

### Rules

- Animate `transform` and `opacity`; avoid layout animation.
- Scroll effects must degrade under `prefers-reduced-motion`.
- Motion should clarify progress, not hide content.

## 7. Depth & Surface

### Strategy

Mixed: light sections use borders and modest shadows; dark journey sections use translucent surfaces and mint progress accents.

| Level | Value | Usage |
| --- | --- | --- |
| Tactile | `0 6px 0 var(--navy)` | CTAs |
| Elevated | `0 22px 60px rgb(16 42 67 / 12%)` | Important cards |
| Soft dark | translucent white border/surface | Journey cards on navy |

The system should feel physical and guided, not glassy or sci-fi.
