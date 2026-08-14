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

## Work added 2026-08-12 (Packet 18 pass) — reviewed; only explicitly marked items are wired

A Cowork/Claude session did a source-level review of Packet 17's claimed fixes (the report is in
the Packet 17/18 Drive folder). The additions below were reviewed against the checked-out source;
the explicit test results and wiring status are recorded here so later agents do not treat drafts
as live behavior:

- `northstar-clean.html` — the Flows tab (`#flows`) no longer renders a bare
  `WATER MANAGEMENT / FLOWS` label with nothing else. It now says PLANNED and points at
  `docs/architecture/DECISION_LOG.md`. This one change **is** live in this file, since it is a pure
  content change with no behavior to regress. The operational browser and AI drafts below remain
  unwired; each item's current validation status is stated explicitly.
- `scripts/restore_drill.py` — a standalone backup-restore integrity check (copies the newest
  `data/backups/*.db` to an isolated scratch path, never touches the live database). Written to
  close the Stage 0.3 gap in `MIGRATION_SEQUENCE.md` ("has never been exercised (G-9)"). Run on
  2026-08-12: PASS for integrity, foreign keys, expected tables, and audit-trail presence; the
  full 87-test suite also passed against the restored copy.
- `proposed/packet18_worker_safety/` — worker capability tokens and phone-verification throttling
  for §18.1 (decision D-1), with unit tests. Deliberately outside `tests/` so it cannot affect the
  baseline above just by existing. Focused validation run on 2026-08-12: 22 passed. It remains
  unwired pending the D-1 decision. Read its `README.md` before moving it into the live backend.
- `proposed/packet18_release_preflight/` - read-only primary-backend pre-flight checks. Its
  focused tests pass (12); the manual check intentionally fails while the checkout is dirty and
  passes the other five checks. It remains advisory and unwired pending owner approval.
- `proposed/packet18_browser_smoke/` — Playwright-syntax browser smoke tests for §18.5. The
  project's own "45 tests across 12 suites" TypeScript baseline (Packet 18) was not found anywhere
  in this folder during this session — see that folder's `README.md` before assuming this is the
  right place or the right framework for it.
- `proposed/packet18_ai_assistant_contract/` — a draft `/api/ai` contract for §18.3 / decision D-6.
  Documentation only; does not touch the still-inert `#assistant` placeholder in
  `northstar-clean.html`.
- The legacy static pipeline hardening described above is source-wired and covered by
  `tests/test_legacy_sites_pipeline.py`; it does not change the already-deployed Vinext package.

**Second pass, same date, with restore-drill and source validation complete:**

- `RECOVERY-RUNBOOK.md` (project root) — §18.2. Where the QR-signing secret actually lives, what
  happens if it's lost, the recovery procedure, a full `NORTHSTAR_*` environment variable reference,
  and a from-scratch redeploy checklist. Documentation only. Found and documented a genuine gap
  while writing it: `daily_backup()` in `northstar_store.py` never copies
  `data/.northstar-qr-secret`, so a lost secret means every printed placard needs reprinting even if
  the database backups are intact.
- **§18.3 (training module) — investigated, correctly stopped, nothing written.** Packet 14's
  "session creation, scenario isolation, learner outcome evidence" does not exist anywhere in this
  repository — not as code, not as a spec file. `docs/architecture/SWITCHING-ENGINEERING-REMAINING-WORK.md`
  and `MIGRATION_SEQUENCE.md` both reference it as still-open future work (the latter calls the
  underlying simulator "Packet 06"), and ADR-001/`GAP_ANALYSIS.md` both state plainly that no
  training module exists yet. There was nothing to check for feasibility or wire in. Writing one
  from scratch would mean deciding training content and access — an owner decision, not a
  documentation or integration task. Correctly stopped rather than inventing a module.
- **§18.4 (Packet 12/13/10/11 contract integration) — mostly already done, one new script written.**
  Packet 12 (canonical asset ID / topology revision fields) and Packet 13 (read-only review-evidence
  projection at the operator-gated `/api/switching/drafts/{id}/review-evidence`) are already
  implemented and confirmed present in `northstar_store.py`/`ieso_backend.py` — nothing new needed
  there; what remains (a live topology registry to validate against, a retention policy) needs an
  external system or an owner decision, not more code. "Packet 10/11" does not appear anywhere in
  this repository, same as Packet 14 above — nothing to assess. Packet 15's release evaluator:
  `scripts/prepare-sites.mjs` already does a narrow version of this for the Sites build only (clean
  checkout, `NORTHSTAR_RELEASE_SHA` match). `proposed/packet18_release_preflight/` extends the same
  idea to the primary deployment path — clean checkout, release SHA, operator-gate default, the
  loopback-bind guard, `data/` gitignored, and the four named regression tests all present — as a
  standalone script a human runs and decides whether to wire into `start-northstar.ps1`. Not wired
  in by this pass.
 - `proposed/packet18_sites_redirect_fix/` — the same `Gate.tsx` redirect-to-`ops.` pattern, applied
   to `server/index.js`. The source fix is now in place; the proposed copy remains for traceability.
   No separate Sites deployment was needed because the current Vinext package does not use this
   retired server entrypoint, and its live routes were already verified as safe.

## Never commit

Secrets, live databases, generated operational records, `.northstar-qr-secret`, cloudflared
credentials or tunnel tokens, and real payer or worker PII in fixtures.
