# Packet 20 — Hostname Separation and Worker Safety: completion report

**Date:** 2026-08-13
**Repository:** `C:\Users\Ryan1\Documents\Work Projects\control-room-dashboard` (canonical)
**Suite:** `122 passed, 0 failed` (`python -m pytest tests -q`), from `87 passed` before Packets 19–20.

## What the packet asked for, and what was actually missing

Packet 19 had already put a real, server-enforced sign-in on the operator dashboard, host-bound to
`ops.` with a host-only cookie, and it already refused operator routes on the public check-in
hostname. Six of this packet's seven requirements were satisfied by that work; each is listed below
with the evidence rather than assumed.

**Requirement 2 was not met, and the gap was not small.** The operator *gate* answers one question:
"is this an operator route, and is the caller authenticated?" Everything that is not an operator
route is therefore public by construction — and on the shared listener that included the entire
operator application: `northstar-clean.html`, `module-layout.js`, `lamination-dashboard.css`, every
other script the console loads, `operator-login.html`, `contractor-qr.html`, `/api/weather`,
`/api/market-prices`, `/api/auth/session`. None of those are gated, because on `ops.` they do not
need to be. On `checkin.northstarenergy.ca` they were being served to anyone who asked the origin
for them.

The only thing standing between those files and the internet was the Cloudflare ingress path regex —
which is not read at runtime (`cloudflared-config.yml` is reference only; the tunnel is remotely
managed), cannot be asserted on by any test in this repository, and is editable in a browser by
anyone with Zero Trust access. That is a single point of failure holding a live public surface.

## Changes

### `ieso_backend.py`

- **`CHECKIN_PUBLIC_ROUTES` / `CHECKIN_PUBLIC_PREFIXES`** — the worker surface, mirrored from the
  Cloudflare path regex: `contractor-checkin.html`, `manifest.webmanifest`, `sw.js`, `favicon.*`,
  `icons/*`, `/api/health`, `/api/checkins` and its `/<id>/…` routes, `/api/checkin-tokens/resolve`,
  `/api/phone-verifications…`.
- **`_checkin_host_forbidden()`** — anything else arriving on the public check-in hostname gets 404.
  The path is `posixpath.normpath`-ed after unquoting first, so an admitted prefix cannot be walked
  out of: `/icons/%2e%2e/northstar-clean.html` resolves to the console and is refused. (Without that,
  the static handler would have collapsed the `..` itself and served the file.)
- **`_refused_before_dispatch()`** — runs both hostname rules before any handler sees the request,
  wired into `do_GET`, `do_POST`, `do_DELETE` and `do_OPTIONS`. **Order is deliberate:** the operator
  gate runs first, so an operator route on the public hostname still answers **403** — the shape the
  packet's verification matrix specifies and the two 2026-08-11 forged-header regression tests
  assert — and everything else answers 404.
- **`/api/health` on the public hostname is now reduced unconditionally.** It was trimmed per gate
  mode (`access` without the edge header, `demo` without a session). It is now trimmed whenever the
  request arrived on the check-in hostname, in any mode: no caller there is ever entitled to more
  than "the server is up". This is the packet's last matrix row.

### `tests/test_packet20_hostname_separation.py` (new, 12 tests)

Each test names the clause or matrix row it covers. Two of them are the security regressions for
this packet — they cover surface that no gate ever looked at:

- `test_the_operator_console_is_not_served_on_the_check_in_hostname`
- `test_non_operator_apis_are_not_published_on_the_check_in_hostname`
- `test_operator_routes_are_refused_on_the_check_in_hostname` — 403 (not 404), and not to a copied
  session cookie, a forged `Cf-Access-Jwt-Assertion`, or both together
- `test_an_admitted_prefix_cannot_be_walked_out_of`
- `test_the_allowlist_covers_every_asset_the_worker_app_caches` — parses the real `SHELL` array out
  of `sw.js` and asserts each entry is served. If someone adds a file to the PWA's precache and not
  to the allowlist, the worker page breaks *in the field*, not at a desk: the phone caches a 404 and
  a contractor at a remote gate cannot check in. This test makes that a red suite instead.
- `test_the_operator_hostname_and_local_development_are_unaffected` — containment must not reach
  `ops.` or a developer on loopback
- plus the health, end-to-end worker flow, cookie, and §6/§7 guard tests

Every containment test runs in **both** deployed gate modes (`access` and `demo`). Containment is not
allowed to be a property of whichever mode happens to be running.

### Documentation

- `AGENTS.md` — new invariants **1b** (the check-in hostname carries the worker app and nothing else;
  the gate-then-containment ordering; adding to the allowlist publishes to the internet) and **1c**
  (the session cookie is host-only, never give it a `Domain`). Packet 20's regressions added to the
  named stop-and-fix list.
- `DEPLOY-RUNBOOK.md` — §2 now states that the edge rule is no longer the only thing holding the
  boundary, and that the regex and the two Python lists must be changed together. §5's external
  verification list gained the console/asset/feed 404 rows, the liveness-only health row, and a
  browser check that no `Domain` is set on the session cookie.
- `cloudflared-config.yml` — the header comment explains why the origin now mirrors the edge rule.

## Completion evidence

