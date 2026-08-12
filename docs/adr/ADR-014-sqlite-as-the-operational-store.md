# ADR-014 — SQLite is the operational store, behind repository functions

**Status:** Accepted for development and the current pilot · ADR-003 (production database) remains open

## Context
One `data/northstar.db`, WAL, `foreign_keys=ON`, 26 tables, serialised by a single global
`threading.Lock`. Packet 03 explicitly forbids hard-coding the architecture to SQLite.

## Decision
Stay on SQLite until a requirement forces otherwise. Keep the *choice* reversible rather than
pre-emptively migrating.

## Consequences
- Adequate for current volume; the single global write lock is the ceiling, and `scada_readings`
  is the only table with unbounded growth — the natural trigger to revisit.
- Reversibility is not yet real. Two SQLite-specific leaks must be retired first: the global
  `threading.Lock` (a single-writer workaround) and `sqlite3.Row` appearing in mapper signatures
  such as `_row_to_record(row: sqlite3.Row)`.
- `daily_backup()` uses the sqlite backup API and copies a live WAL database consistently. **No
  restore has ever been performed or tested** — Packet 06 requires that test layer. See
  `MIGRATION_SEQUENCE.md` Stage 0.3.
- Schema evolution is `PRAGMA table_info` + conditional `ALTER TABLE`, with no version table and no
  down path (ADR-016).
