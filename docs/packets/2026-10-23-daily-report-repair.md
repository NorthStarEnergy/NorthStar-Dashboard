# Daily report on-demand repair — 2026-10-23

## Request
Restore on-demand daily report numbers for the operator and prevent clipped weather screenshots.

## Implementation
The installed configuration still referenced the previous PC's Ryan1 profile. Restored the matching migrated FLC_Daily_Report (1).xlsm into the private daily-report directory, verified all 13 expected image targets, and configured absolute installed Node and Playwright paths. No credentials or operator permissions changed. Research and daily-report buttons now say Pull daily report now; Research shows available public reading counts alongside image counts. Existing CSV/JSON downloads expose fresh numbers separately from the image-only workbook. Asset versions updated.

Forecast capture sizes five original provider cards to their complete contents, releases carousel clipping, waits for fonts/artwork, and validates containment. Browser HTTP caching is disabled for weather captures to prevent the provider's cookie-setting 302 redirect loop. Transient navigation errors get one retry. Hidden future-day lazy images are excluded from artwork validation. If the provider's decorative precipitation cloud returns 403, its own accessible label POP is displayed instead; forecast condition icons must still load. Flow graph capture expands to scroll height so the Jacques-Cartier axis and legend are included.

## Runtime
Applied static assets and capture script to C:/Users/User/NorthStar/northstar-local. The existing backend reads the report configuration and launches the capture script on each run, so no service restart is required. Refresh existing dashboard windows. The existing single-active-run guard and two-minute interval between refreshes remain.

## Verification
All 13 live provider captures succeeded; all ten weather screenshots and three graphs visually reviewed. Full forecasts and graph legends are visible. Real preparation produced 17 collected/trace values out of 24 tracked fields, downloadable CSV/JSON, an image-only XLSM, and preservation proof. The source template and all non-media workbook ZIP entries remain unchanged. Browser fixture verifies a clipped seven-card carousel becomes five complete cards and the refresh button posts once, then disables and displays active status. Six date/allowlist Node tests and all 12 daily-report Python tests pass. Full Python suite: 508 passed, 21 skipped, 2 failed, 8 errors, 546 subtests passed; the failures/errors reference pre-existing missing database-foundation/schema.sql and server/index.js in this migrated installation. No Python source changed.

## Limits
Seven tracked readings remain unavailable: Monetville precipitation not published, Ste-Catherine/Lachute precipitation and Rainy River water temperature provider errors/cooldowns, Raft Lake authorized-feed dependency, and two Ontario MNR forecasts behind OPS/BPS sign-in. Internal runtime, cogen PDFs and International Falls email remain outside the existing collector. Workbook operating values/date are still the template's; use the separately collected numbers for review. No email or workbook macro execution. Ryan's existing desktop session is not exposed through available browser tooling, so authenticated Ryan UI was not exercised; the runtime pipeline and authenticated test-server route protections were verified. No configured github remote or verified Drive destination; no cloud delivery.

## Recovery
Private preimages and original configuration are under private-preimages/20261023-daily-report-repair. The recovered template is a separate private copy. Compare hashes before restoring any file so later work is preserved.

## Handoff
Refresh Research and click Pull daily report now, or open Daily report preparation. Review public readings and their status, download Input CSV/JSON, and view the ten forecasts plus three flow graphs. Partial means some source readings are unavailable; it does not mean the runner crashed. Runtime source and sanitized verification scripts are committed in the task repository; operational records, captured images, local config and workbook are excluded.
