# Public water collection — 2026-10-17

NorthStar v0.219 adds persistent, scheduled and on-demand collection of the public hydrometric sources already used by the application: Water Survey of Canada/ECCC, Québec CEHQ and USGS. The registry contains 29 existing gauges; 26 are active and three WSC gauges are historical-only. No private source or operating record is imported.

## Resulting behavior

Operator-only APIs and `/water-collection.html` provide per-provider intervals, enabled/paused state, recent-window length, gauge selection, Collect now, filtered observation pages, CSV page export, run progress and revision history. Links are added to the existing Flows navigation and data workspace header. Initial settings are every fifteen minutes with a twenty-four-hour recent window. Settings persist and use version checks; on-demand runs also work while schedules are paused.

Public observations are stored separately in PostgreSQL `ns_water`, with original values/units, provider datum, UTC timestamps, quality metadata and correction revisions. Duplicate runs are prevented per provider across processes. Unchanged observations are deduplicated. Requests, pages, time and worker concurrency are bounded. Provider Retry-After/cooldowns persist and cannot be bypassed by Collect now. Existing operator/hostname/origin boundaries remain enforced.

CEHQ's existing snapshot parser is corrected to use fixed EST (UTC−5), as the provider documents; summer timestamps were previously interpreted as daylight time. USGS parameter63160 remains NAVD88 elevation, not a generic local gauge height; original feet are retained and converted using0.3048.

## Verification

Actual PostgreSQL fixtures verify settings conflicts/audit, observations/revisions/deduplication, active-run exclusion, expired leases, due schedules, paused on-demand collection, persisted cooldowns and filter-bound pagination. Authenticated browser integration verifies desktop/mobile, settings persistence, Collect now while paused, observations, revision details, filters and CSV. Provider parser tests verify missing/zero values, USGS units and CEHQ summer timezone, safe pagination and429 handling.

Live twenty-four-hour adapter probes succeeded for one configured station per provider: WSC04LF001, CEHQ050801 and USGS05127500. These probes inspected public responses without writing operating data. Exact counts and times are in the delivery's provider-connectivity.json. Full Python regression: 515 passed, including real PostgreSQL and authenticated browser integration. All65 Node tests and38 isolated release HTTP checks passed. Final deployment/CI evidence is recorded in outputs/HANDOFF.md.

## Operation and limits

The collection scheduler runs in the NorthStar backend and survives restarts through persisted settings; it requires that backend and PostgreSQL to remain running. This packet does not add an OS service or claim reboot recovery. Pausing prevents future scheduled runs while an active run can finish. Completed stations remain committed if later stations fail. A ten-minute lease recovers interrupted work. The recent-window limit means long outages and older provider corrections require a separately planned historical backfill.

Source/API guide: `docs/WATER-COLLECTION.md`. OpenAPI contract: `docs/api/water-collection.openapi.json`. Operating datasets and the user's saved dashboard layout are preserved. Runtime, credentials, database files and private preimages are excluded from delivery.
