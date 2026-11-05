# Persistent operations status bar — 2026-09-15

Added a fixed, condensed status bar above all dashboard sections. It contains Event Log, Dispatch, Market Pricing (IESO and APIROQ real-time/day-ahead), and Crew Status. Each has a bottom-right dogear opening its linked full module through the existing section/window controller. The former Overview-only indicator cards remain as feed anchors but are hidden and excluded from canvas placement. Weather and manually saved canvas positions are retained.

Pointer hover over Event Log for 500ms opens an in-place, scrollable detail panel. Moving into it keeps it open; Escape, close, outside click or pointer departure dismisses it. Its button also works with keyboard/touch. The panel fetches 50 events on demand, retains prior results on failure, and supports cursor-based older pages. Pagination and filtered section requests no longer replace the bar's latest event. Event text is escaped; links to individual reports remain explicit actions. No operational writes or acknowledgements are performed.

The desktop bar is 68px high, switches to two compact rows on narrow screens, and reserves content space to avoid covering section controls. It waits for the existing asset-readiness gate. It reuses existing feed snapshots and adds no script dependencies.

Validation: 261 Python tests passed; five Node suites, Overview, module-window, event-return and dedicated persistent-bar browser scenarios passed. The dedicated fixture checks five sections, six viewport widths, four dogears, delayed hover, scrolling, pagination, Escape and fixed positioning. Screenshots were visually inspected and use isolated fixtures. Clean-release results accompany the package. Reload the dashboard; no backend restart is required.
