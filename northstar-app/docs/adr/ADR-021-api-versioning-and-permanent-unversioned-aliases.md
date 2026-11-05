# ADR-021 — API versioning, with the unversioned paths kept forever

**Status:** Proposed · `MIGRATION_SEQUENCE.md` Stage 2.5

## Context
37 routes, all unversioned under `/api/`. No OpenAPI or schema document. Errors are
`{"error": "<free text>"}` with no machine-readable code. No correlation id, no idempotency.

The binding constraint is not the dashboard — it is `contractor-checkin.html`, a PWA installed on
contractors' phones that updates on its own schedule, at remote sites, and cannot be assumed to
have updated.

## Decision
Serve every route at `/api/v1/*` in addition to `/api/*`, with identical handlers and payloads.
Add the structured error object alongside the existing `error` string rather than replacing it.

## Consequences
- **The unversioned paths become permanent aliases.** They can be frozen, never removed. That is
  the price of a field-installed PWA and should be recorded rather than fought.
- New clients and all Packet 02–06 modules consume `/api/v1`.
- Correlation ids and idempotency keys (`POST /api/v1/checkins` at minimum) land with v1: a
  retried check-in on a flaky mobile link currently creates a duplicate worker record.
- Generalise `switching_drafts.record_version` — currently the only place a lost update is
  impossible — to every mutable record.
