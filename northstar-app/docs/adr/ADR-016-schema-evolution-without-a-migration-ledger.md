# ADR-016 — Schema evolves by conditional ALTER TABLE, with no ledger

**Status:** Accepted historically · **superseded by** `MIGRATION_SEQUENCE.md` Stage 2.3

## Context
`northstar_store._migrate_schema()` reads `PRAGMA table_info` and conditionally adds columns
(`help_state`, `prior_help_state`, `opened_by`, `record_version`, …). Fresh installs come from
`executescript(SCHEMA)` with `CREATE TABLE IF NOT EXISTS`.

## Consequences
- It works, it is idempotent, and each addition documents why it exists.
- But: the database cannot state what version it is; two agents adding columns concurrently produce
  two different databases that both "pass"; there is no down path; and no test exercises an old
  database file forward. Packet 06 lists migration tests as a required layer.
- Combined with the repository having two commits and everything else uncommitted, there was no
  rollback point for code *or* schema as of 2026-08-11.

## Replacement
Add `schema_migrations`, convert the existing conditionals into numbered forward migrations, and
add a migration test that starts from a pre-migration fixture. Cheaper before the domain split
than after.
