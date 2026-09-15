# Module workspace — 2026-09-15

## Delivered behavior

- Sections open a default landing module. A second navigation rail lists their modules and expandable sub-module groups.
- Opening modules creates closeable tabs within that section. One full page appears by default. Arrange module windows, or resize any corner, restores the open pages as independent movable windows. Maximize active module returns to one page.
- All four corners support pointer and keyboard resizing. Arrow keys move/resize in 5 px increments; Shift uses 20 px. Cancelled pointer gestures restore their original geometry.
- Weather locations are separate modules. IESO and market nodes have separate detail pages. Outages contains UWPC with one-line drawings, library, templates, intake, form, review and audit tooling beneath it. Engineering remains a navigation alias to those tools.
- Full-page and Overview presentations share a stable module identity and name while retaining separate titles, labels, notes, spacing, accent and ordered text/data blocks.
- The Module editor edits existing label text without replacing form controls. Data tags select existing source elements; added data displays update from those sources. Custom-only presentation allows replacement of the source visual content with configured blocks.
- Bottom-right Edit enables click-to-edit on existing module surfaces and their Edit module buttons. The Modules catalog opens either presentation and creates persistent custom modules and nested modules.
- Overview visibility, open tabs, landing choices, module content and geometry persist on this browser. Layout Save creates a reset snapshot. These preferences are not account-synchronized.

## Implementation

`module-layout.js` remains the geometry owner. `module-workspace.js/.css` replace the obsolete inline editor and section lists. Feed-owned DOM is kept in place; selected source paths expose their ancestors while hiding unrelated siblings with inline priority, including old weather CSS overrides. Market detail rendering accepts a target and scopes controls so multiple market pages do not duplicate document IDs.

Removed obsolete startup scripts that erased saved layouts on every load, and the delayed Markets click handler that overrode the chosen landing module.

## Verification

- Five Node regression suites pass, including all Overview corner directions, opposite-edge anchoring, cancellation and persistence.
- Playwright browser scenarios pass with isolated local assets and API fixtures: one visible weather module, multiple tabs, floating pages, corner resize, full/compact edits, reload persistence, UWPC intake, IESO/node detail separation, custom module creation, and Overview geometry after Save/reload. No browser runtime errors.
- The browser screenshot is fixture evidence, not live operational data. API writes in this test never reach the operational server.
- Python regression and committed-source release checks are recorded in the release validation file packaged with this report.

## Delivery scope

The ZIP contains changed source, regression tests, this report and verification evidence. It is a change packet for the canonical Python/static dashboard, not a replacement runtime or the retired Sites product. Existing uncommitted backend/session-test edits were left untouched and are excluded from this packet.
