# NorthStar Control Room — agent brief

Read this before changing anything. It is short on purpose.

## Where to work

**This directory is canonical:**

    C:\Users\Ryan1\Documents\Work Projects\control-room-dashboard

Do not work in, or copy code back from, any of these:

- `control-room-dashboard/` (nested) — an abandoned Next/Vinext/Drizzle starter. Not the runtime.
- `tmp/`, `output/`, `dist/`, `handoff/*/source/` — frozen snapshots and ZIP staging. Read-only history.
- Anything extracted from a handoff ZIP. Those were point-in-time copies; several are now months stale.

The runtime is a Python standard-library HTTP server with SQLite and static HTML/JS:

- `ieso_backend.py` — HTTP routes, the operator gate, background feed loops
- `northstar_store.py` — SQLite schema and operational workflows
- `northstar_phase1.py` — signed QR tokens, phone verification, location retention, SCADA
- `northstar-clean.html` — operator dashboard (v0.6)
- `contractor-checkin.html` — the worker-facing PWA
- `tests/` — regression suite

## This is live on the internet

Since 2026-08-11 it is published through a Cloudflare tunnel on **northstarenergy.ca**:

- `checkin.northstarenergy.ca` — **public, no login.** Contractors scan a QR placard and land here.
- `ops.northstarenergy.ca` — the dashboard, behind Cloudflare Access.

Both reach `localhost:4180`. A change that widens the public surface is a live data exposure, not a
staging bug. See `DEPLOY-RUNBOOK.md` for the full topology, and treat these as hard invariants:

1. **The operator gate is load-bearing.** `NORTHSTAR_OPERATOR_GATE=access` makes the roster, QR
   tokens and logbook require the `Cf-Access-Jwt-Assertion` header Cloudflare Access injects. The
   edge path rule *cannot* cover `/api/checkins`, because the worker app POSTs there — so the gate
   is the only thing keeping the roster off the public hostname. Never disable it while
   `checkin.` is published. Note this also means `localhost:4180` cannot show the roster;
   operators must use `ops.`.

   **That header alone never proved anything.** A 2026-08-11 probe sent
   `Cf-Access-Jwt-Assertion: forged` from the open internet to
   `checkin.northstarenergy.ca/api/checkins` and got HTTP 200 with the full roster — Cloudflare
   passes a client-supplied copy of the header straight through to the origin. The gate now also
   refuses operator routes whenever the request arrived on the public check-in hostname
   (`Host` vs `NORTHSTAR_CHECKIN_ORIGIN`), whatever headers it carries. Do not remove that check.

   The write path was worse than the read: the edge rule admits `api/checkins(/.*)?`, so a forged
   header also returned 200 on `POST /api/checkins/<id>/help/resolve` — clearing a lone worker's
   distress call, unauthenticated, from the internet. Two tests cover this and both fail
   `200 != 403` if the check is removed:
   `test_forged_access_header_cannot_open_the_roster_on_the_public_host` and
   `test_forged_access_header_cannot_clear_a_distress_call`.

   **The production launcher binds `127.0.0.1`, so the LAN bypass is closed.** The JWT is still
   not cryptographically verified; do not reintroduce a non-loopback bind without completing
   that verification. See `docs/adr/ADR-011`.

2. **`GET /api/checkins` is the roster, `POST /api/checkins` is a worker checking in.** Same path,
   opposite trust. `OPERATOR_ROUTES` in `ieso_backend.py` is method-aware. Keep it that way.

   `OPERATOR_ROUTES` matches **exact paths only**, so `/api/<thing>/<id>/<action>` sub-routes need
   an entry in `OPERATOR_ROUTE_PATTERNS`. The 2026-08-11 audit found that gap live: anyone on the
   internet holding a check-in id could `POST .../help/acknowledge` and `.../help/resolve`, i.e.
   clear a lone worker's distress call from the control room. Any new `/<id>/<action>` route that
   is an operator action must be added there. The worker's own routes — `GET /api/checkins/<id>`,
   heartbeat, `DELETE` checkout, and `POST .../help` (raising the alarm) — must stay open.

 2b. **The web root is the project directory and the server binds loopback in production.** Before 2026-08-11 that
   served `data/northstar.db`, `data/.northstar-qr-secret`, backups, logs and all source to anyone;
   on the LAN with no authentication. The production loopback bind now keeps the LAN outside
   the Cloudflare Access path. `_static_forbidden` allows only web-asset suffixes, blocks `STATIC_DENY_DIRS` and
   dotfiles, and `list_directory` returns 404. Do not widen those lists to "fix" a 404; move the
   asset instead.

3. **QR links must come from `checkinOrigin`, never `location.origin`.** Placards are printed once
   and mounted at remote gates. `contractor-qr.html` is opened on `ops.`, so deriving the link from
   the current origin points every printed code at the Access login wall.

4. **The service worker must never intercept `/api/`.** A queued NEED HELP NOW would show success
   while nothing was sent. Safety calls fail loudly and tell the worker to phone the control room.
   Offline check-*in* could be queued safely; offline help cannot.

5. **Do not add background-heartbeat features that imply reliability.** The heartbeat is a browser
   `setInterval` and dies when the phone locks. The owner decided on 2026-08-11 that OVERDUE is
   advisory and a native wrapper is out of scope. Do not re-propose Capacitor.

Also preserve, from the earlier Phase 1 port: QR verification, provisional check-ins,
phone-verification shadow mode, location-event retention, site escalation policies, SCADA import
validation, and audit behaviour.

## Current dashboard UI work

