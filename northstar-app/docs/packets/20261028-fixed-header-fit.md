# Fixed dashboard header fit

## Request
The user clarified that the fixed top dashboard is misformatted in Build View v3. Earlier v1 source restoration did not address the defect because it also exists in the saved baseline.

## Changes
The single layout owner now fits the saved header row as a group before clamping its individual frames. Previously a viewport resize clamped right-side cards independently, stacking them over Dispatch and markets. The row also reserves practical widths for crew, events, Dispatch, markets and weather; remaining width goes to crew/events. At smaller viewports the row adapts proportionally. The worker count stays visible when the heading needs to shorten. No font zoom or alternate content renderer was added. The HTML asset version is bumped. The isolated v1 snapshot remains unchanged.

## Verification
Full-shell fixture checks at 1600, 1264 and 1024 pixels cover reloads, non-overlapping header frames, single-line market labels/prices and reserve readings, containment inside their frames, and absence of JavaScript errors. Rendered screenshots reviewed, including the screenshot-equivalent 1264 CSS-pixel width. Installed checks pass. Python suite: 4 failed, 538 passed, 21 skipped, 8 errors, 347 subtests passed in 141.43s (0:02:21). Existing baseline failures remain; no backend source was changed.

## Runtime
Installed module-layout.js, dashboard-polish.css and their updated asset references in northstar-clean.html at C:/Users/User/NorthStar/northstar-local. Refresh v3 to load it. No restart is required.

## Recovery
Three pre-change files are preserved privately in private-preimages/20261028-fixed-header-fit. Restore only after checking for subsequent changes and taking the coordination lock. No user storage or operational data was cleared.

## Delivery
Commit, tag and archive receipt are recorded separately. The configured Sites remote is not the runtime publication destination; no GitHub remote is configured.

## Limits
Operational API data in verification is synthetic. This is the specific fixed-header defect identified by the user; it is not evidence that all of their historical v1 appearance preferences have been recovered. The narrower event module can wrap its filter controls while keeping entries readable.

