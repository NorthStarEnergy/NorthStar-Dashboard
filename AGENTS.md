# NorthStar Control Room — agent brief

Read this before changing anything. It is short on purpose.

## Required dashboard change coordination

For every dashboard change task, read `docs/CHANGE-COORDINATION.md` before editing. In the canonical workstation also read `.cursor/rules/northstar-change-coordination.mdc` and `C:\Users\Ryan1\.cursor\agents\northstar-change-coordinator.md` when available. Follow the repository procedure directly when custom-agent invocation is unavailable. Read-only questions need no queue or lock.

Only one coordinator may integrate into the canonical checkout. Workers use isolated Git worktrees and submit uniquely named packets; they never edit the canonical queue, handoff, or runtime files. All coordination paths and the integration lock resolve against the absolute canonical project root, even from worktrees. Acquire the lock before changing the shared queue or handoff as well as before integration. Never start a competing coordinator when the lock is held.

Treat existing dirty changes as protected work. Worktrees start from committed history and do not automatically include those changes: record the base SHA and missing dependencies, and reconcile against current canonical contents before applying. Never clean, reset, restore, or commit unrelated edits to meet a clean-tree requirement. Only the lock owner writes the shared queue and canonical handoff. Release only your own lock. These rules coordinate participating agents; they do not enforce access control over other running chats.

## Where to work

Events uses `events-register.js`, `events-register.css` and `northstar_event_register.py` over the shared audit ledger. Every recorded event, report and alarm has a navigable event report (`event-detail.html?id=`). Preserve server-side filtering, snapshot pagination, object/thread identity and append-only notes; note entry must not acknowledge alarms. Outlook/Teams remain disconnected until authorized integration setup. See `docs/packets/2026-09-11-events-register.md` and `docs/packets/2026-09-13-event-log-navigation.md`, including the required service restart.

**This directory is canonical:**

    C:\Users\Ryan1\Documents\Work Projects\control-room-dashboard

Do not work in, or copy code back from, any of these:

- `control-room-dashboard/` (nested) — an abandoned Next/Vinext/Drizzle starter. Not the runtime.
- `tmp/`, `output/`, `dist/`, `handoff/*/source/` — frozen snapshots and ZIP staging. Read-only history.
- Anything extracted from a handoff ZIP. Those were point-in-time copies; several are now months stale.
- **The Drive `00_CANONICAL_SOURCE_TREE` / CANON tree, despite its name.** It is the separate
  `NorthStar Dashboard v2` / v0.4-v0.6 product line, not this runtime. Its `start-northstar.ps1`
  is the pre-2026-08-11-audit launcher whose only env var is `NORTHSTAR_PORT`, so copying it here
  restores the gate-`off` default, `ALLOWED_ORIGIN='*'`, and the non-loopback bind - three holes
  this project already had exploited. Its `northstar_store.py` predates the logbook hash chain and
  its `tests/` lack every security regression. Full comparison, and the list of genuinely unmerged
  work it *does* hold, in `docs/drive-canon-reconciliation-2026-08-22.md`.

The runtime is a Python standard-library HTTP server with SQLite and static HTML/JS:

- `ieso_backend.py` — HTTP routes, the operator gate, background feed loops
- `northstar_store.py` — SQLite schema and operational workflows
- `northstar_phase1.py` — signed QR tokens, phone verification, location retention, SCADA
- `northstar-clean.html` — operator dashboard (v0.6)
- `contractor-checkin.html` — the worker-facing PWA
- `tests/` — regression suite

## How work is handed off between agents

**`git log` is the state of this project. Not the ZIPs, not Drive, not the newest file timestamp.**

On 2026-08-13 twelve builds were packaged and zero were committed, so `git log` claimed the project
was two packets behind what was actually running. Any agent that had run `git restore` to start
clean would have destroyed two days of work. Do not let that recur.

- **One packet, one commit.** Commit before packaging anything. A packet that is only a ZIP is a
  packet the next agent cannot see, diff, or revert.
