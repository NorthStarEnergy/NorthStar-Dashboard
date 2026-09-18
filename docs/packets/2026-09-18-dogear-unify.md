# Unified dogear style — 2026-09-18

Status, Overview open, and market expand controls now use the same clipped
triangle dogear as the weather modules.

## Changes

- Status bar `.ns-status-dogear`: replaced the `↗` glyph with an 11×11
  top-right `clip-path` triangle (`#527181` / hover `#6a8b98`).
- Overview `.ns-open-module` and compact module open buttons: same triangle;
  JS no longer writes `↗` / `Open ↗` text.
- Market `.market-dogear` (workspace CSS and `#marketTopTiles`): switched from
  the gradient fold to the weather clip-path triangle.
- Weather `.details-btn.dogear` unchanged; it remains the reference look.
- Edit controls stay as pencil buttons and are not dogears.
- Build badge `v0.48`.

## Validation

- Browser CDP: status and Overview open dogears report empty text, 11×11 size,
  and `clip-path: polygon(100% 0, 100% 100%, 0 0)` with `#527181` fill
- `python -m pytest tests -q`
- Layout node suites
