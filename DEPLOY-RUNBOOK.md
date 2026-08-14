# Northstar public deployment — northstarenergy.ca

**State as of 2026-08-11 (deployed and live).**

- Tunnel `c40ae859-c686-46b8-a3af-3a67e7b81c5a` installed as the Windows service
  `Cloudflared`, remotely managed, ingress configured in the Zero Trust dashboard
  (not in `cloudflared-config.yml`, which is reference only).
- **Both hostnames are routed and serving.** `ops.northstarenergy.ca` is behind a
  Cloudflare Access policy; `checkin.northstarenergy.ca` is public with an edge
  path allowlist.
- Sections 2–4 below are the original build-out and are kept as the record of how
  it was set up. To verify the running system, go to section 5.

## 1. Starting the backend

Run `start-northstar.ps1` with no environment set. It defaults to the deployed,
safe configuration: operator gate **on**, CORS pinned to the check-in host, and
`NORTHSTAR_CHECKIN_ORIGIN` set for QR placards.

The backend also **refuses to start** if a public `NORTHSTAR_CHECKIN_ORIGIN` is
combined with the gate off — that pairing serves the operator roster on the
public hostname, and it happened in practice before the 2026-08-11 audit.

The production launcher binds the backend to `127.0.0.1` and refuses a public
check-in origin with a non-loopback bind, so the tunnel is the only network
entry point.

