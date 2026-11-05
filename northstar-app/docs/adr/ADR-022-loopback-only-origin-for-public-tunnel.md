# ADR-022 — Loopback-only origin for the public tunnel

**Status:** Accepted — Packet 17, 2026-08-12

## Context

The worker check-in hostname and the protected operator hostname terminate at the same Python
listener. The public check-in surface must remain reachable without login, while operator roster
and action routes must remain behind Cloudflare Access. Header presence is not proof of Access
authentication because a client can supply a forged `Cf-Access-Jwt-Assertion` on the public path.

The earlier listener bound `0.0.0.0`, which left a direct LAN path around the Cloudflare Access
edge. The origin does not yet verify Access JWT signatures, issuer, audience, or expiry.

## Decision

Production binds the Python service to `127.0.0.1` through `start-northstar.ps1`. The backend
defaults to loopback and refuses to start when a public HTTPS check-in origin is configured with a
non-loopback `NORTHSTAR_BIND_HOST`. Cloudflared therefore remains the only network entry point.

The method-aware operator route table, public-host rejection, and worker routes remain unchanged:
`GET /api/checkins` is operator roster access, while `POST /api/checkins` is the worker check-in
path. A forged header on the public host cannot open the roster or operator help actions.

## Consequences

- A LAN caller cannot reach the origin directly or turn a forged header into operator access.
- The public worker page, health endpoint, check-in POST, heartbeat, help request, and checkout
  continue to use the tunnel.
- Local operators use `ops.northstarenergy.ca`; with the production gate on, localhost cannot be
  distinguished from tunnel traffic and is intentionally not an operator console.
- JWT verification is still required before any future design binds the service beyond loopback.

## Verification

Packet 17 verified the startup refusal for a public origin plus a non-loopback bind, restarted the
production launcher, and observed a `127.0.0.1:4180` listener. The Python suite remained green at
86 tests. External smoke evidence is recorded with the Packet 17 release artifacts.
