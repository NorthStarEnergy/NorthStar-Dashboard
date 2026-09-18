# IESO HE clock and 24-hour times — 2026-09-18

Operator-facing clocks now use IESO system time (`America/Toronto`, 24-hour)
and the Event log title shows the live hour-ending stamp.

## Changes

- Added `ieso-time.js` with Toronto `hourCycle: 'h23'` formatters plus
  `heStamp()` → `[HE 22 - 21:46]`.
- Status Event log title: `Event log [HE xx - HH:MM]`, refreshed every second.
- Alarm list, event popup, Overview modules, Events register, Markets, Crew,
  Outages, Switching, Chat, and related surfaces route through the helper (or
  explicit Toronto 24-hour options) so AM/PM never appears.
- Build badge `v0.49`.

## Validation

- Browser CDP: Event log title `Event log [HE 22 - 21:50]`; alarm times `21:20`
- `node --test tests/ieso-time.test.cjs`
- `python -m pytest tests -q`
- `node --test tests/*.test.cjs`
