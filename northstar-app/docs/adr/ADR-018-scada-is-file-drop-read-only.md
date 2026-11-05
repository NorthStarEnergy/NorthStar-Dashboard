# ADR-018 — SCADA integration is file-drop and read-only

**Status:** Accepted · relates to ADR-006 (open, SCADA integration method)

## Context
Packet 04: "Any SCADA/OT integration starts read-only unless separately engineered, reviewed,
approved, tested, and governed. NorthStar must not create an accidental control path into OT."

## Decision
SCADA data arrives as CSV files dropped into `NORTHSTAR_SCADA_PATH`, polled every
`NORTHSTAR_SCADA_POLL_SECONDS`. No network connection to any OT system exists.

## Consequences
- There is no write path and no protocol client, so there is no accidental control path. The OT
  boundary Packet 00 asks for is already satisfied — **a future "improvement" to a live connection
  would be an OT connectivity change and an explicit stop condition.**
- Imports are validated: `scada_import_rejects` records what was refused and why,
  `scada_feed_watermarks` prevents replay, `scada_import_batches` records provenance.
- Freshness is derived from `stale_after_minutes`; the UI must not present imported readings as
  verified live field state (Packet 04: "Never represent inferred topology/state as verified field
  state without an authoritative source").
- ADR-006 stays open: this is the pilot mechanism, not an approved integration architecture.