Status codes captured from a real server (the actual `Handler`, loopback port, scratch database and
scratch credential — no production data, config or credential was read or written). No password
value appears below or anywhere in the run.

| Request | Result |
|---|---|
| `GET /` on `ops`, no session | **200**, HTML `NorthStar Operator Sign In` (the login page) |
| `POST /api/auth/login` on `ops`, correct credentials | **200** `{"authenticated":true,"username":"ron","expiresIn":32400}` |
| `GET /api/weather` on `ops` with session | **200**, weather payload |
| `POST /api/checkins` on `checkin`, no login | **201**, check-in created |
| `GET /api/checkins` on `ops` with session | **200**, roster (1 record) |
| `GET /api/checkins` on `checkin`, no authorization | **403** `operator authentication required` |
| `GET /api/checkins` on `checkin`, forged Access header | **403** |
| `GET /api/checkins` on `checkin`, **genuine session cookie copied off `ops`** | **403** |
| `POST /api/checkins/<id>/heartbeat` on `checkin` | **200** |
| `POST /api/checkins/<id>/help` on `checkin` (worker raises the alarm) | **200** |
| `POST /api/checkins/<id>/help/resolve` on `checkin`, forged header | **403** (alarm still standing) |
| `POST /api/logbook` on `checkin`, copied session + forged header | **403** |
| `GET /api/health` on `checkin` | **200**, liveness only: `status`, `serverTime`, `checkinOrigin`, `database.ok` |
| `GET /api/health` on `ops` with session | **200**, full diagnostics |
| `GET /northstar-clean.html` on `checkin` | **404** |
| `GET /operator-login.html` on `checkin` | **404** |
| `GET /module-layout.js` on `checkin` | **404** |
| `GET /api/auth/session` on `checkin` | **404** |
| `GET /icons/%2e%2e/northstar-clean.html` on `checkin` | **404** |
| `GET /contractor-checkin.html` on `checkin` | **200**, the worker PWA |
| `GET /manifest.webmanifest`, `/sw.js`, `/icons/northstar-192.png` on `checkin` | **200** |
| `DELETE /api/checkins/<id>` on `checkin` (worker checks out) | **200** |

**Cookie (§4).** `NorthstarOperatorSession=<32-byte random>; Path=/; Max-Age=32400; HttpOnly; Secure;
SameSite=Lax` — **no `Domain` attribute**, so the browser scopes it to `ops.` and never sends it to
the check-in hostname. Asserted in both suites; the server also refuses a copied session on that
hostname, so the browser's behaviour is not the only lock.

**End-to-end (final matrix row).** One test check-in was created on the public hostname with no
login, was **not** visible to any request on that hostname, and *was* visible from `ops.` after
signing in — `end-to-end check-in visible from ops after sign-in: True` — after which the operator
resolved the alarm (200) and the worker's own phone checked out (200).

**Startup guards (§6, §7), each triggered for real:**

- `NORTHSTAR_OPERATOR_GATE=off` + public check-in origin → *"Refusing to start… That serves the
  operator roster on the public check-in hostname."*
- `NORTHSTAR_OPERATOR_GATE=demo` with no credential → *"Refusing to start… no demo credential is
  configured."*
- public check-in origin + `NORTHSTAR_BIND_HOST=0.0.0.0` → *"Refusing to start: a public
  NORTHSTAR_CHECKIN_ORIGIN requires a loopback bind."*

`NORTHSTAR_CHECKIN_ORIGIN=https://checkin.northstarenergy.ca` and the `127.0.0.1` bind in
`start-northstar.ps1` are unchanged (§7), and asserted by
`test_the_check_in_origin_and_loopback_bind_requirements_are_intact`.

**Regression suite.** `122 passed, 0 failed`, including the four 2026-08-11 security regressions and
Packet 19's two containment tests. No existing test was weakened or deleted to make this pass.

## What was not done, and why

- **Nothing was changed at the Cloudflare edge.** The tunnel is remotely managed from the Zero Trust
  dashboard; this process cannot read or write that configuration, and changing a live public
  routing rule is an owner action, not an agent one. Requirement 1 (the `checkin.` route stays
  public, with no Access policy in front of it) is therefore *unchanged and untouched* rather than
  re-verified — the origin-side work above assumes it and does not depend on it.
- **No live probe of `northstarenergy.ca`.** Every status code above came from the real handler on
  loopback. The 2026-08-11-style external probe from outside the network is §5 of
  `DEPLOY-RUNBOOK.md` and needs a phone on cellular; the checklist there has been extended with the
  new 404 rows so that pass covers this packet.
- **The running production backend on `:4180` was not restarted.** It holds code in memory, so it is
  still serving the pre-Packet-20 build. **These changes are not live until someone restarts it**
  (`.\start-northstar.ps1`, or with `-DemoLogin` for the Packet 19 sign-in).

## One thing worth knowing

`start-northstar.ps1` only *defaults* the gate to `access`; an inherited
`NORTHSTAR_OPERATOR_GATE=off` in the shell environment still passes through. That is safe today
because the backend refuses to start in that combination with a public check-in origin — the
failure is loud and closed, not quiet and open — but the launcher itself does not override it. Left
as-is deliberately: overriding an explicitly-set environment variable would break the documented
local-development path, and the backend guard is the stronger place for the rule.