- **Tag the packet** — `git tag -a packet-NN-short-name`. The tag is what a ZIP is built *from*.
- **Publish every completed packet to GitHub.** After the commit, tag and verification, push the
  exact branch and its tags to the configured `github` remote. A local-only commit is incomplete.
  Fetch first; if GitHub has advanced, merge its changes, resolve conflicts without discarding
  either release, re-run the relevant verification, then push the combined history.
- **`outputs/` and the Drive upload are derived artifacts.** They are delivery, not source. Never
  copy code back out of one; `Where to work` above already forbids it, and this is why.
- **Leave the tree clean.** Ending a session with 39 uncommitted files is how the next agent
  inherits an unreadable state.
- **Write the packet report** to `docs/packets/`, then summarise it in `docs/PACKET-LOG.md`.
- **Run `python -m pytest tests -q` before committing** and put the count in the commit message.
- If two agents run at once, give each its own `git worktree` rather than sharing this tree.

To see where things stand, in order: `git log --oneline -5`, `git status --porcelain`, `git tag -n1`.

## This is live on the internet

Since 2026-08-11 it is published through a Cloudflare tunnel on **northstarenergy.ca**:

- `checkin.northstarenergy.ca` — **public, no login.** Contractors scan a QR placard and land here.
- `ops.northstarenergy.ca` — the dashboard, behind Cloudflare Access.

Both reach `localhost:4180`. A change that widens the public surface is a live data exposure, not a
staging bug. See `DEPLOY-RUNBOOK.md` for the full topology, and treat these as hard invariants:

1. **The operator gate is load-bearing.** It has three modes and only one of them is unsafe on a
   published host: `off` (local development), `access` (Cloudflare Access header), and `demo`
   (Packet 19 server-side sign-in — see §"Demo operator login" below). `demo` is a *distinct mode*,
   never a reason to set the gate to `off`; everything in this section applies to it unchanged.

   `NORTHSTAR_OPERATOR_GATE=access` makes the roster, QR
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

 1b. **The check-in hostname carries the worker app and nothing else** (Packet 20, 2026-08-13).
   The gate answers "is this an operator route, and is the caller authenticated?" — so everything
   that is *not* an operator route was public on `checkin.` by construction: `northstar-clean.html`,
   every script and stylesheet it loads, `operator-login.html`, `/api/weather`, `/api/market-prices`.
   `CHECKIN_PUBLIC_ROUTES` and `CHECKIN_PUBLIC_PREFIXES` in `ieso_backend.py` now list the worker
   surface, and `_checkin_host_forbidden` 404s everything else that arrives on that hostname. The
   Cloudflare ingress rule says the same thing, but it lives in the Zero Trust dashboard where this
   process cannot read it and an operator can change it in a browser.

   Order matters and is asserted: the gate runs **first**, so an operator route on the public
   hostname still answers **403** (the shape the forged-header tests assert), and everything else
   answers 404. Adding an entry to those lists publishes it to the open internet — worker routes
   only, and `tests/test_packet20_hostname_separation.py` reads `sw.js`'s precache list to make sure
   the worker app's own shell never falls off the allowlist.

 1c. **The operator session cookie is host-only. Never give it a `Domain`.** (Packet 20 §4.)
   `northstar_auth.set_cookie_value` sets `Path`, `Max-Age`, `HttpOnly`, `Secure` and `SameSite` and
   deliberately no `Domain`, so the browser scopes it to `ops.` and never attaches it to a request
   for `checkin.`. `Domain=northstarenergy.ca` would hand a live operator session to the public
   worker page. The server also refuses a copied session on that hostname, so this is defence in
   depth rather than the only lock — keep both. The rest of the demo login is §"Demo operator
   login" below.

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

## Demo operator login (Packet 19)

`NORTHSTAR_OPERATOR_GATE=demo` puts a real, server-enforced sign-in in front of the operator
console. Start it with `.\start-northstar.ps1 -DemoLogin`; add `-LocalOnly` to work on
`localhost:4180` (it clears the public check-in origin — never do that on the production host).

