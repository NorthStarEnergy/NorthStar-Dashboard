# Dashboard visual polish — 2026-09-15

## Visual review and changes

Reviewed the running local dashboard at `http://127.0.0.1:4180/northstar-clean.html` using rendered browser screenshots, then checked populated and unavailable states with isolated fixtures.

- Replaced the stretched, tiny navigation labels with consistent 13 px text and distinct icons. The rail becomes an accessible icon menu at smaller widths. Existing navigation, drag ordering and source health elements remain connected.
- Reduced default summary cards from 210 to 174 px, Events from 300 to 238 px, weather from 190 to 128 px, and lower summaries to 160 px. At 1440 px, all eight weather modules fit in one row. Their names, temperatures, conditions and source status remain visible.
- Unified card typography, separated MW units from values, added weather symbols and quiet event severity badges, and shortened the default Events preview to three visible records. Expanding the card reveals more detail; the full Events module retains the complete register.
- Added a clear source-attention badge covering staff, dispatch, markets, weather, Events, SCADA and chat. Unavailable Events and Chat show one useful empty state; unavailable SCADA no longer claims that no feeds are configured.
- Consolidated Add module and Edit layout into a dock along the bottom. Its measured height supplies scroll padding, so bottom modules can always scroll clear of the controls.
- Replaced oversized corner triangles with small edge grips. Weather names remain visible in edit mode; click a weather card or focus it and press Enter to edit its contents. Four-corner pointer/keyboard resizing and existing saved arrangements remain supported.
- Opening a section module returns the document to the top, so tabs and the section header are visible after leaving a scrolled Overview.

## Verification

The Overview browser scenarios cover 1920, 1440, 1100, 760 and 390 px widths, default content containment, navigation icons, the shared editing bar, keyboard module editing, bottom scroll clearance, source states, linked pages, saved labels, resize, snap, Cancel and previous-layout recovery. The existing full-module browser scenarios and five Node tests also pass. The full Python suite passed all 260 tests in the shared checkout. Committed-source release results are included in `release-validation.json` in the delivered package.

One existing Python assertion pinned the Events script to an obsolete cache version. It now checks the versioned script include instead; hostname and operator-route checks remain unchanged.

## Scope and evidence

`live-after.png`, `live-edit.png` and `live-760.png` show the running local server with its actual responses. Weather and market data were present; several operator sources reported unavailable in the inspection browser. The polish does not fix or conceal those source connection states. Files named `overview-<width>.png` use explicit API fixtures and are labeled accordingly in the validation record.

Manual layouts are preserved. **Edit layout → Arrange default** applies the tighter arrangement to a previously customized canvas. Static UI files are served from disk; no backend restart or operational data mutation is part of this packet. Existing unrelated changes to `ieso_backend.py` and `tests/test_demo_auth.py` are excluded.
