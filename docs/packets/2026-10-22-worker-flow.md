# Shared worker roster and quick entry

## Request
Match fixed-dashboard workers to Overview list, open Add person without a station preselection, provide site + shortcuts, suggest current and historical crews, verify mobile check-ins.

## Implementation
One authenticated roster snapshot coalesces reads and discards pre-write responses. Both lists use canonical site IDs and exclude checked-out visits from occupancy. Mutations invalidate other open windows through a data-free BroadcastChannel. Unresolved help still reaches the alarm renderer after checkout. Crew colors are shared. Added station selection in the dialog, site + actions including empty stations in the list, and current/past company and person suggestions from authorized visit records. No contact data is inferred from a name. Mobile startup waits for visit restoration; stale heartbeat/refresh/help responses cannot restore a checked-out visit, and denied storage no longer crashes the page. Updated worker service-worker shell version, retaining API network-only behavior.

## Runtime
Applied northstar-clean.html, field-roster.js, field-roster.css, site-crew-detail.js, site-crew-detail.css, mobile-dashboard.js, dashboard-chrome.js, contractor-checkin.html, sw.js, worker-roster-store.js. Updated dashboard asset versions. No backend change or restart needed for this packet. Earlier demo occupancy Python changes still require the administrator restart described by the previous packet.

## Verification
48 backend tests passed: 14 hostname/public worker flow, 2 signed QR/phone verification/acceptance and retention, 32 API/safety workflow tests. Shared-store race test passed. Browser checks passed for equal IDs across views, generic add, populated and empty-site shortcuts, current/history suggestions, save error handling, cross-window add/checkout, preserved unresolved help, and mobile QR/restore/help/checkout/invalid-token flows. Screenshots at 1600 and 768 pixels inspected; no page errors in fixtures.

## Limits
No production check-in records were created and no authenticated real worker session was exercised. Full pytest command attempted; runtime Python lacks pytest. Tests use temporary databases or synthetic browser fixtures. Runtime has no Git metadata or github remote; source is retained in this task repository. No Drive upload.

## Recovery
Private original files in task workspace private-preimages/worker-flow. Compare hashes before restoring because other changes may follow.

## Handoff
Refresh main Overview and reopen/refresh the fixed dashboard. Reload the mobile web app while online for the new shell. Roster polling remains 30 seconds for external arrivals; operator changes update other open windows immediately.
