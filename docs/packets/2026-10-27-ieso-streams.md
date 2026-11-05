# Request
Connect the dashboard directly to IESO news, system, market and all public streams.

# Changes
Markets now contains an expandable IESO streams panel in v1 and v3. The backend discovers the full public report directory, fetches latest report files on selection, renders XML fields and source data, and retrieves the latest 100 articles from IESO's own news JSON API. Eight RSS feeds cover emergency, day 0, days 1â€“34, archive, administrative pricing, dispatch scheduling errors, settlements and DAM. Emergency purchases/sales links to its official web publication, which exposes no RSS feed. Existing price and demand adapters remain in use.

# Verification
Live upstream checks: 139 report folders, 100 news articles, eight successful RSS responses and real-time system report XML. Eight targeted tests pass, including stale-data retention, unknown report refusal, latest alias selection and operator/hostname access. Isolated Edge panel and full-shell checks pass for v1/v3 and existing workflows. Full isolated suite initially reported 511 passes, 24 failures (including subtest failures), 21 skips and 8 errors: missing copied fixture assets plus an outdated four-feed test fixture accounted for the additional failures. After restoring the fixture assets and extending the RSS fixture, all 88 affected tests and 260 subtests passed. The four previously documented failures and eight errors remain outside this scope (database-foundation schema, retired server source, and research access expectations). See suite.log and corrected-regressions.log. No live operational records were mutated in tests.

# Runtime
Six source files installed into C:/Users/User/NorthStar/northstar-local under an exclusive integration lock after comparing base hashes. Activation is blocked: the scheduled-task restart left the old elevated backend running, and Windows denied stopping it (Access denied). The existing backend remains healthy. An administrator must restart the backend, then refresh the dashboard. Panel refreshes every five minutes while open; server caches upstream reads for five minutes. Report streams load on selection, rather than continuously downloading every report.

# Recovery
Private preimages are retained under private-preimages/20261027-ieso-all-public-streams. Restore only the four pre-existing application files and the advisory test from this packet under a fresh integration lock and remove the two new files, then restart. Preserve any subsequent edits.

# Delivery
Allowlisted source, tests and verification are retained in ieso-streams-work. Commit/tag and ZIP identify the final packet. No GitHub remote is configured; the existing Sites remote is unrelated.

# Limits
Public streams include legacy folders; source publication timestamps remain visible and catalogue retrieval does not imply a fresh measurement. Large reports over 12 MB require opening IESO's original file. Latest 100 news items and the RSS publishers' available items are shown. Participant-only feeds require authorized IESO credentials and are not connected. This does not establish dispatch-control connectivity.

Live-source references: https://reports-public.ieso.ca/public/ and https://www.ieso.ca/Sector-Participants/IESO-News .

Administrator activation: run RESTART-AS-ADMIN.ps1 from an Administrator PowerShell, then verify the signed-in /api/ieso-streams response and refresh Markets. No authenticated production read of the new endpoint was possible before activation.

IESO streams packet c18201f / packet-20261027-ieso-streams: installed, 8 targeted and 88 regression tests pass. Activation requires administrator restart: old elevated backend could not be stopped (Access denied). Five application hashes match; concurrent worker-v1 cache-reference updates to northstar-clean.html preserved and IESO script reference confirmed. Archive verified at https://drive.google.com/file/d/1DTXvHAS3Yeval5VKMGPHwrBqBm-VD2YY/view .
