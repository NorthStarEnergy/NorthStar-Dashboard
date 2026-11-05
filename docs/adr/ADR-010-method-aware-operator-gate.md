# ADR-010 — The operator gate is method-aware and route-table driven

**Status:** Accepted · originally ~2026-08-01, sub-route coverage added 2026-08-11

## Context
`GET /api/checkins` returns the roster — every worker's name, company, site, notes and live GPS.
`POST /api/checkins` is a contractor checking themselves in from a public phone. Same path,
opposite trust. The Cloudflare edge path rule cannot separate them: Go's regexp has no negative
lookahead, and the worker app must be able to POST there.

## Decision
Gate on **path + method**, in the origin, via `OPERATOR_ROUTES` (exact path → gated methods) and
`OPERATOR_ROUTE_PATTERNS` (method + regex, for `/<id>/<action>` sub-routes).

## Consequences
- The gate, not the edge, is the load-bearing control on `/api/checkins`. It must never be
  disabled while `checkin.` is published.
- `OPERATOR_ROUTES` matches exact paths only. The 2026-08-11 audit found `/help/acknowledge` and
  `/help/resolve` reachable unauthenticated — anyone with a check-in id could clear a lone
  worker's distress call. `OPERATOR_ROUTE_PATTERNS` now covers them.
- **Every new `/<id>/<action>` operator route must be added to `OPERATOR_ROUTE_PATTERNS`.** The
  worker's own routes — `GET`, heartbeat, `DELETE` checkout, and `POST .../help` — must stay open.
- Any future router rewrite that loses method-awareness reintroduces a live exposure.
