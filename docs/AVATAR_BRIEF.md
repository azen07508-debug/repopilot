# RepoPilot — ASP Registration Picture Brief

The OKX.AI ASP registration takes a `--picture`. It is **not** the listing
banner and the two are not interchangeable:

| | Banner | Registration picture |
| --- | --- | --- |
| File | `docs/brand/hero.png` | `docs/brand/avatar.png` |
| Shape | 1280 × 640 (2:1) | 1024 × 1024 (1:1) |
| Spec | `docs/HERO_IMAGE_BRIEF.md` | this file |
| Used for | The listing page, the README front door | `onchainos agent create --picture` |

Uploading the 2:1 banner as `--picture` either gets rejected by
`validate-listing` or gets centre-cropped, which cuts the wordmark off the left
edge and the terminal off the right. That is the failure this file exists to
prevent.

## Status

Committed at `docs/brand/avatar.png` — 1024 × 1024, PNG truecolour, tracked by
git. `pnpm preflight:production` measures both brand files and prints the
dimensions and byte count it read, so the size is not written down here where
it would go stale. (It was written down once, as "282 KB", and was wrong within
the hour.)

## Required properties

- **1024 × 1024 px**, 1:1
- PNG (JPEG and WebP are also accepted by the CLI; PNG is what is committed)
- sRGB, 8-bit
- **≤ 1 MB** — the marketplace rejects anything larger

## Composition

Centred and symmetrical, in this vertical order:

1. **A terminal glyph.** Flat line-art rounded-square window outline, a chevron
   prompt and a filled cursor block, single-weight pure white strokes, with one
   small teal checkmark as the only colour accent.
2. **The wordmark `RepoPilot`** in a bold geometric sans, pure white, occupying
   roughly half the width.
3. **The subtitle `Launch Readiness Audit`** in regular weight, light grey,
   smaller than the wordmark.

## Style rules

- **Flat black background.** No gradient, no radial glow, no vignette.
- **Monochrome plus at most one accent colour.** The accent is a muted teal.
- No drop shadows, no 3D, no bevels, no textures.
- No photographs, no people, no faces, no emoji.
- No charts, graphs, or numbers.
- No currency symbols or prices.

## What is forbidden

Same list as the banner (`docs/HERO_IMAGE_BRIEF.md`):

- The OKX official logo (unless the platform rules explicitly allow it for
  third-party agents)
- The words "guarantee", "win", "profit", "return"
- Numbers that look like prices, yields or APYs
- Screenshots of real reports
- Any text other than the two lines named above

## Acceptance checklist

Checked against the committed file on 2026-10-04:

- [x] 1024 × 1024 px, 1:1
- [x] PNG, 8-bit truecolour, sRGB
- [x] under the 1 MB cap (run `pnpm preflight:production` for the number)
- [x] Terminal glyph, wordmark, subtitle in that order
- [x] Flat black background, no gradient
- [x] Monochrome plus one teal accent
- [x] Both text lines spelled correctly
- [x] No forbidden text, no third-party logos, no numbers
- [x] Committed at `docs/brand/avatar.png`
