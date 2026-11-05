# V3 worker controls and view selector

## Request
Use v1 worker sizing/layout in v3, Add person in place of Active Workers, X checkout without visible refreshing, remaining width for event log/stations, and restore v3 in the view selector. Leave v1 intact.

## Changes
V3 retains the native 722px desktop worker frame, original seven columns and station grouping. Add person occupies the heading position. Checkout uses an accessible X button. Keyed rows preserve unaffected DOM and suppress loading text during overview refresh; confirmed checkout removes only that person, failures retain the row and display an error, and stale responses cannot reinsert confirmed checkouts. Existing remaining-width event/station layout is retained. The browser bridge restores the v3 option even when the toolbar mounts later; the desktop menu now includes v3.

## Verification
Installed Edge fixture checks pass: native frame/columns, Add person dialog, checkout failure/pending/success/stale response, stable unaffected rows with no Refreshing text, remaining-width layout, late selector, v1/v3 navigation and unchanged v1 controls. Zero browser errors. Five original v1 core scripts remain byte-identical. This packet does not write northstar-v1.html; the concurrent inflow cache-version update was preserved in both shells. Required isolated Python baseline: 4 failed, 512 passed, 21 skipped, 8 errors, 347 subtests passed in 270.73s (0:04:30). Existing failures/errors remain the missing schema/server and legacy static expectations; no backend changes in this packet.

## Runtime
Five files installed in C:/Users/User/NorthStar/northstar-local. Refresh the browser dashboard. Native desktop menu changes require relaunch of the desktop app using this source; no desktop app was running and no packaged installer was rebuilt. No backend restart for this packet. Separate inflow and IESO activation status is unchanged.

## Recovery
Private preimages: private-preimages/20261027-v3-worker-controls. Restore only those five files under a fresh integration lock. No operational records changed by verification.

## Delivery
Source commit/tag and Drive archive recorded separately after verification. No GitHub remote is configured; Sites origin is not used.

## Limits
Browser tests use intercepted fixture APIs. Authenticated live operational checkout was not performed. Desktop menu presence is checked in source, not a running packaged app.
