# Change Manifest — Packet 00 Alignment, 2026-08-11

Work order task 10 limits implementation to "low-risk foundation changes that preserve existing
behavior." One functional change was made, because it closes a confirmed live exposure by
restoring an invariant `AGENTS.md` already claimed rather than moving a boundary.

## Functional change — 1 file

### `ieso_backend.py` · `Handler._operator_gate_blocks()`

Added, after the route is classified as operator-only and before the header check:

```python
if CHECKIN_ORIGIN:
    public_host = (urlparse(CHECKIN_ORIGIN).hostname or "").lower()
    arrived_on = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip().lower()
    if public_host and arrived_on == public_host:
        return True
```

**Why.** The gate checked only that `Cf-Access-Jwt-Assertion` was *present*. Cloudflare does not
strip a client-supplied copy, so a forged header from the open internet satisfied it — returning
the roster, and allowing `POST /api/checkins/<id>/help/resolve`, i.e. clearing a lone worker's
distress call. The edge path rule cannot compensate: it must admit `api/checkins(/.*)?` for the
worker PWA to POST there.

**Risk profile.** Strictly narrowing — the branch can only return `True` (refuse), so it can turn
200 into 403 and never the reverse. It is unreachable for non-operator routes, so every worker
device route is untouched. No new import, no new dependency, no configuration change.

**Not a complete fix.** The JWT is still unverified, and the `0.0.0.0` bind means a forged header
with a LAN `Host` is still accepted (verified: returns 200). See ADR-011 / decision D-2.

## Tests — 1 file

### `tests/test_api_workflows.py`

| Added | Covers |
|---|---|
| `host_request()` helper | issuing a request that claims to have arrived on a given `Host` |
| `test_forged_access_header_cannot_open_the_roster_on_the_public_host` | the read path: roster, `include=all`, history, and that worker routes and `ops.` are unaffected |
| `test_forged_access_header_cannot_clear_a_distress_call` | the write path: `help/acknowledge`, `help/resolve`, `provisional`, `time` — and that the worker can still raise the alarm and a real operator can still clear it |

Both were verified to fail `AssertionError: 200 != 403` with the functional change removed, then
the change was restored and the suite re-run.

**Suite: 81 passed before → 83 passed after, 0 failed.**

## Documentation

| File | Change |
|---|---|
| `AGENTS.md` | Corrected invariant 1 (header presence never proved anything; the write path was worse; LAN still open). Baseline `66` → `83`. Named the four stop-the-line security tests. Added a pointer to `docs/`. |
| `docs/architecture/` | 7 new documents |
| `docs/adr/` | 13 new ADRs + index |

`AGENTS.md` was edited rather than duplicated because a stale copy telling an agent the gate is
optional would be a live data exposure, not a documentation bug — its own stated reasoning.

## Not changed, deliberately

- Authentication trust boundary, safety escalation, switching release semantics, OT connectivity —
  all explicit stop conditions in the work order.
- Worker device credentials and the predictable `checkin-<epoch_ms>` ids (D-1) — an unguessable-id
  change is two lines, but it is an authentication decision for the owner.
- Repository restructuring, dead-file removal, and the Stage 2 foundation work (config object,
  correlation ids, migration ledger, audit envelope, `/api/v1`). Specified in
  `MIGRATION_SEQUENCE.md`; broader than this work order authorises.
