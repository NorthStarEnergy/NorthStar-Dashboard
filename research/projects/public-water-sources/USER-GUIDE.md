# Public water collection

Open **Flows → Collection & schedules**, or **Data workspace → Water collection**. The page is `/water-collection.html` on the operator hostname.

## Existing public sources

This collector reuses the station IDs and datums already configured in `northstar_flows.py` and `northstar_water_elevations.py`.

- **Water Survey of Canada / ECCC:** 24 existing gauges, 21 marked real-time and three historical-only. The persistent collector uses GeoMet `hydrometric-realtime` for water level and discharge. The existing Flows snapshot adapter also uses Wateroffice CSV for five of these gauges; it remains available and is not double-counted as another provider. [Official GeoMet hydrometric guide](https://eccc-msc.github.io/open-data/usage/use-case_oafeat/use-case_oafeat-interactive_en/).
- **Québec CEHQ:** existing gauges 050801 and 040110. Their configured tab-separated reports provide discharge; no water level is inferred. Report times use fixed Eastern Standard Time, UTC−5, throughout the year. The legacy CEHQ adapter is corrected to the same convention. [Official hydrometric service](https://www.cehq.gouv.qc.ca/hydrometrie/) and [time convention](https://www.cehq.gouv.qc.ca/Suivihydro/graphique.asp?NoStation=051005).
- **USGS Water Data:** existing gauges 05127500, 05129115 and 05129290, parameter 63160. These report water-surface elevation in feet; the collector preserves the raw value/unit and converts the displayed value to metres using exactly 0.3048. Existing provider datum metadata is retained. Distinct provider time series remain separate. [Official API documentation](https://api.waterdata.usgs.gov/docs/ogcapi/).

Historical-only gauges, pending NOAA/LWCB/PCA mappings, internal SCADA and SharePoint reporting are not scheduled. There is no new provider signup, private-source connection, arbitrary URL fetching, plant-elevation inference or datum conversion.

## Schedule and on-demand controls

Each provider has an enabled flag, interval in minutes, recent-window length in hours and selected active gauges. Initial defaults: enabled, every 15 minutes, recheck the last 24 hours. Supported interval: 5–10,080 minutes. Supported recent window: 1–168 hours. Historical-only gauges cannot be selected.

Click **Save schedule** after changes. Settings are persisted in PostgreSQL and audited with operator identity and before/after snapshots. A stale settings version returns HTTP 409 instead of overwriting another operator's update.

**Collect now** uses the saved provider settings and works even when automatic collection is paused. An existing queued/running request is returned instead of launching a duplicate. Wait at least sixty seconds between completed on-demand runs. Provider cooldowns apply to scheduled and manual runs.

The backend checks schedules every ten seconds. Each next scheduled run is due the configured interval after the previous run finishes, so long runs do not overlap. Three bounded worker threads service the three providers. A five-minute run budget, bounded response/page limits and request timeouts prevent unrestricted downloads. A station window is committed only after all its pages have been fetched; completed stations remain committed if a later station fails.

HTTP 429 stops further requests for that provider and persists its Retry-After cooldown, capped at one day. Network/server errors have bounded retries and a persisted cooldown. Expired ten-minute worker leases are marked interrupted and can be recovered. No overlapping run is permitted per provider, including across processes.

Schedules run while NorthStar's backend is running and resume from persisted configuration after a restart. There is no new OS service or external cloud scheduler. An outage longer than the configured recent window leaves a history gap; this release does not claim archival backfill. Provider corrections outside the recent window are not rediscovered automatically.

## Storage and provenance

Public data is stored in PostgreSQL schema `ns_water`, separately from the eight editable operating datasets in `ns_data` and the existing SQLite stores.

- `sources`: selected gauges, intervals, enable flags, next-run and cooldown state, source totals and last results.
- `runs`: durable queued/running/completed/partial/failed/interrupted state, operator/scheduler identity, frozen settings, counts and per-gauge outcomes.
- `observations`: source, station, provider series, metric, UTC observation time, SI value/unit, datum, raw value/unit, provider quality, source URL, collection/check times and revision.
- `revisions`: a full snapshot of every new or corrected observation.
- `settings_audit`: before/after configuration revisions.

Uniqueness is provider + station + series + observation timestamp. Repeated unchanged downloads do not create new observations or revisions. Missing values remain missing; zero stays zero. Water levels and discharge remain separate series with independent timestamps. Original observations cannot be edited through the collection API. Existing manual and plant records are never promoted or overwritten.

The observation view filters by provider, gauge, metric and UTC range, retrieves bounded pages and displays revision history. Editor range inputs use browser-local time and are sent to the API in UTC. Page export includes only the current page, with spreadsheet control prefixes escaped.

## API

All endpoints require the existing operator authentication on the operator hostname. Public check-in hosts, site-viewer/platform-demo roles and cross-origin writes are denied.

- `GET /api/water-collection/status`: providers, known gauges, settings, active runs and collection state.
- `POST /api/water-collection/sources/{wsc|cehq|usgs}`: save `version`, `enabled`, `intervalMinutes`, `lookbackHours`, `stationIds`. Only existing active station IDs are accepted.
- `POST /api/water-collection/collect`: body `{"source":"wsc"}`; returns HTTP 202 with durable run ID and `alreadyRunning`.
- `GET /api/water-collection/runs`: latest thirty runs; optional `source` filter.
- `GET /api/water-collection/observations`: optional `source`, `station`, `metric`, `start`, `end`, `limit`, `cursor`. Dates require a timezone; limit is capped at 200. Default page size is 100. Return to page one when changing filters.
- `GET /api/water-collection/history?id=123`: latest fifty revisions of an observation.
- `GET /api/water-collection/settings-history`: latest fifty configuration changes.

Responses use JSON. Validation errors return 400; stale settings/provider cooldowns return 409; unavailable PostgreSQL returns 503. Fetch errors belong to run history rather than a false HTTP success indicating collection completion. A 202 response means queued, not completed.

The machine-readable endpoint contract is `docs/api/water-collection.openapi.json`. Do not put login passwords or session cookies in URLs or source files.

## Setup and verification

`python scripts/setup-data-postgres.py` installs the additive collection schema and default provider configuration. The backend's collector also initializes it idempotently on first use. Existing source settings are preserved. The existing custom-format PostgreSQL backup includes `ns_water` automatically.

Unit tests cover parsing, CEHQ fixed EST, USGS conversion, safe pagination and Retry-After. Actual PostgreSQL tests create/drop disposable `ns_test_*` databases for settings, deduplication, revisions, due scheduling, worker leases, cooldowns and filters. Authenticated browser tests use temporary records/authentication; they do not prove production activation. Delivery verification records actual public endpoint checks and the final runtime boundary separately.
