# Overview redesign — 2026-09-15

## Delivered behavior

- Overview starts with Field staff, APIROQ dispatch and IESO, followed by Events and APIROQ market data. Individual weather modules, generating stations, field tracker and chat follow. Extra pinned modules and staff groups remain independent cards.
- Compact modules have one title, one full-page control, consistent spacing, readable values and an explicit source state. Less detail appears when a card is small; larger cards expose supporting information. Source controls remain in their original rendering anchors.
- Events opens its full register; Write log entry opens the composer module. The report builder remains a separate Events module. APIROQ dispatch opens its own full page, and Chat opens its full Tools module with its existing room and message controls.
- The module editor edits linked full and compact presentations, including titles, labels, notes, data blocks, spacing and accents. Compact labels survive changing data. The dashboard Edit button exposes the move and edit controls plus four corner handles.
- Default arrangements fit wide, desktop, laptop and narrow viewports. Geometry remains freely editable in `module-layout.js`. Arrow keys use 5 px steps; Shift uses 20 px. Optional 16 px snapping, Arrange default, Bring into view, and Cancel are available in edit mode.
- Screen profiles are stored under `northstarOverviewProfilesV2`; the current canvas is mirrored to `northstarCanvasLayoutV1` for compatibility. Previous canvas positions are preserved in `profiles.previous` and accessible through Previous arrangement. Save snapshots the profiles; Cancel restores the state from the start of the edit session. Manual placement may intentionally extend beyond the viewport; Bring into view recovers those cards.
- Missing numbers remain unknown instead of becoming zero. Failed reads retain their last successful data and show stale state. Dispatch faults and missing output/target values are visible despite HTTP success. Market/weather freshness accommodates their five-minute polling cadence. Generating stations shows recorded sites and current feed counts with backend feed status rather than hardcoded equipment health.

## Verification

- Python suite: **260 passed** in the shared working directory before commit. This includes the user's pre-existing additional authentication regression, which is excluded from this UI packet.
- Five Node regression suites passed; all 62 dashboard inline script blocks compile.
- Existing module browser scenarios passed with no page errors: section trees/tabs, floating windows, four-corner resizing, full/compact editing, custom modules, UWPC and market navigation, and reload persistence.
- New Overview browser scenarios passed at **1920, 1440, 1100, 760 and 390 px** with no default horizontal overflow or clipped default card contents. Checks include linked full views, Events composition, unknown/stale values, malformed successful responses, label persistence during feed changes, source cadence, snap, Cancel, screen-profile switching, reload and legacy arrangement recovery.
- Browser evidence uses isolated local static assets and explicit API fixtures, not live operational readings. Tests do not send requests to the operational server.
- Committed-source release checks and hashes are recorded in the packaged `release-validation.json`.

## Delivery

This is a change packet for the canonical Python/static NorthStar runtime. The package contains changed source, tests, this report, validation and fixture screenshots. It excludes operational data and the pre-existing edits to `ieso_backend.py` and `tests/test_demo_auth.py`. Static files are served from disk by the existing runtime; this packet requires no backend code change.