- The credential is **local runtime configuration, not source**: `data/.northstar-demo-auth.json`,
  written by `python scripts/setup-demo-auth.py`. It holds a username and a salted scrypt verifier.
  There is no password value in any HTML, JavaScript, source file, log, Git object or Drive copy,
  and there must never be one. `northstar_auth.py` owns config loading, verification, sessions and
  throttling; `ieso_backend.py` owns the routes.
- `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/session` exist **only on the
  operator hostname** and return 404 on `checkin.`. The session cookie is host-only (no `Domain`),
  `HttpOnly; Secure; SameSite=Lax`, and expires after one workday. Logout destroys the server-side
  session, not just the cookie.
- Authorization reuses `OPERATOR_ROUTES` / `OPERATOR_ROUTE_PATTERNS`. **Do not start a second list.**
  Mutating operator requests also refuse a cross-origin `Origin`. Five failed sign-ins in fifteen
  minutes locks that caller out for the rest of the window; a success clears the count.
- In demo mode the audit actor is the configured username (`ron`), decided by the server. A client
  cannot name itself in `payload.actor` — `_audit_actor()` overrides it. Do not make the demo user
  look like an employee identity.
- `operator-session.js` loads first in `northstar-clean.html`, checks the session before any
  operator fetch, and redirects a signed-out or expired browser to `operator-login.html`. It is
  convenience, not protection: nothing in the browser decides access. Do not move any part of the
  decision into it, and do not restore `auth.js`, the old static login, or the Sites pipeline.
- Covered by `tests/test_demo_auth.py`. See `docs/adr/ADR-023-demo-operator-authentication.md` for
  what this deliberately is not: it is not Access, it does not verify the Access JWT (ADR-011), and
  it does not unblock Stage 3 identity work.

Also preserve, from the earlier Phase 1 port: QR verification, provisional check-ins,
phone-verification shadow mode, location-event retention, site escalation policies, SCADA import
validation, and audit behaviour.

## Current dashboard UI work

- The live operator UI is `northstar-clean.html`; do not edit frozen handoff copies.
- `mobile-dashboard.js` powers the Mobile tab and worker GPS/history display.
- `switching-workspace.js` and `switching-workspace.css` power the UWPC 2024 diagram/rules intake, source-derived draft form, qualified-person review checklist, print/export, server library, and audit state in the Engineering tab. The governing citation is the 2024 Utility Work Protection Code (`northstar_uwpc.py`, operator-only `GET /api/uwpc`). The origin lists section numbers and instrument names only; it does not reproduce the Code. Place a licensed `uwpc-2024.pdf` at `data/controlled-sources/uwpc-2024.pdf` or `NORTHSTAR_UWPC_PATH` if this host should serve the book. Drafts select a Work Permit / Supporting Guarantee / tag (PC10A, PC17B, PC2, Hold-off, Caution, Terminal Point) and a NorthStar-owned draft sheet for that form. The sheets cite the Code; they do not copy Hydro One artwork and they do not issue a permit. Draft metadata, status transitions, and allowlisted source-file bytes synchronize through the operator-gated `/api/switching/drafts` routes into SQLite, so the normal database backup contains the complete review record. A protected controlled-bundle download includes the server record, audit, hashes, review evidence, and exact stored sources. Server revision cloning copies those sources under new attachment IDs but clears diagram revision, qualification evidence, reviewer fields, and checks. One-line drawings have append-only server revisions under `/api/schematics` and can link directly to an outage and switching package. The schematic builder is a black drafting board with a command toolbar; it is not a live mimic. The durable states remain DRAFT, READY FOR QUALIFIED REVIEW, and REVIEW RECORDED - NOT RELEASE. It must not become an equipment-command, Work Permit, or operational-release surface.
- `module-layout.js` is the **single** geometry system. Overview retains one shared canvas with independent movement and four-corner resizing. Containers remain rendering anchors; do not reparent cards away from their feed selectors. `module-workspace.js/.css` own section trees, tabs, landing modules and linked full/compact presentation records. Section pages maximize one module by default; resizing any corner restores floating module windows, whose pointer/keyboard geometry also lives in `module-layout.js`. UWPC tools remain under Outages / UWPC and are also accessible in Engineering alongside SCADA. Tools owns Flows, Modules and Training. Legacy section IDs and source DOM roots remain intact; navigation ownership is normalized in `module-workspace.js`. Source DOM stays under its original selectors, with ancestor siblings hidden while a module is selected. Do not restore the old section-local reordering or the retired inline module editor. Browser preferences use `northstarModuleWorkspaceV1` plus its Saved snapshot; Overview geometry mirrors the current profile to `northstarCanvasLayoutV1`. Responsive profiles and the recoverable previous arrangement live in `northstarOverviewProfilesV2` plus its Saved snapshot; preserve all of them. `dashboard-chrome.js` and `dashboard-polish.css` provide readable navigation, the editing dock and compact styling. `overview-modules.js/.css` provide compact projections and source status, while `module-layout.js` remains their geometry owner. Never restore unconditional startup layout deletion. The embedded stylesheet guard (source: `scripts/dashboard-style-guard.js`) gates module initialization and retries missing CSS; keep it synchronized with the head script in `northstar-clean.html`. Section URL restoration belongs to the initialized module workspace, not early feed bootstraps.
- The two weather zones render the *same* station cards from one array, so they carry separate zone
  ids on purpose: reordering the header strip must not reorder the Weather tab. Keep them distinct.
