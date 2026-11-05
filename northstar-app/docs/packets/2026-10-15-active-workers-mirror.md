# Active Workers list mirror correction

Request active-workers-mirror-20261015 supersedes station-list-module-20261015, which targeted the wrong module. Base 822b7c3.

The menu's saved Active Workers module is crew:field-roster: a compact table of people grouped by station. Overview Station Display List and the fixed dashboard top-right popout now mount that same field-roster implementation, including its search, filters, Columns, Refresh, Add person, profile and check-in/out actions. The previous station-card projection was removed.

The mirror shares field-roster CSS and follows its effective theme, avoiding the old station card's inherited High Contrast palette and oversized buttons. Shared heading sizing retains the reference's visible 14px heading; person rows remain 30px. Graphical state, saved panel geometry, independent parent/popout preferences and Event Log swap remain.

Verification: actual reference screenshot inspected with saved operator layout; equal-width computed table/font/padding/border/background/title comparisons passed; 720px popout maintains 30px nonwrapping rows with horizontal scrolling. Shared roster's 15 action/column/filter/stale-state checks passed. Extended Station Display fixture verifies reference data/columns, search, Add person, profile in both surfaces, refresh, popup controls, updates and persistence. No live operational writes were made. Authenticated production rendering and native packaging remain unverified. Unrelated dashboard-layout-default.js is preserved.

Release validation: 463 Python tests, 53 Node tests and 2 build-version tests passed.