Confirm:

    (Invoke-RestMethod http://127.0.0.1:4180/api/health).checkinOrigin
    # -> https://checkin.northstarenergy.ca

Note the roster is unavailable at `localhost:4180` by design once the gate is on;
cloudflared connects over localhost, so local and tunnelled traffic cannot be
told apart. **Operators use `ops.northstarenergy.ca`.** For local-only work,
clear `NORTHSTAR_CHECKIN_ORIGIN` and set `NORTHSTAR_OPERATOR_GATE=off`.

## 2. Add public hostnames (Zero Trust dashboard)

Networks → Tunnels → the Northstar tunnel → Public Hostname.

**Entry 1 — the worker surface**

| Field | Value |
| --- | --- |
| Subdomain | `checkin` |
| Domain | `northstarenergy.ca` |
| Path | `^/(contractor-checkin\.html\|api/health\|api/checkins(/.*)?\|api/checkin-tokens/resolve\|api/phone-verifications(/.*)?\|manifest\.webmanifest\|sw\.js\|icons/.*\|favicon\.(ico\|png))$` |
| Service | `HTTP` → `localhost:4180` |

**Entry 2 — the operator surface**

| Field | Value |
| --- | --- |
| Subdomain | `ops` |
| Domain | `northstarenergy.ca` |
| Path | *(leave empty)* |
| Service | `HTTP` → `localhost:4180` |

No catch-all 404 rule is needed. A request matching no rule gets 404 from
cloudflared.

**Since Packet 20 (2026-08-13) this rule is no longer the only thing keeping the
operator app off the public host.** The backend enforces the same allowlist
itself (`CHECKIN_PUBLIC_ROUTES` / `CHECKIN_PUBLIC_PREFIXES` in `ieso_backend.py`),
so a tunnel reconfigured by hand — or this Path field emptied by accident —
cannot turn `checkin.` into a public mirror of the dashboard. Keep the two lists
in step: **if you add a path here, add it there, and never the other way round.**

DNS records are created automatically.

## 3. Access policy on `ops.` — do this before step 4

Access → Applications → Add a self-hosted application for
`ops.northstarenergy.ca`, policy Allow / Emails, listing each operator. One-time
PIN needs no identity provider and is free up to 50 users.

**Verify the policy works before turning the gate on.** Open
`https://ops.northstarenergy.ca` in a private window: it must challenge for
email before any dashboard content renders.

## 4. The operator gate

Now **on by default** in `start-northstar.ps1`, with a fail-closed guard in the
backend. Do not turn it off while the tunnel is routed: the edge path rule
deliberately admits `/api/checkins` (the worker app POSTs there), so the gate is
the only thing keeping the roster off the public hostname.

### 4b. Demo sign-in mode (Packet 19)

To show the console to someone who is not in the Access team, run the gate in
`demo` mode instead of `access`:

1. `python scripts/setup-demo-auth.py` — asks for the owner's temporary
   password, writes `data/.northstar-demo-auth.json` (username + salted scrypt
   verifier; never the password). Re-run with `--force` to rotate.
2. `.\start-northstar.ps1 -DemoLogin` — sets `NORTHSTAR_OPERATOR_GATE=demo`.
   The launcher refuses to start if no credential exists.
3. `https://ops.northstarenergy.ca` shows the sign-in screen; a session lasts one
   workday, and SIGN OUT in the dashboard header ends it server-side.

Everything in §4 still applies: `demo` is a third gate mode, not the gate turned
off, and the public-hostname refusal is unchanged. The Access application on
`ops.` can stay in place — Access at the edge and the demo login at the origin
are independent layers.

## 5. Verify from outside

From a phone on cellular, not the LAN:

- [ ] `https://checkin.northstarenergy.ca/contractor-checkin.html?token=…` loads
- [ ] Site name resolves; check-in succeeds; heartbeat and checkout work
- [ ] "Add to Home Screen" offers install; the icon launches standalone
- [ ] Launching from the icon (no query string) still resolves the site
- [ ] `https://checkin.northstarenergy.ca/northstar-clean.html` → **404**
- [ ] `https://checkin.northstarenergy.ca/operator-login.html` → **404**
- [ ] `https://checkin.northstarenergy.ca/module-layout.js` → **404**
- [ ] `https://checkin.northstarenergy.ca/api/weather` → **404**
- [ ] `https://checkin.northstarenergy.ca/api/checkins` → **403** (gate on) and
      never a worker roster
- [ ] `https://checkin.northstarenergy.ca/api/checkin-tokens` → **403**
- [ ] `https://checkin.northstarenergy.ca/api/health` → liveness only: `status`,
      `serverTime`, `checkinOrigin`, `database.ok` and nothing else
- [ ] After signing in on `ops.`, the browser's cookie for
      `NorthstarOperatorSession` shows **no `Domain`** (DevTools → Application →
      Cookies) and no cookie is sent on a request to `checkin.`
- [ ] `https://checkin.northstarenergy.ca/api/auth/login` → **404**, always
- [ ] `https://ops.northstarenergy.ca` → Access challenge, then the dashboard
      (or the demo sign-in screen when the gate is in `demo` mode)
- [ ] GPS consent works — geolocation needs a secure origin, so this is the
      first point at which it can be tested for real

## 6. Regenerate QR placards

`contractor-qr.html` now takes its base URL from `checkinOrigin`, so codes are
correct regardless of which host the generator was opened from. Any placard
printed before 2026-08-11 points at `localhost` and must be replaced.

## Known gaps

- **The heartbeat is not reliable on a PWA.** `setInterval(…, 300000)` in a
  browser tab is throttled or killed when the phone locks, so OVERDUE cannot be
  trusted as a safety control. Fixing it means a Capacitor wrapper with an
  Android foreground service; iOS builds need a Mac.
- **No offline queue for help requests, deliberately.** A queued NEED HELP NOW
  would show success while nothing was sent. It fails loudly instead.
- **`GET /api/checkins/<id>` is public by design** — the worker's phone has no
  credential. Anyone holding a check-in id can read that one record. Tightening
  it means a short-lived signed token issued at check-in. Confirmed still current
  2026-08-12: `ieso_backend.py`'s own comment (line 88) states this route must not
  be added to the operator gate for exactly this reason.
- **Corrected 2026-08-12 — this line was stale.** The `tests/test_phase1_port.py`
  hardcoded-date failure this used to describe is gone; that test now computes its
  reference date from `datetime.now(...)` instead of a fixed 2026-08-02 literal.
  **Baseline is `122 passed, 0 failed`** as of 2026-08-13 (87 before Packet 19's
  demo-login suite and Packet 20's hostname-separation suite), matching
  `AGENTS.md`. If you see a different count, trust a fresh
  `python -m pytest tests -q` run over this file.
- **Corrected 2026-08-12: the retired Sites static pipeline was hardened fail-closed.**
  `build.mjs` now refuses to run, `auth.js` redirects to the real operator gate, and
  `server/index.js` redirects the entire legacy surface. The current Vinext Sites
  package does not include that pipeline; both live entrypoints and the retired asset
  paths were checked. The primary Cloudflare Tunnel deployment remains the operational
  dashboard path.
- **The QR-signing secret (`data/.northstar-qr-secret`) is not included in the
  automated daily backup.** See `RECOVERY-RUNBOOK.md` §1 for what that means and
  the recovery procedure if it's lost.
