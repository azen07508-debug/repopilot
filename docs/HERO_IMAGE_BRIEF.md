# RepoPilot — Hero Image Brief

The OKX.AI Agent Marketplace listing needs a hero image. This brief
describes exactly what the image should look like. No image is bundled
with the repo; the asset must be supplied by the brand owner and
dropped under `docs/brand/hero.png` (gitignored — commit with
`git add -f`).

## Required dimensions

- **1280 × 640 px** (4:2 aspect ratio)
- Format: PNG or JPG
- Color mode: sRGB
- Max file size: 1 MB (marketplace limit)

## Composition

A horizontal layout. The image is split into a left half (text) and
a right half (visual).

### Left half (text)

- Top line: **"RepoPilot"** in a developer-tool monospace or geometric
  sans (e.g. JetBrains Mono Bold, Inter Bold, IBM Plex Mono Bold).
  Color: pure white on a dark background, or pure black on a light
  background. The wordmark must be at least 96 px tall.
- Bottom line: **"GitHub Repository Readiness Audit"** in the same
  family at a smaller weight (Regular). The subtitle should be at
  least 32 px tall.
- A short tagline can be added if it fits: **"One repo in. A
  launch-ready plan out."** in italic, smaller (24 px).

### Right half (visual)

A stylized terminal window. The window should contain a small,
**mocked** audit snippet — not a real report. Suggested contents:

```text
$ repopilot audit github.com/okx/okx-api

  Scores
  ───────────────────────────────────
  Documentation        90/100
  Reproducibility      82/100
  Security hygiene     85/100
  Deployment readiness 78/100
  Overall              84/100

  3 blockers   12 doc gaps
  0 secrets    4 web3 issues

  Report ready. Download JSON ↓
```

The terminal must be clearly fictional. Do not show a real repo URL
that is not owned by the brand. The terminal colors should be high
contrast (black background, white text, monochrome or two-tone
accents) — the same developer-tool aesthetic as the rest of the
product.

## Style rules

- **Black and white only.** A single accent color is acceptable (the
  OKX green or a neutral cyan) but the rest of the image should
  read as monochrome.
- **No gradients.** Flat colors or very subtle 5–10% tint shifts.
- **No photographs.** No stock images. No human faces.
- **No emoji.** The lobster mascot (if used) must be a single
  flat-color icon, not a 3D render.
- **No charts or graphs with numbers that imply returns.** This is a
  developer tool, not a finance product.

## What is forbidden

- The OKX official logo (unless the platform rules explicitly
  allow it for third-party agents)
- The word "guarantee", "win", "profit", "return"
- Numbers that look like prices, yields or APYs
- Screenshots of real reports
- Imagery of a person holding a phone with a green arrow
- Imagery of a chart that goes up-and-to-the-right

## Acceptance checklist

- [ ] 1280 × 640 px, sRGB
- [ ] File size ≤ 1 MB
- [ ] Left half: "RepoPilot" wordmark, "GitHub Repository Readiness
      Audit" subtitle
- [ ] Right half: terminal window with a clearly fictional
      audit snippet
- [ ] Black/white with at most one accent color
- [ ] No forbidden text
- [ ] No third-party logos
- [ ] Saved as `docs/brand/hero.png` and committed with
      `git add -f`

## When the image is ready

1. Drop it at `docs/brand/hero.png`.
2. Update `MARKETPLACE_LISTING.md` to reference the file under the
   heading "Hero image".
3. Open a PR titled `feat(marketing): add hero image for marketplace
   listing`.
4. Once merged, the listing can be submitted (after OKX Beta is
   granted — see `docs/EXTERNAL_ACTIONS.md` items 2 and 6).
