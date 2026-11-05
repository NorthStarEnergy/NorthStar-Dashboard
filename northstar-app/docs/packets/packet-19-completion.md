# Packet 19 — Demo Operator Authentication: completion report

**Date:** 2026-08-13 · **Scope:** replace the retired fake client-side login with a small,
server-enforced demo login for the operator dashboard.

One item is left for the owner and it cannot be done for you: **run
`python scripts/setup-demo-auth.py` on the dashboard PC** and enter the temporary password. Nothing
else in this packet is outstanding. The password was deliberately never handled by this session, so
no credential exists on this machine yet — until that script runs, `-DemoLogin` refuses to start.

## What was built

| Packet requirement | Where it lives |
|---|---|
| 1. Local runtime credential, one-way verifier, blank password refused | `northstar_auth.py` (scrypt, per-install salt), `scripts/setup-demo-auth.py`, `data/.northstar-demo-auth.json` |
| 2. Demo mode enabled explicitly; username `ron`; no password in HTML/JS/Git/Drive/logs | `NORTHSTAR_OPERATOR_GATE=demo`, credential file only; asserted by `test_no_password_value_exists_in_html_javascript_or_source` |
| 3. Login endpoint only on the operator hostname | `Handler._demo_auth_available` — 404 on `checkin.` for login, logout and session |
| 4. Random server-validated session; `HttpOnly; Secure; SameSite=Lax`, host-only, one workday | `auth.SessionStore` + `auth.set_cookie_value` (no `Domain`, `Max-Age` 9h) |
| 5. Logout invalidates the server session and clears the cookie | `Handler._demo_logout` — destroys first, then clears |
| 6. Failed-login throttling | `auth.LoginThrottle` — 5 failures / 15 min sliding window per caller, cleared by a success, logged once when it trips |
| 7. Boot sequence checks the session before loading operator data | `operator-session.js` (first script in `northstar-clean.html`) + server-side substitution of `operator-login.html` for a signed-out console request |
| 8. Every operator API authorised server-side | `_operator_gate_denial` over the existing `OPERATOR_ROUTES` / `OPERATOR_ROUTE_PATTERNS` — no second list |
| 9. Mutating requests enforce the same-origin host check | `_cross_origin_write`, applied to POST/DELETE/PUT/PATCH on operator routes and to sign-in |
| 10. `ron` as the demo audit actor, not a claimed identity | `_audit_actor` overrides any client-supplied `actor`/`source` in demo mode |

Implementation notes from the packet, all honoured: standard-library backend unchanged; existing
route classification reused; `demo` added as a distinct gate mode rather than setting the operator
gate to `off`; the public-host refusal still 403s an operator route arriving on `checkin.`
regardless of headers or cookies; `auth.js`, the old static login and the retired Sites pipeline
were not restored.

## Verification

`python -m pytest tests -q` → **122 passed, 0 failed** (87 was the pre-Packet-19 baseline; this run
also includes the concurrent Packet 20 hostname-separation suite).

`tests/test_demo_auth.py` (23 tests) covers every line of the packet's required-tests list:
correct credentials create a session · wrong username, wrong password and blank password fail ·
missing, malformed, expired and logged-out sessions get 401/403 from operator APIs · a valid session
loads Weather, the Field Tracker and Field Staff Status · the cookie is host-only and a copied
session is still refused on the check-in hostname · the login endpoint is absent there · throttling
engages and resets after the window · existing regression tests stay green.

Also exercised live against a real backend process on port 4199 (demo mode, public check-in origin
configured): sign-in, roster/weather/logbook/outages/voice reads, cross-origin write refused 403,
cookie replay on `checkin.` refused 403, logout then replay refused 401, lockout after five wrong
passwords, public health trimmed to liveness only, and no password value in the process log or the
database.

## What this is not

A demo door, not identity management. It does not verify the Cloudflare Access JWT (ADR-011 remains
open), does not provide per-person accounts or roles, and does not unblock Stage 3 of
`MIGRATION_SEQUENCE.md`. Sessions are in-process, so restarting the backend signs the operator out.
See `docs/adr/ADR-023-demo-operator-authentication.md`.