- Modules need a stable identity or their saved size follows the slot instead of the card:
  `data-module-id` (or `data-site` on staff groups). Add it in the render template when you add a
  card type.
- `staff-layout.js` is a **superseded stub**. It made Field Staff cards free-floating via
  `transform: translate()`, which let a card be dragged out of its section entirely. Do not revive it.
- **Confirmed 2026-08-12: nav tab order and module-layout zone sizing/positions are both stored in
  `localStorage`, not synced anywhere.** Tab order: `northstar-clean.html`'s drag/drop handler
  writes `localStorage.setItem('northstarTabOrder', ...)` on every drop (see the `defaultTabs`/
  `savedTabOrder` line and the `ondrop` handler). Zone layout: `module-layout.js`'s `readAll`/`save`
  functions read and write a single JSON blob keyed by its own `STORE` constant. Neither is an
  operator preference tied to an account — it's a browser/device preference. A different browser, a
  different machine, or clearing site data resets both to default order/layout. This is expected
  behavior, not a bug, but it means "my tabs are in a different order" is never a sync failure to
  chase — check the browser, not the backend.
- `#weatherStrip` pins card width with `flex:0 0 88px!important; width:88px!important`. Resizing
  works because inline `!important` outranks an author stylesheet's `!important` — which is why
  `setSize` uses `style.setProperty(..., 'important')`. Do not "simplify" it to plain assignments.
- `device-library.js` and `device-library.css` power the Library module on the Tools tab: a company device repository (area → site → Operations / Equipment / Data / Notes / Reports) with a Windows-style sunflower folder tree. Operations holds Operating Conditions, Operating Instructions, and Field Notes. Equipment holds Maximo Database plus station folders. Data is Water, Pond, Operating Data, and Historical. Reports is Daily Production, Flows, Outages, and Forecasting. Pending leaves do not invent readings. Station Notes may expire at a time or persist on a date; expired notes stay on the record and never acknowledge alarms. Every recorded event, report, alarm and library note writes an append-only ledger row with a bookmarkable `event-detail.html?id=` report. Station Outages and Operating Conditions list only those recorded rows. Library names and `site:{slug}` ids are the canonical station identity (`northstar_sites.py`); outage and operator crew writes store `site` plus `siteId`, and station lists match `siteId` or known aliases (`Iroquois Falls GS`, `Iroquois Falls 230 kV`). `GET /api/sites` is operator-only. Do not invent Timmins / Carmichael / Smooth Rock into the catalog. The read-only Maximo API (`northstar_maximo.py`, `/api/maximo/station`) stays Setup pending until authorized runtime credentials are present. Operator-gated `/api/library` routes store append-only notes.
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
- **`northstar-clean.html` is served from disk on every request — there is no static cache.** Saving
  the file publishes it to `ops.northstarenergy.ca` immediately. No restart, no staging. Restarting
  is only needed for Python changes.
