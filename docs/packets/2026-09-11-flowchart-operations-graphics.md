# Flowchart and operations graphics builder — 2026-09-11

- Replaced the three-shape inline flowchart prototype in Tools with a dedicated diagram editor.
- Added eleven flowchart shapes and five electrical operations symbols.
- Added editable fill, border, text, connector colors, line styles, and connector labels.
- Added handle-to-handle connectors, movement, resizing, duplication, layer order, selection deletion, undo/redo, and zoom.
- Added browser-local autosave plus JSON import/export and portable SVG export.
- Kept the tool client-only; it does not issue equipment commands or create operational releases.
- Verification: `node --check flowchart-builder.js`; static assets returned HTTP 200; `209 passed`.
