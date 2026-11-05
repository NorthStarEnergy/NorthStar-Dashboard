# Packet 00 Alignment — Handoff

2026-08-11. Delivers the Packet 00 `07_AGENT_WORK_ORDER.md` required output.

---

## Do this first

A probe of the live tunnel found that **the operator gate could be bypassed from the open
internet** by sending a forged `Cf-Access-Jwt-Assertion` header. It returned HTTP 200 and the full
worker roster. The fix is written and tested, but **the running server still holds the old code in
memory**, so the exposure is open until it restarts.

```powershell
.\start-northstar.ps1 -NoBrowser
```

Then confirm it is closed — this must print `403`:

```bash
curl.exe -s -o /dev/null -w "%{http_code}\n" -H "Cf-Access-Jwt-Assertion: forged" "https://checkin.northstarenergy.ca/api/checkins"
```

Restarting briefly interrupts a lone-worker safety system, which is why it was left for you rather
than done unattended. Full detail in `docs/adr/ADR-012`.

---

## What was found

| Probe | Result |
|---|---|
| `GET /api/checkins`, no header | 403 — correct |
| `GET /api/checkins`, forged header | **200, 3,505 bytes — the live roster** |
| `GET /api/checkins?include=all`, forged | **200, 10,782 bytes** |
| `GET /api/checkins/history`, forged | **200, 17,876 bytes** |
| `/api/checkin-tokens`, `/api/logbook`, `/api/switching/drafts`, `/api/voice/recordings` | 404 at the edge — outside the path allowlist, never reached the origin |

Cloudflare does **not** strip a client-supplied `Cf-Access-Jwt-Assertion`. The gate checked only
that the header was present, so presence proved nothing. The edge path rule could not compensate,
because it must admit `api/checkins(/.*)?` for the worker PWA to POST there.

Exposed while open: worker names, companies, sites, notes, live GPS coordinates, help state, and
movement history. Phone numbers were masked — that part was already correct. Only the
`/api/checkins*` family was reachable; everything else was stopped at the edge.

**The write path is worse than the read path.** The same edge rule admits the operator sub-routes,
so `POST /api/checkins/<id>/help/resolve` also reaches the origin from the internet. Reproduced in
test: with the old header-only check, a forged header returned **200** — an unauthenticated caller
could clear a lone worker's distress call. That is the same failure class the 2026-08-11 audit
already fixed once via `OPERATOR_ROUTE_PATTERNS`, reopened through a different door. It is closed
by the same fix and covered by its own regression test.

**The LAN path is still open, and this was verified rather than assumed.** With the gate on and
the fix in place, a request carrying `Host: 192.168.1.50:4180` plus a forged header still returns
**200** on `GET /api/checkins`. The server binds `0.0.0.0`, so anything on the local network is
still an operator. Only D-2 closes that — bind `127.0.0.1`, verify the JWT, or both.

## What was changed

Two files, plus documentation.

| File | Change |
|---|---|
| `ieso_backend.py` | `_operator_gate_blocks()` now also refuses operator routes when the request arrived on the public check-in hostname (`Host` vs `NORTHSTAR_CHECKIN_ORIGIN`), regardless of headers |
| `tests/test_api_workflows.py` | `test_forged_access_header_cannot_open_the_roster_on_the_public_host` (read) and `test_forged_access_header_cannot_clear_a_distress_call` (write) |
| `AGENTS.md` | Corrected the header invariant, baseline `66` → `82`, pointer to `docs/` |

The change is **strictly narrowing** — it can only turn 200 into 403, never the reverse. Worker
device routes are not operator routes and never reach the check, so no phone in the field is
affected. Verified by removing the check and re-running: both new tests fail `200 != 403`.

**Test baseline: 81 passed before, 83 passed after, 0 failed.** Note `AGENTS.md` had recorded 66;
the suite had grown since that was written.

## Deliverables