- The live operator UI is `northstar-clean.html`; do not edit frozen handoff copies.
- `mobile-dashboard.js` powers the Mobile tab and worker GPS/history display.
- `switching-workspace.js` and `switching-workspace.css` power the UWPC/EUSR diagram/rules intake, source-derived draft form, qualified-person review checklist, print/export, and audit state in the Switching tab. Draft metadata and status transitions synchronize to the operator-gated `/api/switching/drafts` records; source-file bytes remain local to the browser until an approved retention/access design exists. The durable states are DRAFT, READY FOR QUALIFIED REVIEW, and REVIEW RECORDED - NOT RELEASE. It must not become an equipment-command or operational-release surface.
- `module-layout.js` is the **single** layout system. A zone is a container whose child modules the
  operator reorders and resizes inside that section while EDIT LAYOUT is active. Modules reflow and
  never overlap; sizes snap to a per-zone step. Zones today: `#staffGroups`, `#nodeCards`,
  `#weatherGridFull` (Weather tab) and `#weatherStrip` (header strip). **Adding a zone is one entry
  in the `ZONES` array — do not write a second bespoke layout script.**
- The two weather zones render the *same* station cards from one array, so they carry separate zone
  ids on purpose: reordering the header strip must not reorder the Weather tab. Keep them distinct.
- Modules need a stable identity or their saved size follows the slot instead of the card:
  `data-module-id` (or `data-site` on staff groups). Add it in the render template when you add a
  card type.
- `staff-layout.js` is a **superseded stub**. It made Field Staff cards free-floating via
  `transform: translate()`, which let a card be dragged out of its section entirely. Do not revive it.
- `#weatherStrip` pins card width with `flex:0 0 88px!important; width:88px!important`. Resizing
  works because inline `!important` outranks an author stylesheet's `!important` — which is why
  `setSize` uses `style.setProperty(..., 'important')`. Do not "simplify" it to plain assignments.
- `northstar_voice.py` + `voice-workspace.js/.css` power the Voice tab: audio-file intake, transcription,
  and operational/non-operational triage. Three rules are load-bearing and covered by
  `tests/test_voice_workflows.py`:
  1. **Nothing is invented.** With `NORTHSTAR_VOICE_ENGINE=none` (the default) audio is ingested,
     hashed, deduped and logged, and stays at "Awaiting transcription". Never emit placeholder
     transcript text — a fabricated line could later be read as something a person said.
  2. **Triage may demote chatter; it may never suppress a safety signal.** `SAFETY_TERMS` pins a
     segment operational and sets `safety_hold`, and the server *refuses* an operator request to
     filter such a segment. Widen that list freely; never narrow it for precision.
  3. **Filtered is not deleted.** Non-operational segments stay queryable and reversible, and every
     override is an append-only `voice_events` row. Retention purges the audio bytes only.
- Transcription is engine-agnostic: `NORTHSTAR_VOICE_ENGINE=command` plus `NORTHSTAR_VOICE_COMMAND`
  with `{file}`. Do not add a vendor SDK — the project ships with `tzdata` as its only dependency.
- The local preview is `http://localhost:4180/northstar-clean.html`; restart after edits because the server holds code in memory.

## Running and verifying

    .\start-northstar.ps1          # sets env vars, starts on :4180, waits for health
    python -m pytest tests -q

**Baseline is `86 passed, 0 failed`** as of 2026-08-12. The old `test_phase1_port.py:150` date bomb
is fixed; a red suite is now a real regression, not a known quirk. Four of those tests are
security regressions covering live, publicly reachable failures — if any goes red, stop and fix it
before anything else:

- `test_operator_gate_covers_help_subroutes_but_not_the_workers_alarm`
- `test_static_tree_does_not_serve_secrets_or_the_database`
- `test_forged_access_header_cannot_open_the_roster_on_the_public_host`
- `test_forged_access_header_cannot_clear_a_distress_call`

Restarting matters: the server holds code in memory, so edits do nothing until you restart it.
Check with `(Invoke-RestMethod http://127.0.0.1:4180/api/health).checkinOrigin`.

Sites release builds must run from a clean committed checkout. `scripts/prepare-sites.mjs` writes
`dist/.openai/release.json` with the source commit and backend hash, and rejects a dirty tree or a
`NORTHSTAR_RELEASE_SHA` that does not match `HEAD`.

## Windows traps that have already cost time

- PowerShell 5.1 `-Encoding utf8` writes a **BOM**, which breaks `json.loads` on POST bodies. Use
  `[System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))`.
- `-SkipHttpErrorCheck` and `-MaximumRedirection 0` misbehave in 5.1. Use `System.Net.Http.HttpClient`.
- After a DNS change, the local resolver caches NXDOMAIN long after Cloudflare serves the record.
  Test with `curl.exe --resolve host:443:172.64.80.1` rather than concluding the route is broken.
- `cloudflared service install` and `Stop-Service Cloudflared` need an elevated shell.

## Architecture records

`docs/architecture/` holds the Packet 00 alignment (2026-08-11): current-state inventory, gap
analysis, target architecture, migration sequence, and the decision log. `docs/adr/` holds one
file per architecture decision. Read `docs/architecture/MIGRATION_SEQUENCE.md` before starting
structural work — it says what order things must happen in and what is blocked on an owner
decision.

**Where they disagree with this file, this file wins** and the document is wrong. Fix the document.

## Never commit

Secrets, live databases, generated operational records, `.northstar-qr-secret`, cloudflared
credentials or tunnel tokens, and real payer or worker PII in fixtures.
