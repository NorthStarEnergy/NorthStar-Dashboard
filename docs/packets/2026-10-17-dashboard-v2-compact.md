# Compact v2 headers and overlay controls

V2 previously stacked a page title, source note, plant heading and workspace toolbar before the data. Idle and active views now share one 36px title/action row. Module headings and actions stay on one 30px row; the schematic uses its existing 32px window title bar as its only toolbar.

More menus contain search, refresh, source notes, worker filters/columns and schematic selection/editing/manual-name controls. Native top-layer popovers open over the data without changing layout and dismiss on Escape or outside click. Escape closes the menu before the drawing window. Shared roster controls are moved with their handlers intact only inside the v2 mount; v1 and its saved layout are unchanged.

Removed the redundant parent title spacing, duplicate market caption and excess chart inset. Corrected the focused plant list padding and centered the schematic window so its controls fit the viewport.

## Verification
- 483 Python passed; 12 PostgreSQL integration checks skipped locally.
- 59 Node checks passed; JS syntax and git diff checks pass.
- Browser fixture: desktop/tablet header remains36px; idle data top174.996px unchanged on opening More; active data top174.996px unchanged; drawing top177.716px unchanged; worker table top378.716px unchanged.
- Drawing selection, manual name save revision2, filter controls, Escape focus behavior and no console errors verified with disposable data. Source notes and controls remain accessible.
- Committed-release preflight, HTTP results and delivery links are recorded in outputs/dashboard-v2-compact-20261017/HANDOFF.md.
- Prior CI39024044680 failed the v1 overview-chart-polish fixture after saved-layout reload while waiting for its canvas. This separate validation concern is retained; this packet does not claim a full hosted pass.

No backend restart, live drawing write, operational import, or authentication change. Authenticated production and packaged-native rendering remain unverified.
