# RepoPilot — Hero Image Brief

The OKX.AI Agent Marketplace listing needs a hero image. This brief
describes exactly what the image should look like.

**Status:** the banner described here is committed at
`docs/brand/hero.png` (1280 × 640, 513 KB, tracked by git — `.gitignore`
has no rule for binaries, so no `git add -f` is involved). The brief is
kept because it is the spec you edit against if the banner is ever
replaced, and because `pnpm preflight:production` checks the committed
file against it.

This file describes the **2:1 listing banner**. The ASP registration
picture is a separate **1:1** asset — see `docs/AVATAR_BRIEF.md`.

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

Checked against the committed `docs/brand/hero.png` on 2026-10-04:

- [x] 1280 × 640 px, sRGB
- [x] File size ≤ 1 MB (measured 513 KB)
- [x] Left half: "RepoPilot" wordmark, "GitHub Repository Readiness
      Audit" subtitle
- [x] Right half: terminal window with a clearly fictional
      audit snippet
- [x] Black/white with at most one accent color
- [x] No forbidden text
- [x] No third-party logos
- [x] Committed at `docs/brand/hero.png`

Two deviations from the rules above, recorded rather than silently
accepted:

1. The background is not flat — it carries a soft radial glow. The
   style rules say "no gradients". The glow is subtle and the image
   reads as monochrome, but it is a deviation.
2. The terminal block repeats its last line ("Report ready. Download
   JSON") twice.

Neither breaks a marketplace rule; both are visible at listing size.
Replace the banner if either bothers you.

## When the image is ready

1. Drop it at `docs/brand/hero.png`.
2. Update `MARKETPLACE_LISTING.md` to reference the file under the
   heading "Hero image".
3. Open a PR titled `feat(marketing): add hero image for marketplace
   listing`.
4. Once merged, the listing can be submitted (after OKX Beta is
   granted — see `docs/EXTERNAL_ACTIONS.md` items 2 and 6).
