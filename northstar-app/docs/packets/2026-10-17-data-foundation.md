# High-level operational data foundation

User requested databases for unit runtime, power, water levels/flows, weather,
operations, generators, equipment and fish spawning within existing NorthStar.

Added a standalone, additive SQLite foundation with eight domains and fifteen
tables, a safe initializer, and nine focused tests. The initialized local database
contains twenty canonical station identities and zero operational observations.
Existing `northstar.db`, HTTP routes, UI, authentication and running service are unchanged.

Source: `database-foundation/README.md`, `database-foundation/schema.sql`,
`scripts/setup-data-foundation.py`, `tests/test_data_foundation.py`.
Local database: `data/northstar-foundation.db` (ignored/private runtime state).

Checks cover safe initialization/refusal to overwrite, foreign keys and station
identity, missing versus zero, UTC observation timestamps, append-only observation
revisions, forecast issue separation, batch provenance, interval durations, water
datums, overlapping runtime intervals, fish counts and environmental review evidence.
Initialized database integrity is `ok` with zero foreign-key violations.
Full regression and release-check outcomes are recorded in the delivered handoff.

Scope: storage foundation only. Source discovery/mapping, ingestion, application
authorization, scheduled collection, backups/restore, scale benchmarks and dashboard
integration remain next-phase work. No operational readings or private databases
are included in the delivery package. Dirty `dashboard-layout-default.js` is preserved.
