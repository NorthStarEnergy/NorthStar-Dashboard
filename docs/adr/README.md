# NorthStar — Architecture Decision Records

ADR-000 to ADR-008 are defined by **Packet 00** (`08_DECISION_LOG.md`) and are reproduced with
repo-grounded findings in `../architecture/DECISION_LOG.md`. ADR-009 onward are this repository's
own decisions, recorded 2026-08-11 during the Packet 00 alignment.

| ID | Decision | Status |
|---|---|---|
| [ADR-009](ADR-009-authentication-delegated-to-cloudflare-access.md) | Authentication delegated to Cloudflare Access at the edge | Accepted |
| [ADR-010](ADR-010-method-aware-operator-gate.md) | The operator gate is method-aware and route-table driven | Accepted |
| [ADR-011](ADR-011-verify-the-access-jwt-at-the-origin.md) | Verify the Access JWT at the origin | **Open — D-2** |
| [ADR-012](ADR-012-operator-routes-refused-on-the-public-hostname.md) | Operator routes refused on the public check-in hostname | Accepted 2026-08-11 |
| [ADR-013](ADR-013-python-standard-library-single-process.md) | Python standard library, one process | Accepted |
| [ADR-014](ADR-014-sqlite-as-the-operational-store.md) | SQLite is the operational store | Accepted (pilot) |
| [ADR-015](ADR-015-worker-route-credential-and-entity-ids.md) | Worker device routes have no credential; ids are predictable | **Open — D-1, live** |
| [ADR-016](ADR-016-schema-evolution-without-a-migration-ledger.md) | Schema evolves by conditional ALTER TABLE | Superseded |
| [ADR-017](ADR-017-overdue-is-advisory.md) | OVERDUE is advisory; the PWA is the finished shape | Accepted |
| [ADR-018](ADR-018-scada-is-file-drop-read-only.md) | SCADA integration is file-drop and read-only | Accepted |
| [ADR-019](ADR-019-voice-triage-rules.md) | Voice: never invent, never suppress safety, filtered ≠ deleted | Accepted |
| [ADR-020](ADR-020-ai-surface-has-no-contract.md) | The dashboard's AI surface has no server contract | **Open — D-6** |
| [ADR-021](ADR-021-api-versioning-and-permanent-unversioned-aliases.md) | API versioning; unversioned paths kept forever | Proposed |
| [ADR-022](ADR-022-loopback-only-origin-for-public-tunnel.md) | Loopback-only origin for the public tunnel | Accepted 2026-08-12 |
| [ADR-023](ADR-023-demo-operator-authentication.md) | Demo operator authentication (third gate mode) | Accepted 2026-08-13 |

## Rules
- One decision per file. Never edit an accepted ADR to change its meaning — supersede it with a
  new one and mark the old `Superseded by ADR-nnn`.
- Packet 00 `02_MODULE_CONTRACT.md`: no agent may create a hidden cross-module dependency. A new
  dependency requires an ADR **and** an update to the dependency map.
- `AGENTS.md` remains the operative brief. Where it and an ADR disagree, `AGENTS.md` wins and the
  ADR is wrong — fix the ADR.
