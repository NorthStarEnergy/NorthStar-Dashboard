# Overview weather module fit — 2026-09-17

Overview weather cards kept overflowing their saved module frame after the
header-row scale. Face content (title, icon, temperature, condition, precip) is
now densified inside the existing geometry so it stays within the card.

## Changes

- `overview-modules.css`: compact padding, type, and icon sizes for
  `#weatherStrip > .ns-weather-original`; hide the redundant precip-amount line
  on the card face; distribute face content with `space-evenly`; keep the hover
  forecast popup outside the clipped face.
- `module-layout.js`: bump `WEATHER_DENSITY_VERSION` to 2 so existing browsers
  re-apply the weather density migration once.
- Build badge `v0.45`.

Card width/height and the 75% whole-card zoom are unchanged. The full Weather
section is unchanged.

## Validation

- Browser CDP: Overview weather cards report negative content overflow (fit
  with spare room).
- `node tests/canvas-layout.test.cjs`, `node tests/overview-layout.test.cjs`
- `python -m pytest tests -q`
