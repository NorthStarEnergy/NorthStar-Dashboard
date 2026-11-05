# ADR-009 — Authentication is delegated to Cloudflare Access at the edge

**Status:** Accepted (retroactive record of an existing choice) · 2026-08-11
**Relates to:** ADR-005 (open, identity provider), ADR-010, ADR-011, ADR-012

## Context
NorthStar has no user table, session, password, or login page. The operator surface is protected
by Cloudflare Access on `ops.northstarenergy.ca`; the origin trusts the `Cf-Access-Jwt-Assertion`
header Access injects, and attributes audit records from `Cf-Access-Authenticated-User-Email`.

## Decision
Keep identity at the edge for now. Do not build local authentication.

## Consequences
- No credential storage, reset flow, or session lifecycle to get wrong. For a one-maintainer
  project this is a large and real saving.
- Authorization is a single bit: operator or not. Least privilege (Packet 04) cannot be expressed —
  see ADR-015 and `GAP_ANALYSIS.md` G-11.
- The origin's trust in the header was **presence-only**, which proved exploitable — see ADR-012.
- If operators are locked out of Access there is no working dashboard at all, because the operator
  gate also closes `localhost:4180`. The fix is the Access policy, never disabling the gate.
- ADR-005 (company IdP vs Cloudflare Access) stays open and should be answered before Packet 02.
