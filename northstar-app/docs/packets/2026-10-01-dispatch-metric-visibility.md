# Dispatch metric visibility — 2026-10-01

## Change
The compact Dispatch status tile permits metric cells to show readings moved by saved asset positions. The HTML stylesheet URL changes so cached desktop and mobile browsers fetch the updated CSS.

## Scope
Only `dashboard-polish.css` and the CSS cache key in `northstar-clean.html` changed. The active control-room backend serves these files from disk. The Electron desktop app opens the same live URL; NorthStar Manager opens the local server URL. No operational dispatch command or data path changed.

## Verification
- Targeted dispatch telemetry suite: 8 passed.
- Authenticated `ops.northstarenergy.ca` Overview: full Dispatch and Output readings visible at 1376 px and 390 px viewports after reload; new stylesheet URL loaded.
- Active local server stylesheet SHA-256 matched the source file.
- Full Python suite in isolated release checkout: 381 passed, 9 failed. The nine failures match the pre-existing v0.156 baseline reported by the parent commit; none involve Dispatch styling.
