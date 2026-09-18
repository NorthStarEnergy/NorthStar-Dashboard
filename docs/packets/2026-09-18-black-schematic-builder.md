# Black schematic builder — 2026-09-18

The Engineering one-line board is now a black drafting surface with a tighter command toolbar.

## Available behavior

- Canvas, wrap, and editor chrome use `#000` instead of the beige SCADA paper overlay.
- File, example, export, and clear actions sit in a command bar so the left rail is the symbol library only.
- Device geometry still follows the thin FirstLight line convention (`one-line-technical.css`). Print/PDF stays white paper.
- The board remains drafting only. It does not issue a Work Permit or show live equipment state.

## Inputs

No new feeds.

## Validation

`300 passed` for this packet; two pre-existing dashboard-build version asserts on `main` remain unrelated. Coverage includes the black canvas rule, toolbar markup, and existing catalogue/editor IDs.

## Activation required

Static assets are `one-line-editor.css?v=20260918-2`, `one-line-scada.css?v=20260918-1`, and `one-line-technical.css?v=20260918-1`. HTML is served from disk; no backend restart is required for this packet.
