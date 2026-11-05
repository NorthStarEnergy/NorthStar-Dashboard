# Event log alarm listing — 2026-09-18

The top status Event log is widened into an inline alarm listing with quick
filters and unacknowledged markers.

## Changes

- `dashboard-chrome.js`: Event log tile fetches recent ledger rows, paints a
  compact alarm list, and supports All / Alarms / Critical / Warning / Unacked
  filter chips. Unacknowledged rows show a non-interactive `×` marker; the
  marker never acknowledges or clears an alarm.
- `dashboard-polish.css`: Event log column spans most of the status row; list
  and filter styles match the panel-card theme.
- Browser fixtures updated for the inline listing (`status-bar.browser.cjs`,
  `event-return.browser.cjs`).
- Build badge `v0.47`.

Open-full still uses the existing top-right control. Notes remain append-only
and still do not acknowledge alarms.

## Validation

- Browser CDP: Event log ~3× wider than Dispatch; filters and `×` markers work
- `python -m pytest tests -q`
- Layout node suites
