# V1 wide Overview and detached monitor

The existing V1 Overview uses a separate saved canvas profile when at least 1,350 CSS pixels are available inside the main workspace. Its roster occupies the left side. A scrolling event log sits above the existing five geographic station columns and market chart. The log reads the same unfiltered register snapshot as the status strip and opens existing event records. The application menu's **Wide overview on large screens** checkbox switches back to the previous profile.

In the roster, selecting a column heading sorts all visible visits across the selected stations. The second click reverses the order. Company groups NorthStar and NorthStar Energy first in ascending order. Time columns use the recorded timestamps and keep missing values at the end. **Columns → Group by station** restores the grouped view. The table supports draggable column boundaries and a numeric row height. The detached monitor also has an adjustable roster/event divider and event column widths.

V1 Edit Layout uses the existing grid preference for asset and module movement. Alt plus an arrow moves one pixel. Shift multiplies the keyboard step by ten. Copy and paste transfer custom assets between editable modules within the window. For a built-in asset they transfer visual properties while retaining the destination's data and action. Narrow and wide layouts retain independent geometry.

The detached monitor groups the application menu, worker heading and crew check-in in one row. Full screen is available on that row. On Windows, **NorthStar Monitor.cmd** opens the authenticated status URL in Chrome or Edge app mode.

Verification uses **tests/v1-wide-monitor.browser.cjs** with intercepted requests and synthetic records. It exercises the full shell, wide and narrow views, sort direction, column resizing, row height and reload, actual coarse and fine asset movement, copy/paste, undo, monitor divider and event column adjustments, and fullscreen. The changes are static assets. Refresh the dashboard to activate them.
