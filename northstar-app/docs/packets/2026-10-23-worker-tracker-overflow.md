# Worker tracker overflow repair — 2026-10-23

## Request
Fix compressed and overlapping station rows in the persistent worker tracker shown with 81 workers.

## Implementation
Additional stations fill the shortest geographic column instead of accumulating in the last column. The station canvas reserves 28 pixels per row (24-pixel buttons and a 4-pixel gap) and scrolls vertically when the panel is too short. The heading reserves its actual height. Long station names truncate inside their button while the count stays visible; the full station and status remain in the accessible label and native tooltip. Existing counts, warning colors, station actions and panel layout preferences remain intact. Updated asset versions load the repair.

## Runtime
Applied dashboard-chrome.js, dashboard-polish.css and northstar-clean.html to C:/Users/User/NorthStar/northstar-local after source-hash checks under the integration lock. Refresh dashboard and popout windows; no backend restart is needed.

## Verification
Headless Edge with synthetic records: 81 workers at 27 stations, including seven additional stations and long names. Main and popout checked at 588x172, 400x172, 280x172 and 720x120: minimum button height, text containment, no intersecting buttons, heading separation, no horizontal overflow, final station reachable by scrolling, station clicks and warning colors all pass. Screenshots visually inspected. Existing worker flow checks pass for add failures/success, station-specific entry, matching roster IDs and cross-window arrivals/checkouts. JavaScript syntax check passes. Full Python suite: 508 passed, 21 skipped, 2 failed, 8 errors, 546 subtests passed. Failures/errors are the same pre-existing missing database-foundation/schema.sql and server/index.js reported in the prior daily-report repair.

## Limits
Browser checks use synthetic API fixtures; no operational worker records were written. Installed-file checks pass; authenticated live-session rendering was not exercised. The running server correctly refuses unauthenticated dashboard asset requests and serves its login page. Concurrent shared-research asset versions were preserved when integrating. No configured github remote or verified Drive delivery destination is available. No backend code changed.

## Recovery
Private originals and base hashes are saved in private-preimages/20261023-worker-tracker-overflow and worker-tracker-fix/base.json. Compare current hashes before restoration to preserve later work.

## Handoff
Refresh the dashboard. Overflowing stations can be reached by scrolling within the worker tracker; hovering a truncated station shows its complete name and status.
