# MarketMind AI — Submission Package

Issue #243 · Owner: Merzek

Product-facing documentation and demo materials for the ITI submission.

## Contents

| File | What it is |
|---|---|
| `01-project-overview-and-business-case.md` | Problem, target users, solution, MVP, value, business case (bilingual) |
| `02-user-guide.md` | Onboarding + step-by-step journey + FAQ + troubleshooting |
| `03-presentation-deck.md` | Marp slide deck, 10–15 slides (solution, architecture, AI/RAG, testing, limitations, roadmap) |
| `04-demo-runbook.md` | Scripted live demo (Discovery → Strategy → Content → publish/export boundary) |
| `05-demo-video-script.md` | 3–5 min video script + recording guide |
| `assets/` | Screenshots (English + Arabic RTL) |

## Render the presentation to PDF

The deck is Marp markdown. Render with:

```bash
npx @marp-team/marp-cli Docs/submission/03-presentation-deck.md -o Docs/submission/assets/marketmind-presentation.pdf
```

## Honesty rules (apply to every artifact)

- Label simulated or demo-only behavior explicitly.
- Base claims on the current product and available evidence.
- Keep Arabic/English wording consistent; verify RTL screenshots.
- The demo **video** (`05`) is a human recording step — this package provides the script and guide, not the recording itself.

## Status

- [x] Docs 01–05 written
- [ ] Screenshots (English + Arabic RTL) — captured during demo rehearsal into `assets/`
- [ ] Demo video recorded (human step)
