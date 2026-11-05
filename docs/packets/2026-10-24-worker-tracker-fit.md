# Worker tracker fit restoration — 2026-10-24

## Request
Restore the compact worker tracker so all occupied stations fit inside its panel without a scrollbar.

## Changes
Removed the 28-pixel minimum per station row introduced by the previous repair. The station grid uses the panel's remaining height, and label sizes respond to both grid width and row height. Retained balanced geographic columns, contained long station names, complete accessible labels/tooltips, warning states, and station actions. Updated only the two affected asset versions in the dashboard HTML.

## Verification
Headless Edge fixture checks pass at 588x172, 400x172, 280x172 and 720x120 in both the main dashboard and fixed popout. All 27 stations (81 synthetic workers) fit without vertical or horizontal scrolling, overlapping buttons, or text escaping buttons. Station clicks and warning states pass. Screenshots visually inspected. Worker-flow checks pass for generic and station-specific add, save failure/success, matching roster IDs and cross-window arrival/checkout. No live worker records were written. Full Python suite: 512 passed, 21 skipped, 2 failed, 8 errors, 576 subtests passed. The failures/errors are the previously reported missing database-foundation/schema.sql and server/index.js files.

## Runtime
Installed and verified against the installed files, prepared from the current files in C:/Users/User/NorthStar/northstar-local. Integration uses the canonical lock and source hash comparisons. Refresh dashboard and fixed popout windows after installation; no backend restart is required. Browser verification uses local installed assets with fixture APIs, not an authenticated production session.

## Recovery
Private originals are saved at private-preimages/20261024-worker-tracker-fit. base.json records the pre-install hashes. Compare current files before restoring to preserve subsequent work.

## Delivery
Source, verification scripts and this report are recorded in the task repository. The runtime has no Git repository. There is no configured github remote or verified live Drive destination; the retired Sites remote is not a deployment target.

## Handoff
Reload the dashboard and any fixed popout windows to load the restored fit. Chat message queuing is a separate app setting; official documentation points to Settings > General > Follow-up behavior > Queue.
