# Status bar card theme — 2026-09-18

The persistent operations strip at the top of the operator console now uses the
same panel chrome as Overview modules instead of a flat divider bar with cyan
monospace labels.

## Changes

- `dashboard-polish.css`: each status tile is a bordered panel card with
  rounded corners, module-style title type, metric columns, muted meta, and a
  top-right open control matching other Overview modules.
- `dashboard-chrome.js`: sentence-case titles; Dispatch / Markets / Crew use
  labelled metric layouts like Field staff; Event log keeps preview/open
  behaviour.
- Build badge `v0.46`.

Dogear click targets, event hover preview, and hostname/operator-gate behaviour
are unchanged.

## Validation

- Browser CDP screenshots of the Overview status row
- `python -m pytest tests -q`
- `node tests/canvas-layout.test.cjs`, `node tests/overview-layout.test.cjs`
