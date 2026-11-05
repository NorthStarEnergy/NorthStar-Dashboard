# Event return and stylesheet recovery — 2026-09-15

## Problem and correction

The supplied screenshot showed unstyled navigation SVGs, exposed editing buttons, and mixed Overview/Events content after visiting an event report and returning. A local browser probe recorded refused asset connections, but it did not inspect the user's authenticated browser session; the exact production transport failure is not established.

- Added a stylesheet readiness/recovery guard embedded in the document head. It retries missing styles sequentially, preserves cascade order, and caps automatic recovery at 16 seconds after document readiness. Persistent failure presents a retry button instead of exposing the broken dashboard.
- The module layout, workspace and navigation initialize only after styles are ready. Layout persistence is paused while styles are unavailable, preserving saved positions. Cached-page restoration rechecks styles.
- Moved Events return handling from the early register bootstrap into the initialized module workspace. Section navigation records its URL fragment with `replaceState`; browser Back and the report's Events register link restore the correct section without adding a history entry for every module click.
- Kept Overview's header/dispatch card out of section views. Navigation icons also carry intrinsic dimensions and stroke attributes.
- Corrected the dashboard document boundary: appended assets now precede the closing body/html tags.

`scripts/dashboard-style-guard.js` is the source of the embedded head script. The event-return browser test verifies that the source and embedded copy match (ignoring Windows line endings). Keep both synchronized when editing the guard.

## Verification and scope

`tests/event-return.browser.cjs` exercises Overview → event → browser Back, Events → event → browser Back, the report return link with 23 stylesheet failures, persistent stylesheet failure, retry recovery, and unchanged saved Overview geometry. Screenshots in the packet are explicitly isolated API fixtures, not production readings. The existing Overview and module-workspace browser scenarios, Node tests, full Python suite and clean-checkout release checks are recorded in the delivered validation file.

Static UI files are served from disk; the fix requires a dashboard reload, not a backend restart. No operational records, authentication rules, backend source, or saved layout resets are changed. Existing unrelated edits to `ieso_backend.py` and `tests/test_demo_auth.py` remain excluded.
