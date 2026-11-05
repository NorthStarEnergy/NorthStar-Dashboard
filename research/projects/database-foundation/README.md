# NorthStar database foundation

Eight linked data areas in a separate local SQLite database. This is an initialized
foundation, not a completed historian, data import, or dashboard integration.
The existing operational database remains the authority for current application records.

| Area | Records | Typical questions |
|---|---|---|
| Unit runtime | Running/stopped/unavailable intervals; cumulative hour-meter series | How long did each unit run? How many starts? |
| Power and energy | MW, MWh, voltage, current, frequency and other tagged measurements | What did each station generate during an interval? |
| Water | Forebay/tailwater levels, inflow, discharge, spill, water temperature | How do levels and flows change with generation? |
| Weather | Observations and separate forecast issue times | What weather coincided with operating conditions? |
| Operations and maintenance | References to logs, outages, alarms, daily reports, inspections and work orders | What happened at the same station and time? |
| Generators | Versioned ratings/specifications; condition measurement series | Which generator configuration applied at the time? |
| Equipment | Station, designation, parent equipment, manufacturer/model/serial | Which readings and records belong to this asset? |
| Fish spawning and environment | Surveys, species, life/spawning stage, counts/presence, effort, reaches and sourced seasonal windows | What was observed, where, when, and with what survey effort? |

## Location and setup

- Database: `data/northstar-foundation.db` (local only, excluded from Git and Drive).
- Reproducible source: `database-foundation/schema.sql`, `scripts/setup-data-foundation.py`.
- Run once from project root: `python scripts/setup-data-foundation.py`.
- The command refuses to modify an existing file. It seeds the eight domains and
  canonical station identities from `northstar_sites.py`; it invents no equipment,
  measurements, fish species, operating limits, or source connections.
- The running service does not open this database. No endpoints, credentials,
  scheduled ingestion, or dashboard controls are added in this phase.
- Use the committed source for future changes; delivery ZIPs are reference copies.

## Relationships and record rules

Stations link equipment, measurement series, operations references, and fish surveys.
Sources link import batches and reviewed external identifiers to those records.
Each series defines one metric, unit, source tag, measurement kind, and station.
Observations carry timestamps, quality, source rows, batches and revision history.
For example, a station's discharge series and fish survey can be compared by time
and reach after their geographic mapping is reviewed; coincidence alone is not causation.

- Writers must enable SQLite foreign keys on every connection. Access remains
  local-file access until an authenticated application layer is implemented.
- Store measurement timestamps as UTC `YYYY-MM-DDTHH:MM:SSZ`. Retain source timezone
  and raw timestamp in the controlled source; resolve ambiguous local/DST times
  during import. This initial schema uses second precision.
- Missing/rejected values are null, never fabricated zero. Unreviewed/estimated
  readings remain distinguishable from good readings.
- Water-level series require a datum. An unknown datum may be explicitly recorded
  as unknown but cannot be compared or converted until resolved. Public gauges
  remain distinct from plant instruments and need reviewed station mapping.
- Forecasts retain issue time and never replace observed weather.
- MW is instantaneous power; MWh is energy over an interval. Interval totals and
  averages require a duration. Never sum cumulative counters; reconcile resets,
  rollovers, gaps and sampling coverage before calculating derived totals.
- Observation corrections append a new revision. `current_observations` selects
  the highest revision, including missing/rejected corrections; consumers must
  explicitly filter quality. Historical revisions remain available.
- Runtime intervals cannot overlap for an equipment ID. Open intervals have no
  assumed end or computed final duration. Reconcile conflicting sources before import.
- Fish count, redd count, egg count and presence are distinct measures. Unknown
  presence is not absence. Survey method/effort must accompany comparisons.
- Environmental windows store source-backed draft/review records, not equipment
  commands, legal compliance determinations, or automatic operating constraints.

## Existing NorthStar mapping

| Existing source | Foundation treatment |
|---|---|
| `northstar_sites.py` | Reuse canonical station IDs; no invented stations |
| `asset_registry` | Map by reviewed site/designation into equipment; retain operational asset ID |
| `unit_cycling_records` | Preserve original event and counter meanings; derive intervals only after review |
| `water_observations`, `water_source_files/rows` | Preserve source row, unit, quality and datum; do not import unknown mappings as accepted data |
| `scada_feeds/tags/readings` | Map source tags to measurement series; retain batch provenance |
| `logbook`, outages, daily reports, existing audit | Link original record IDs; existing workflows remain authoritative |
| `northstar_flows.py`, `northstar_water_elevations.py` | Public provider adapters exist; persistent collection is separate work |
| `northstar_data_catalog.py` | Existing file provenance catalog is reusable; catalogue presence is not imported measurement history |

## Next ingestion phase

1. Identify source locations, owners, formats, total history, sample rates, file sizes,
   timezone/datum conventions and required retention. These are not yet supplied.
2. Review one representative source per domain. Agree station/equipment aliases,
   column mappings, units, timestamps, duplicate handling and correction rules.
3. Build source-specific staging and validation with rejection reports, idempotent
   imports, audit records and reconciled source row counts/totals. Do not bypass the
   existing operator gate when adding service routes.
4. Import historical data in bounded batches, reconcile totals and missing coverage,
   then add scheduled ingestion and dashboard queries. Measure actual load before
   selecting long-term historian infrastructure; no capacity benchmark is claimed.
5. Add controlled backups, restore drills, access/retention policies and monitoring
   before relying on this database operationally. Existing `northstar.db` backups
   do not automatically cover this separate database.

## Verification boundary

Schema, referential integrity, revision/quality constraints, datum requirement,
forecast separation, runtime overlap protection, fish records and safe setup are
tested using synthetic disposable records. No actual operational history is imported,
no feed is connected, and production-scale or authenticated dashboard use is unverified.