- **Some dashboard functions are defined more than once, and the last definition wins.**
  `openNode` is defined twice inline in `northstar-clean.html` (offsets ~135889 and ~176895) and
  again in `market-workspace.js`; `renderNodeDetail` likewise. `market-workspace.js?v=7` is loaded
  near the end of the file, so **the module version is the live one and both inline copies are
  dead**. Editing the inline copy changes nothing and looks like the code is not running. Before
  concluding anything about a dashboard function, grep every runtime file and check script load
  order. A 2026-08-14 audit mis-diagnosed a working feature as lost by reading only the HTML.
- `.ontario-market` is **the IESO tile**, not an Ontario-specific card — the class name is legacy.
  `market-workspace.js` registers IESO as a node (`data.nodes.IESO`, `nodeLabels.IESO`) so it gets
  the generic `data-expand` dog-ear and an `IESO MARKET DETAIL` panel. There is no separate Ontario
  market surface any more, and that consolidation was deliberate.
- The local preview is `http://localhost:4180/northstar-clean.html`; restart after edits because the server holds code in memory.

## Running and verifying

    .\start-northstar.ps1          # sets env vars, starts on :4180, waits for health
    python -m pytest tests -q

**A reboot takes the site down while making it look up.** `cloudflared` is a Windows service and
returns on its own; the backend is not, and does not. The tunnel then serves a dead origin and both
public hostnames answer `502` with nothing logged and nothing alerting. This happened on
2026-08-14: an unclean shutdown at 01:31 left `checkin.northstarenergy.ca` — the worker QR
surface — down for five hours before anyone noticed.

A scheduled task, **"NorthStar Control Room backend"**, runs `start-northstar.ps1 -DemoLogin
-NoBrowser -ServiceMode` at logon with a 60-second delay. **`-ServiceMode` is mandatory from a
task and the site stays down without it.** Two independent reasons, both found the hard way when
the first version of this task left the site 502 from 2026-08-15 to 2026-08-22:

1. The ancestor walk and `Get-NorthstarProcesses` enumerate `Win32_Process` through CIM. Under a
   non-interactive task that hangs indefinitely — before the launcher's first `Write-Host`, so
   Task Scheduler reports only a running task and no backend ever appears. It does not hang
   interactively, so it cannot be reproduced by running the script by hand.
2. The normal path uses `Start-Process` and returns. A task is finished when its own process
   ends, and Task Scheduler then kills everything left in the task's tree — including the
   backend. That is exit code `0xC000013A` in the task history.

`-ServiceMode` skips both CIM steps and keeps python as a foreground child, so the task stays
`Running` for the life of the backend. Task output goes to `data/task-start.log`; without it a
failure inside the launcher is invisible.

