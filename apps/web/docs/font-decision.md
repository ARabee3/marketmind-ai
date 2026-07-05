# Font Decision Record

**Date:** Sprint 2, Day 1
**Decision:** IBM Plex Sans + IBM Plex Sans Arabic

**IBM Plex Sans paired with IBM Plex Sans Arabic is the strongest choice for this project.**

#### Why it stands out

* **Designed as a unified type system.** IBM Plex Sans and IBM Plex Sans Arabic were developed to work together, sharing similar optical weight, spacing, vertical rhythm, and overall visual character. In a bilingual interface where users frequently switch between English and Arabic, this consistency creates a polished and cohesive experience.

* **Professional, modern, and technology-oriented.** The typeface communicates a clean, professional aesthetic that aligns well with an AI-powered SaaS platform. It feels trustworthy and contemporary without appearing overly corporate or cold. In comparison, Cairo has a friendlier, more consumer-focused appearance that is better suited to content-heavy or consumer applications than a B2B dashboard.

* **High-quality Arabic typography.** IBM Plex Sans Arabic was designed with careful attention to Arabic typographic conventions rather than being a simple adaptation of the Latin font. This results in natural, highly readable Arabic text that maintains the same design language as its Latin counterpart.

### Comparison with the alternatives

#### Cairo

Cairo is an excellent Arabic typeface, but it is primarily designed with Arabic in mind. While it includes Latin characters, the bilingual experience is less balanced than IBM Plex. Since our application relies heavily on both English and Arabic throughout the interface—not just in user-generated content—a more unified bilingual font family is preferable.

#### Noto Sans + Noto Sans Arabic

Noto Sans and Noto Sans Arabic are technically robust and offer excellent multilingual support. However, they are intentionally designed to be neutral and universally applicable. While this makes them a reliable default choice, they lack the distinctive personality and premium feel that we want for a modern AI platform. The result is a functional but less memorable visual identity.


## Implementation

- Latin: `next/font/google` `IBM_Plex_Sans` with `subsets: ['latin']`, weights `[400, 500, 600, 700]`.
- Arabic: `next/font/google` `IBM_Plex_Sans_Arabic` with `subsets: ['arabic']`, weights `[400, 500, 600, 700]`.
- Font stack in `globals.css`: `var(--font-body), var(--font-body-arabic), sans-serif`.
