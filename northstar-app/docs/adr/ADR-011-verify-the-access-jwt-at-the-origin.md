# ADR-011 — Verify the Access JWT at the origin

**Status:** Superseded for the current deployment by `ADR-022`; JWT verification remains required
if the origin ever binds beyond loopback.
**Relates to:** ADR-009, ADR-012

## Context
`_operator_gate_blocks()` checks that `Cf-Access-Jwt-Assertion` is present. It never decodes or
verifies the token against the Access team's signing keys. A 2026-08-11 probe confirmed Cloudflare
does **not** strip a client-supplied copy of that header, so presence proved nothing. ADR-012 is
the immediate mitigation; it is not the complete answer, and it does not help on the LAN, where
the listener binds `0.0.0.0` and anything can set the header.

## Options
1. **Probe and bind to `127.0.0.1`.** cloudflared connects to localhost, so the tunnel is
   unaffected and the LAN path disappears. Needs confirmation that nothing uses `:4180` on the LAN.
2. **Verify the JWT** — signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`,
   plus `aud` (the Access application tag), `iss` and expiry. The correct answer.
3. Accept, documented, with a review date.

## Open questions
- Option 2 needs RS256 verification. `cryptography` is present in the current interpreter but the
  project ships with `tzdata` as its only dependency and `AGENTS.md` forbids adding vendor SDKs.
  Adding a dependency here may be defensible — but it must be its own explicit decision, and it
  must be verified against the interpreter that actually runs in production.
- The Access application AUD tag is not recorded anywhere in this repository.
