# Events > Logs filters — 2026-10-13

Primary filters are always displayed. The generic Toolbar disclosure no longer owns Logs category controls. The filter grid starts at the top, with content-sized rows and no reserved subfilter space. SCADA and COMS retain their existing dynamic child-filter behavior; primary filters wrap on phones.

## Scope
- module-workspace.js: exclude Logs filters from generic Toolbar disclosure.
- event-log-modules.css: compact, content-sized grid and wrapping primary filters.
- tests/events-filters-layout.browser.cjs: full dashboard fixture at 1500px and 390px; geometry, visibility, child collapse and refresh persistence.
- tests/event-log-categories.browser.cjs: replace obsolete SSC interaction with current COMS/PHONE; retain paging, child reset, critical and composer checks.
- Build v0.205 and asset cache versions refreshed using the repository release script.

## Verification
- Full dashboard browser fixture passed desktop and phone checks; phone screenshot inspected.
- Category/history browser regression passed.
- Event register/detail Node suites: 2 passed.
- JavaScript syntax and whitespace checks passed (repository CRLF respected).
- Full Python suite: 463 passed in 332.78 seconds.

## Boundaries
Prepared from github/main 3834046544b482e53da145556c70c7eba0dcc39d in isolated worktree northstar-events-filters-20261013. Canonical dirty files and lock owner checkins-sites-log-20261013 remain untouched. No dirty dependencies. Authenticated live rendering and canonical runtime integration are not verified.
