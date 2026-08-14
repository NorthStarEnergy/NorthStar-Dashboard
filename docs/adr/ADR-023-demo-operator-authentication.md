# ADR-023 — Demo operator authentication

**Status:** Accepted — Packet 19, 2026-08-13

## Context

The operator console is published on `ops.northstarenergy.ca` behind Cloudflare Access. The origin
does not verify the Access JWT (ADR-011, still open, blocked on decision D-3), so the only
origin-side protections are the operator route table and the public-hostname refusal (ADR-022).
There is no login the origin itself owns.

The retired static Sites pipeline shipped a fake client-side `operator`/`operator` login that any
reader of the page source could bypass. Packet 18 retired it (`auth.js` now redirects to the real
gate) and it must not come back in any form.

The owner needs to demonstrate the console to people who are not in the Cloudflare Access team,
without opening the operator surface to the internet and without inventing an identity system that
Stage 3 of `MIGRATION_SEQUENCE.md` has not decided yet.

## Decision

A third operator gate mode, `demo`, alongside `off` and `access`. `NORTHSTAR_OPERATOR_GATE=demo`
requires a server-side session on every operator route; it never means the gate is off.

- **One credential, configured locally.** `data/.northstar-demo-auth.json` holds a username and a
  salted scrypt verifier — never a password. It is written by `scripts/setup-demo-auth.py`, which
  refuses a blank password. `data/` is gitignored, denied by the static server, and the file is a
  dotfile, so `_static_forbidden` refuses it twice over. The pre-Packet-19
  `NORTHSTAR_DEMO_PASSWORD_HASH` environment variable is still accepted as a fallback.
- **Sessions live on the server.** `POST /api/auth/login` on the operator hostname mints a
  `secrets.token_urlsafe(32)` token held in memory with an expiry; the cookie carries nothing else.
  `HttpOnly; Secure; SameSite=Lax`, no `Domain` attribute (host-only), `Max-Age` one workday.
  `POST /api/auth/logout` destroys the server-side session before clearing the cookie.
- **The login surface does not exist on the check-in hostname.** `/api/auth/login`, `/api/auth/logout`
  and `/api/auth/session` return 404 there. The pre-existing public-host refusal is unchanged, so a
  genuine session cookie replayed against `checkin.` is still refused 403.
- **Authorization is server-side on the existing route classification.** `OPERATOR_ROUTES` and
  `OPERATOR_ROUTE_PATTERNS` are reused, not duplicated. Mutating operator requests additionally
  refuse a cross-origin `Origin` header rather than relying on `SameSite` alone.
- **Failed logins are throttled** per caller address: five failures in fifteen minutes, sliding
  window, cleared by a success. The lockout is recorded in the logbook once, not once per guess.
- **The demo user is a demo user.** In demo mode the audit actor is the configured username (`ron`),
  chosen by the server and never taken from the request body. No employee name or email is implied.
- **The dashboard checks before it loads.** `operator-session.js` asks `/api/auth/session` before any
  operator fetch and sends a signed-out or expired browser to `/operator-login.html`; the backend
  also serves the login page in place of the console for a signed-out request.

## Consequences

- `localhost:4180` cannot sign in on the production host, for the same reason it cannot show the
  roster today: the loopback address is indistinguishable from cloudflared's connection. Local work
  uses `.\start-northstar.ps1 -DemoLogin -LocalOnly`, which clears the public check-in origin.
- Sessions are in-process. Restarting the backend signs the operator out. For a single-operator
  demo that is the correct trade; a persisted session table would be a second store to protect.
- This is a demo door, not identity management. It does not replace Access, it does not verify the
  Access JWT, and it does not satisfy Stage 3. Per-person accounts, roles, and revocation remain
  blocked on D-3.
- The backend refuses to start in `demo` mode with no credential configured, so the failure mode is
  a loud exit rather than a console that looks healthy and admits no one.

## Verification

`tests/test_demo_auth.py` — correct credentials create a session; wrong username, wrong password and
blank password fail; missing, malformed, expired and logged-out sessions are refused; a valid
session loads Weather, the Field Tracker and Field Staff Status; the cookie is host-only; the login
endpoint is absent on the check-in hostname; throttling engages and resets; audit records name
`ron`; no password value appears in any HTML, JavaScript or source file.
