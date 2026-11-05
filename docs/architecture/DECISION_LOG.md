# Architecture Decision Log — updated against the repository

Work order task 7. This is Packet 00's `08_DECISION_LOG.md` with each row checked against the
code as it actually stands on 2026-08-11. Repository-specific decisions are ADR-009 onward in
`../adr/`.

## Packet 00 decisions

| ID | Decision | Packet status | Verified state in this repository |
|---|---|---|---|
| ADR-000 | NorthStar is assistive and does not replace SCADA/protection/control | Accepted | **Holds.** No OT write path exists; SCADA is file-drop read-only (ADR-018). Switching stops at REVIEW RECORDED – NOT RELEASE. No autonomous action anywhere |
| ADR-001 | Training/simulation state isolated from live/observed state | Accepted | **Not yet exercised.** No training module exists, so the boundary is unbreached. Packet 06 must preserve it; `PROPOSED_TARGET_ARCHITECTURE.md` §2 reserves a separate simulation context |
| ADR-002 | UI communicates through service/API contracts, not direct DB access | Accepted | **Holds at the process boundary.** Every client goes through `/api/*`; mapper functions keep table columns out of payloads. Weakness is different in kind: there is no application-service layer behind the router (G-2) |
| ADR-003 | Production database | Open | Now informed: SQLite, 26 tables, single global write lock, `scada_readings` the only unbounded table. See ADR-014. **Decision D-4** |
| ADR-004 | Production hosting topology | Open | **The developer workstation is the production host**, published via Cloudflare Tunnel since 2026-08-11. No test or staging environment, no CI, no monitoring, unverified backups. Packet 00 §4 forbids treating this as approved. **Decision D-5** |
| ADR-005 | Identity provider / SSO | Open | Cloudflare Access at the edge, no local identity, authorization is one bit (ADR-009, ADR-011). Blocks Packet 02 and therefore 03–06. **Decision D-3 — the one worth chasing first** |
| ADR-006 | SCADA integration method | Open | Pilot mechanism decided and working: validated CSV file-drop with rejects and watermarks (ADR-018). The *approved* interface and security architecture remain open |
| ADR-007 | Electrical calculation engine | Open | Nothing built. Blocks Packets 03, 04, 06. **Decision D-7** |
| ADR-008 | Teams/mobile workforce signal permissions | Open | No Teams integration exists. The PWA already collects live GPS and retains location events under a configurable policy with **no cited privacy or labour requirement behind the number**. Needs the review Packet 04 asks for |

## Decisions this work order added

| ID | Question | Owner | Urgency |
|---|---|---|---|
| **D-1** | Worker device routes have no credential and check-in ids are predictable epoch milliseconds. Fix, or accept with a date? (ADR-015) | Owner + worker-safety owner | **Live** |
| **D-2** | Verify the Access JWT and/or bind to `127.0.0.1`. The probe confirmed a bypass (ADR-011, ADR-012); Packet 17 closes the direct LAN path with a loopback-only production bind | Owner | **Closed for current topology; JWT required before any non-loopback bind** |
| **D-3** | ADR-005 — stay on Cloudflare Access, or move to the company IdP? | Owner + IT | Blocks Packet 02 |
| **D-4** | ADR-003 — stay on SQLite, or plan PostgreSQL? | Owner | Shapes Packet 01 |
| **D-5** | ADR-004 — who approves the tunnel-from-a-workstation topology, and by when? | Owner + IT/OT/security | Blocks "production" |
| **D-6** | Is there an AI surface in this product? What may it see, how is output labelled? (ADR-020) | Owner | Before `/api/ai` exists |
| **D-7** | ADR-007 — electrical calculation engine: fidelity, library, validation benchmarks | Owner + engineering | Blocks Packets 03/04/06 |

## Authoritative requirements that are missing

Packet 00 work order task 9 requires these be flagged, not invented. None is answered by anything
in this repository:

1. **Lone-worker check-in cadence.** `contractor-checkin.html` promises "hourly safety check-ins"
   while the heartbeat is a browser timer a locked phone kills, and OVERDUE is advisory by
   decision (ADR-017). The applicable Ontario lone-worker requirement is not cited anywhere.
2. **Switching procedural rules.** `_switching_validation_errors` enforces form completeness.
   The UWPC/EUSR procedure it is meant to reflect is not referenced, so "valid" means "the fields
   are filled in".
3. **Location-data retention periods.** `retention_policies` and
   `NORTHSTAR_COORDINATE_RETENTION_DAYS` implement a mechanism with a default number and no cited
   privacy or labour basis (ADR-008).
4. **Per-site escalation procedure.** `site_policies` / `escalation_mode()` encode a mechanism;
   the authoritative escalation procedure is not referenced.

## Change rule

Packet 00 `02_MODULE_CONTRACT.md`: no agent may create a hidden cross-module dependency. A new
cross-module dependency requires an ADR **and** an update to `09_DEPENDENCY_MAP.md`. Contract
changes require versioning plus updates to dependent packet documentation.
