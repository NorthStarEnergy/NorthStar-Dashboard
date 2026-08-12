# ADR-012 — Operator routes are refused on the public check-in hostname

**Status:** Accepted · 2026-08-11 (implemented; awaiting a backend restart to take effect live)
**Relates to:** ADR-009, ADR-010, ADR-011

## Context
A probe of the live tunnel on 2026-08-11 sent `Cf-Access-Jwt-Assertion: forged` from the open
internet to `https://checkin.northstarenergy.ca/api/checkins` and received **HTTP 200 with the
full roster** (3,505 bytes), plus `/api/checkins/history` (17,876 bytes) and
`?include=all` (10,782 bytes). Without the header the same request correctly returned 403.

Cloudflare passes a client-supplied `Cf-Access-Jwt-Assertion` through to the origin. The edge path
rule could not help: it must admit `api/checkins(/.*)?` because the worker PWA POSTs there. The
gate was the only control, and header-presence was not a control.

Other operator routes were unaffected — `/api/checkin-tokens`, `/api/logbook`,
`/api/switching/drafts` and `/api/voice/recordings` returned 404 at the edge, outside the path
allowlist.

**The write path was worse than the read path.** Because the edge rule admits
`api/checkins(/.*)?`, the operator sub-routes `POST /api/checkins/<id>/help/acknowledge`,
`/help/resolve`, `/provisional` and `/time` also reach the origin from the internet. Reproduced in
test: with the header check alone, a forged header returned **200** on `help/resolve` — an
unauthenticated caller could clear a lone worker's distress call from the control room's view.
This is the same failure class the 2026-08-11 audit fixed with `OPERATOR_ROUTE_PATTERNS`, reopened
through a different door. Covered by
`test_forged_access_header_cannot_clear_a_distress_call`.

## Decision
Both hostnames reach the same listener, but cloudflared forwards the `Host` the request arrived
on. The operator surface does not exist on the public check-in hostname, so refuse operator routes
there **regardless of any header**.

## Consequences
- Strictly narrowing: the check can only turn 200 into 403. Worker device routes are not operator
  routes and never reach it, so no phone in the field is affected.
- No new dependency, no crypto, no change to the intended trust model — it restores the invariant
  `AGENTS.md` already claimed.
- Covered by two tests, both of which fail `200 != 403` when the check is removed:
  `test_forged_access_header_cannot_open_the_roster_on_the_public_host` (read) and
  `test_forged_access_header_cannot_clear_a_distress_call` (write).
- **Defence in depth, not the whole answer. The LAN path is still open and this was verified, not
  assumed:** with the gate on and this fix in place, a request carrying `Host: 192.168.1.50:4180`
  and a forged header returns **200** on `GET /api/checkins`. The server binds `0.0.0.0`, so
  anything on the local network is still an operator. Closing that needs ADR-011 —
  bind `127.0.0.1`, verify the JWT, or both.
- It depends on the `Host` header being trustworthy. ADR-011 stays open. A Cloudflare Transform Rule stripping
  client-supplied `Cf-*` headers on `checkin.` is the matching edge-side control and is an owner
  action.
- **Requires a backend restart.** The server holds code in memory; the live host is exposed until
  it restarts.
