# 2026-08-14 — public origin down 5h after an unclean shutdown

**Impact:** `checkin.northstarenergy.ca` (the worker QR check-in surface) and
`ops.northstarenergy.ca` both returned `502` for **5 hours 8 minutes**. Field workers could not
check in, request help, or check out. Nothing alerted.

## Timeline (America/New_York)

| Time | Event |
|---|---|
| 2026-08-13 20:40:09 | Last HTTP request served. Backend healthy. |
| 2026-08-14 01:31:01 | Last write to `data/northstar.db`. |
| 2026-08-14 01:31:55 | **Unclean shutdown.** System event 6008; Kernel-Power event 41 logged on the next boot. |
| 2026-08-14 01:34:50 | Machine reboots. `cloudflared` restarts automatically — it is a Windows service. |
| 2026-08-14 01:34:50 – 06:42 | Tunnel up, origin dead. Both hostnames `502`. |
| 2026-08-14 06:42 | Outage found during unrelated work: `:4180` not listening, no Python process, `Cloudflared` service Running. |
| 2026-08-14 06:53 | `start-northstar.ps1 -DemoLogin -NoBrowser`. Service restored. |

## Cause

Asymmetric restart behaviour. `cloudflared` is registered as a Windows service and survives a
reboot. The backend is started by hand from `start-northstar.ps1` and does not. The tunnel
therefore continued advertising a healthy public endpoint in front of an origin that no longer
existed.

The crash itself was not caused by the application — no traceback precedes it. The only errors at
the tail of the log are `ConnectionAbortedError` entries, which are ordinary client disconnects.
Power loss or a host hang is the likely cause; that is worth watching but is not an application
defect.

Nothing detected the outage. There is no check that the public hostnames are answering, and a
`localhost` check would have passed for the entire five hours if the backend had been up but the
tunnel down — the inverse failure has the same blind spot.

## Verification after recovery

    127.0.0.1:4180/api/health                      200
    checkin.northstarenergy.ca/api/health          200
    checkin…/contractor-checkin.html               200
    ops.northstarenergy.ca/                        200
    northstar-clean.html on checkin.               404   <- Packet 20 invariant, confirmed live

The restart also put Packets 20 and 21 into production for the first time, on the owner's explicit
decision. Suite was `127 passed, 0 failed` beforehand. Packet 20 is strictly more restrictive on
the public hostname than the code it replaced, and the 404 above is that containment confirmed
against the live system rather than only in tests.

## Follow-up

- **Done** — scheduled task `NorthStar Control Room backend`, at logon, 60s delay.
- **Open, needs an elevated shell** — move the trigger to at-startup so a reboot that stops at the
  lock screen still recovers. Command is in `AGENTS.md`, "Running and verifying".
- **Open, owner decision** — nothing watches the public hostnames. Five hours passed with no
  signal. An external check against `checkin.northstarenergy.ca/api/health` would have caught this
  in minutes; a local one would not have caught it at all.
- **Open** — `packet-22-acceptance-evidence.md` still lists logout, session expiry and a live
  worker check-in as NOT VERIFIED. Those items remain unverified against the now-released code.

Evidence log preserved at `data/northstar-backend.err.outage-20260814.log` (gitignored;
`start-northstar.ps1` truncates the live log on start).
