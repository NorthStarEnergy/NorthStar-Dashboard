# V1 fixed header correction

## Request
Apply the corrected fixed top dashboard to v1 while preserving the restored pre-v3 view and keeping later edits separate.

## Changes
Ported only the saved-row fitting logic and worker-count visibility rules into v1's isolated module-layout and dashboard-polish files. Updated only those two asset versions in northstar-v1.html. No other baseline assets or later edits were imported.

## Verification
Staged and installed full-shell browser checks pass at 1600, 1264 and 1024 pixels: non-overlapping header frames, single-line and contained market/reserve values, visible worker count, and no JavaScript errors. Screenshot reviewed. Hash checks confirm all 127 other restored v1 files and the three v3 header source files are unchanged. Separately preserved later edits have no diff.
Python suite: 4 failed, 538 passed, 21 skipped, 8 errors, 347 subtests passed in 145.02s (0:02:25). Existing baseline failures remain; no backend source was changed.

## Runtime
Installed three files in C:/Users/User/NorthStar/northstar-local. Reload northstar-v1.html?buildView=v1; no service restart required.

## Recovery
Private preimages are in private-preimages/20261028-v1-fixed-header-fit. Coordinate and check subsequent changes before restoring. No browser storage or operational data was cleared.

## Delivery
Source commit, packet tag and source-only archive receipt are recorded separately. No GitHub remote is configured; the retired Sites remote is not a deployment target.

## Limits
Browser verification used synthetic operational data. Existing Python baseline failures remain unrelated to this presentation-only correction. Later edits remain in restore-v1-complete/later-edits with their inventory in LATER-EDITS.md.