**Verify an auto-start fix by stopping the backend and running the task, never by running it
while the backend is already up.** The already-running path returns success without starting
anything, which is how a broken task was recorded as verified. `-NoBrowser` is required: the task has no desktop.
It is an **at-logon** trigger, not at-startup, because registering an at-startup trigger needs an
elevated shell. A machine sitting at the lock screen after a reboot is therefore still down. To
close that gap, run once from an **admin** PowerShell:

    $t = Get-ScheduledTask "NorthStar Control Room backend"
    $s = New-ScheduledTaskTrigger -AtStartup; $s.Delay = "PT60S"
    Set-ScheduledTask "NorthStar Control Room backend" -Trigger $s `
      -Principal (New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
                   -LogonType S4U -RunLevel Limited)

After any reboot or restart, check the public surface, not just `localhost` — the whole failure
mode is that the origin looks fine locally:

    curl.exe -s -o NUL -w "%{http_code}\n" https://checkin.northstarenergy.ca/api/health
    curl.exe -s -o NUL -w "%{http_code}\n" https://ops.northstarenergy.ca/

**Baseline was `87 passed, 0 failed`** as of 2026-08-12, and `122 passed, 0 failed` on 2026-08-13
after Packet 19 (`tests/test_demo_auth.py`, 23 tests) and the Packet 20 hostname-separation suite.
The old `test_phase1_port.py:150` date bomb
is fixed; a red suite is now a real regression, not a known quirk. Four of those tests are
security regressions covering live, publicly reachable failures — if any goes red, stop and fix it
before anything else:

- `test_operator_gate_covers_help_subroutes_but_not_the_workers_alarm`
- `test_static_tree_does_not_serve_secrets_or_the_database`
- `test_forged_access_header_cannot_open_the_roster_on_the_public_host`
- `test_forged_access_header_cannot_clear_a_distress_call`

Two more from Packet 19 protect the same containment for the demo session:

- `test_an_operator_session_is_still_refused_on_the_checkin_hostname`
- `test_the_login_endpoint_does_not_exist_on_the_checkin_hostname`

And three from Packet 20 (`tests/test_packet20_hostname_separation.py`) hold the hostname boundary
itself — the first two cover surface that no gate ever looked at:

- `test_the_operator_console_is_not_served_on_the_check_in_hostname`
- `test_non_operator_apis_are_not_published_on_the_check_in_hostname`
- `test_operator_routes_are_refused_on_the_check_in_hostname` (403, not 404, and not to a copied
  session cookie or a forged edge header)

Restarting matters: the server holds code in memory, so edits do nothing until you restart it.
Check with `(Invoke-RestMethod http://127.0.0.1:4180/api/health).checkinOrigin`.

Sites release builds must run from a clean committed checkout. `scripts/prepare-sites.mjs` writes
`dist/.openai/release.json` with the source commit and backend hash, and rejects a dirty tree or a
`NORTHSTAR_RELEASE_SHA` that does not match `HEAD`.

**Legacy-source finding, corrected 2026-08-12:** the retired static pipeline
(`build.mjs`/`auth.js`/`server/index.js`) contained a fake client-side login.
The current Vinext Sites release does not include that pipeline (the built archive and both live
entrypoints were checked; `/auth.js` and the old HTML routes return 404), but it was an unsafe
accidental-deployment path. Packet 18 consolidation retired it explicitly: `build.mjs` now fails
with a migration message, `auth.js` redirects to the real gate, and the legacy server redirects all
requests to `ops.northstarenergy.ca`. The current Sites build remains `pnpm build` -> `vinext build`
-> `scripts/prepare-sites.mjs`; the deployed project id is
`appgprj_6a68048f7a148191a140fcb20a1b90ec`.

**Second legacy-source finding, corrected 2026-08-12:** the old mock `index.html`/`app.js` also
contained a fake Crew Check-ins confirmation flow that never called `/api/checkins`. It is not in
the current Sites package, and the retired server now redirects the entire legacy surface, so the
false check-in cannot be reached through that pipeline. The original analysis and replacement
shape remain in `proposed/packet18_sites_redirect_fix/` for traceability.

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

## Packet history

`docs/PACKET-LOG.md` records what each packet changed, newest first, and `docs/packets/` holds the
full completion reports. **This file states what is true now; the log states what happened.** Do not
add session narrative here — it is what turned this brief from short into long, and a stale
narrative in an invariants file is read as a rule.

## Never commit

Secrets, live databases, generated operational records, `.northstar-qr-secret`, cloudflared
credentials or tunnel tokens, and real payer or worker PII in fixtures.