| Work order item | File |
|---|---|
| `CURRENT_STATE_INVENTORY.md` | `docs/architecture/CURRENT_STATE_INVENTORY.md` |
| `GAP_ANALYSIS.md` | `docs/architecture/GAP_ANALYSIS.md` |
| `PROPOSED_TARGET_ARCHITECTURE.md` | `docs/architecture/PROPOSED_TARGET_ARCHITECTURE.md` |
| `MIGRATION_SEQUENCE.md` | `docs/architecture/MIGRATION_SEQUENCE.md` |
| Updated decision log | `docs/architecture/DECISION_LOG.md` + `docs/adr/` (ADR-009 … ADR-021) |
| Tests for code changes | `tests/test_api_workflows.py` |

## Headline findings, beyond the live one

1. **No identity model.** Authorization is one bit: operator or not. A `qualified_person` cannot be
   distinguished from any operator, yet recording a switching review is a qualified-person act
   today performed by anyone who passes the gate. This blocks Packets 02–06 and is the single
   biggest structural gap. (G-11)
2. **Worker device routes have no credential**, and check-in ids are `checkin-<epoch_ms>` —
   predictable — with no rate limiting anywhere in the codebase. An unauthenticated `DELETE`
   closes a check-in, and a closed record is not evaluated for overdue. **Not changed**: it is an
   authentication-trust-boundary and safety-escalation decision, which the work order makes a stop
   condition. (G-1 / ADR-015 / **D-1**)
3. **No application-service layer.** Domain rules live in a ~400-line `if/elif` in the HTTP
   handler. A side effect is that check-in creation spans three modules in three separate
   transactions, so a failure part-way leaves a check-in with no security row — silently. (G-2)
4. **Backups have never been restored.** `daily_backup()` is correct, and Packet 06 requires a
   restore test that has never run. Cheapest high-value item in the whole plan; needs no decision
   from anyone. (`MIGRATION_SEQUENCE.md` Stage 0.3)
5. **The repository has two commits** and everything else is uncommitted working tree. There is no
   rollback point for code or schema. Stage 0 exists to fix this before anything structural.
6. **The dashboard has an AI chat box POSTing to `/api/ai`, which does not exist.** Dead today; the
   risk is that whoever implements it sets the AI policy for a control room by accident.
   (G-7 / ADR-020 / **D-6**)

## What was deliberately not done

- **No restructuring.** Work order task 7 forbids gratuitous rewrites, and the target architecture
  is written to be adopted additively rather than by cutover.
- **No change to authentication, safety escalation, switching semantics, or OT.** All are stop
  conditions. The one auth-adjacent change made — ADR-012 — restores an invariant `AGENTS.md`
  already claimed, rather than moving a boundary.
- **No electrical or safety rule invented.** Four missing authoritative requirements are listed in
  `DECISION_LOG.md`; none was guessed at.
- **Stage 2 foundation work (config object, correlation ids, migration ledger, audit envelope,
  `/api/v1`) is specified but not implemented.** It is behaviour-preserving and needs no decision,
  but it is broader than "low-risk foundation changes" and should be its own assignment. Say the
  word and it is a clean next packet.

## Decisions needed from you

| ID | Question | Urgency |
|---|---|---|
| **D-1** | Worker routes have no credential and ids are guessable. Fix (unguessable ids is a two-line change) or accept with a date? | Live |
| **D-2** | Bind to `127.0.0.1` and/or verify the Access JWT. Also worth adding a Cloudflare Transform Rule stripping client-supplied `Cf-*` on `checkin.` | Live |
| **D-3** | Cloudflare Access or company IdP? Blocks Packet 02, which blocks 03–06 | Chase first among the non-urgent |
| **D-4** | SQLite or plan PostgreSQL? | Shapes Packet 01 |
| **D-5** | Who approves the tunnel-from-a-workstation production topology, and by when? | Blocks "production" |
| **D-6** | Is there an AI surface in this product, and what may it see? | Before `/api/ai` exists |
| **D-7** | Electrical calculation engine — fidelity, library, benchmarks | Blocks Packets 03/04/06 |

One open item from before this work order is still unanswered and is worth folding in: the
check-in form promises "hourly safety check-ins" that the heartbeat cannot deliver (ADR-017). A
wording change was offered; no wording has been chosen.
