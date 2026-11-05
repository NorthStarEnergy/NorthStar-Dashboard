# Overview List reuses Active Workers

Request station-list-module-20261015. Base 50a0e9a.

Overview Station Display List now uses the same Active Workers summary/card renderer and toolbar template as Check-ins. Includes Sites, Refresh and Add Worker (opens existing form; popup routes to parent). Graphical view, panel geometry, popout and independent persisted preference are retained. No worker-write flow is duplicated.

Verification: 463 Python tests passed; 53 Node tests passed; extended station-display rendered fixture passed totals/cards parity, Sites/Refresh, Add Worker parent/popup routing, graphical geometry, updates, popup actions and persistence. Screenshot inspected. Fixture isolates operator-authored layout defaults. The older Check-ins fixture hits hidden Sites under current saved asset overrides; source-preimage baseline passed once, so its timing/layout behavior is unresolved. Protected dashboard-layout-default.js remains untouched. Authenticated live rendering and packaged native menu are not verified.
