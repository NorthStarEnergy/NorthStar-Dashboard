# NorthStar — Current State Inventory

Produced 2026-08-11 for **Packet 00 – System Architecture**, work order tasks 1, 3, 4 and 5.
Describes the repository as it is, not as it should be. Judgements live in `GAP_ANALYSIS.md`.

Canonical tree: `C:\Users\Ryan1\Documents\Work Projects\control-room-dashboard`
Commit at time of inventory: `1e2be5a` (working tree far ahead of it — see §9).

---

## 1. Applications and surfaces

| Surface | File | Reached at | Audience |
|---|---|---|---|
| Operator dashboard v0.6 | `northstar-clean.html` (306 KB, single file) | `ops.northstarenergy.ca`, `localhost:4180/` | Control room operators |
| Worker check-in PWA | `contractor-checkin.html` + `sw.js` + `manifest.webmanifest` | `checkin.northstarenergy.ca` | Contractors / lone workers |
| QR placard generator | `contractor-qr.html` | `ops.` | Operators printing site placards |
| Switching workspace | `switching-workspace.js/.css` (loaded into the dashboard) | `ops.` | Operators + qualified reviewers |
| Voice triage workspace | `voice-workspace.js/.css` (loaded into the dashboard) | `ops.` | Operators |
| Layout engine | `module-layout.js` | — | Shared by the dashboard's zones |
| Mobile/staff tab | `mobile-dashboard.js` | — | Loaded into the dashboard |
| SCADA import UI | `scada-ui.js` | — | Loaded into the dashboard |
| Market strip | `lamination-dashboard.js` | — | Loaded into the dashboard |

`northstar-clean.html` loads exactly six scripts: `switching-workspace.js`, `module-layout.js`,
`voice-workspace.js`, `lamination-dashboard.js`, `scada-ui.js`, `mobile-dashboard.js`.

**Dead or superseded front-end in the same directory**, not loaded by any live page:
`app.js`, `annunciator.js`, `ops-beta.{html,css,js}`, `staff-layout.js` (explicitly superseded),
`weather-cards.js`, `ui-fix.js`, `graph-fix.js`, `final-fix.js`, `flows.html`,
`live-dashboard.html`, `live-dashboard-final.html`, `weather-demo.html`, `index.html`,
`preview-{graphite,slate,teal}.html`, `northstar-v0.9.html`, `styles.css`,
`northstar-clean.html.prepatch`. Plus ~60 `dashboard-screenshot-*.png` and theme PNGs.

**Abandoned second stack:** `control-room-dashboard/` (nested) is a `site-creator-vinext-starter`
— Next 16 / React 19 / Drizzle ORM / Cloudflare Vite. It has `drizzle.config.ts` and
`hosting.json` but no runtime role. `AGENTS.md` already forbids working in it.

---

## 2. Services and runtime

One process. `python ieso_backend.py`, Python standard library only (`requirements.txt` is a single
line: `tzdata`).

- `NorthstarHTTPServer(ThreadingHTTPServer)` binds `127.0.0.1:4180` in the production launcher
  (`NORTHSTAR_BIND_HOST`, `NORTHSTAR_PORT`); a public check-in origin refuses a non-loopback bind.
- `Handler(SimpleHTTPRequestHandler)` serves the project directory as the web root and
  intercepts `/api/*` in `do_GET` / `do_POST` / `do_DELETE` / `do_OPTIONS`.
- Four background daemon threads, all in `ieso_backend.py`:

| Loop | Interval | Work |
|---|---|---|
| `refresh_loop` | 300 s | Pull six IESO public CSV reports, re-price nodes, evaluate price alerts |
| `overdue_loop` | 30 s | Evaluate overdue check-ins, purge expired coordinates, daily DB backup |
| `scada_loop` | 60 s (`NORTHSTAR_SCADA_POLL_SECONDS`) | Scan the SCADA drop folder, import CSV |
| `voice_loop` | 45 s (`NORTHSTAR_VOICE_POLL_SECONDS`) | Scan the voice inbox, transcribe, purge expired audio |

Started by `start-northstar.ps1` (the real launcher; sets env, waits for `/api/health`, opens the
browser). `start-northstar{,-v2,-v3}.{bat,ps1}` and `start-ieso-backend.bat` are thin or stale
wrappers.

---

## 3. Domain modules and ownership

Four Python modules, 5,168 lines total. There is no package; they import each other by module name.

| Module | Lines | Owns |
|---|---|---|
| `ieso_backend.py` | 1,456 | HTTP routing, operator gate, static serving, IESO market feed parsing, ECCC/Open-Meteo weather, health, all four background loops, process entry point |
| `northstar_store.py` | 1,841 | SQLite connection/session/schema/migration/backup **plus** check-ins, logbook, outages, price alerts, switching drafts |
| `northstar_phase1.py` | 1,163 | Signed site QR tokens, phone verification, check-in security enrichment, location-event retention, site escalation policies, SCADA import/readings |
| `northstar_voice.py` | 708 | Audio intake, transcription dispatch, segment classification/triage, voice audit events, audio retention |

**Coupling shape.** `northstar_phase1._db()` and `northstar_voice._db()` both reach into
`northstar_store`'s private `_LOCK` and `_session()`:

```python
def _db():
    store = _store()                      # import northstar_store
    with store._LOCK, store._session() as connection:
        yield connection
```

`northstar_store.init_db()` reciprocally imports and calls `northstar_phase1.init_schema` and
`northstar_voice.init_schema` against its own connection. So all three modules share one
transaction manager and one physical database, and the dependency is circular at import time
(broken only by deferring the imports into function bodies).

---

## 4. Database

Single SQLite file, `data/northstar.db` (`NORTHSTAR_DB`), WAL, `foreign_keys=ON`, one global
`threading.Lock`. 26 tables in four ownership groups that are not separated by schema, prefix
convention, or connection:

| Owner | Tables |
|---|---|
| `northstar_store` — workforce | `checkins`, `checkin_events` |
| `northstar_store` — operations log | `logbook`, `outages`, `outage_events` |
| `northstar_store` — market alerts | `alert_settings`, `alerts`, `alert_events` |
| `northstar_store` — switching | `switching_drafts`, `switching_draft_events` |
| `northstar_phase1` — workforce security | `site_tokens`, `phone_verifications`, `checkin_security`, `checkin_location_events`, `retention_policies`, `site_policies` |
| `northstar_phase1` — SCADA | `scada_feeds`, `scada_import_batches`, `scada_tags`, `scada_readings`, `scada_import_rejects`, `scada_feed_watermarks` |
| `northstar_voice` | `voice_recordings`, `voice_segments`, `voice_events` |

- **Schema management:** `executescript(SCHEMA)` with `CREATE TABLE IF NOT EXISTS`, plus a
  hand-written `_migrate_schema()` that does `PRAGMA table_info` and conditional `ALTER TABLE ADD
  COLUMN`. No migration files, no version table, no down path.
- **IDs:** `f"{prefix}-{int(now.timestamp()*1000)}"` with a collision loop appending `"x"`
  (`northstar_store.py:458`, `:874`). Unique within a table; **predictable across the system**.
- **Timestamps:** `datetime.now(ZoneInfo("America/Toronto")).isoformat()` — timezone-aware, stored
  as local-with-offset text, not UTC.
- **Backups:** `daily_backup()` uses the sqlite backup API, one file per day under `data/backups/`,
  refreshed every `NORTHSTAR_BACKUP_REFRESH` seconds, keeps `BACKUP_KEEP` days, optional mirror via
  `NORTHSTAR_BACKUP_MIRROR`. No restore procedure is scripted or tested.
- **Binary content** is kept out of rows correctly: voice audio lives on disk under
  `data/voice-store/`, rows hold metadata and a hash. Switching source-file bytes stay in the
  browser and never reach the server.

---

## 5. UI-to-database coupling (work order task 3)

**No browser reaches SQLite.** Every dashboard and PWA call goes through `/api/*` over HTTP, and
responses are built by explicit mapper functions (`_row_to_record`, `_outage_record`,
`_alert_record`, `_token_record`, `_recording_row`, `_segment_row`) that rename columns to
camelCase and drop internal fields. Principle 3 of the spec is structurally satisfied at the
process boundary, and API payloads are not raw table rows.

The real coupling is different in kind:

1. **The route table is the domain layer.** `_do_POST` is a ~400-line `if/elif` chain in which
   validation, orchestration, audit logging and the HTTP response are interleaved. There is no
   application-service seam between transport and domain.
2. **Cross-domain reads inside handlers.** `POST /api/checkins` calls `phase1.prepare_checkin` →
   `store.create_checkin` → `phase1.attach_checkin_security` → `phase1.record_location` →
   `log_event` (logbook), touching three domains and four table groups in one un-transacted
   handler body. A failure part-way leaves a check-in with no security row.
3. **Two browser-side integration bypasses.** `app.js`, `final-fix.js` and `weather-demo.html`
   call `https://api.open-meteo.com` directly from the browser rather than through
   `/api/weather`. These files are dead, but they are the pattern of record in the tree.
4. **One UI call with no server contract.** `northstar-clean.html:422` POSTs to `/api/ai`, which
   does not exist in `ieso_backend.py`. The dashboard's chat box fails on every send.

---

## 6. HTTP API surface

37 route handlers, unversioned, all under `/api/`. No OpenAPI or schema document exists.

**GET** — `/api/health`, `/api/market-prices`, `/api/weather`, `/api/checkins`,
`/api/checkins/history`, `/api/checkins/<id>`, `/api/checkin-tokens`,
`/api/checkin-tokens/resolve`, `/api/logbook`, `/api/outages`, `/api/outages/history`,
`/api/alerts`, `/api/alerts/settings`, `/api/alerts/history`, `/api/retention`,
`/api/site-policies`, `/api/scada`, `/api/scada/readings`, `/api/switching/drafts`,
`/api/switching/drafts/<id>`, `/api/voice`, `/api/voice/recordings`, `/api/voice/recordings/<id>`

**POST** — `/api/checkins`, `/api/checkins/<id>/{time,provisional,help,help/acknowledge,help/resolve,heartbeat}`,
`/api/checkin-tokens`, `/api/phone-verifications`, `/api/phone-verifications/<id>/verify`,
`/api/logbook`, `/api/outages`, `/api/outages/<id>/close`, `/api/alerts/settings`,
`/api/alerts/clear`, `/api/retention`, `/api/site-policies`, `/api/scada/import`,
`/api/switching/drafts`, `/api/switching/drafts/<id>`, `/api/voice/scan`,
`/api/voice/segments/<id>/review`

**DELETE** — `/api/checkins/<id>` (worker check-out)

Conventions in force:
- Errors are `{"error": "<free text>"}` with an HTTP status. No machine-readable error code.
- `APIError(status, message)` exists but is caught only in `do_POST`; `do_GET` and `do_DELETE`
  have no equivalent wrapper.
- `send_error` is overridden so `/api/` paths always get JSON rather than HTML.
- Request body cap `MAX_JSON_BODY` = 64 KB; body must be a JSON object.
- No correlation/request ID is generated, logged, or returned.
- No idempotency keys. `POST /api/checkins` retried by a phone on a flaky link creates a second
  worker record.
- Optimistic concurrency exists in exactly one place: `switching_drafts.record_version` with
  `_switching_expected_version`.

---

## 7. Authentication, authorization, secrets, audit, configuration (task 4)

### Authentication
There is **no application-level authentication, session, user table, or role model.** Identity is
entirely delegated to Cloudflare Access at the edge:

- `_operator_gate_blocks()` returns True when `NORTHSTAR_OPERATOR_GATE == "access"`, the
  route+method is operator-only, and the `Cf-Access-Jwt-Assertion` header is absent.
- **The header's presence is checked; the JWT is never verified.** Anything that can reach
  `localhost:4180` with that header set is an operator.
- `_operator_actor()` reads `Cf-Access-Authenticated-User-Email` for audit attribution, falling
  back to a client-supplied `X-Northstar-Operator` when the gate is off.
- Authorization is binary: operator or not. No least-privilege split between, say, a dispatcher
  reading the roster and a qualified person recording a switching review.

Operator-only routes are declared in two places: `OPERATOR_ROUTES` (exact path → gated methods)
and `OPERATOR_ROUTE_PATTERNS` (method + regex, added by the 2026-08-11 audit for
`/<id>/<action>` sub-routes).

### The worker device surface has no credential at all
`GET /api/checkins/<id>`, `DELETE /api/checkins/<id>`, `POST .../heartbeat` and `POST .../help`
are ungated by design so a phone can use them. The only thing standing between the public
internet and a worker's record is knowledge of the check-in id — and ids are
`checkin-<epoch_ms>`. See `GAP_ANALYSIS.md` §G-1; this is flagged, not changed.

### Secrets
- QR signing key: `data/.northstar-qr-secret`, generated on first use, overridable by
  `NORTHSTAR_QR_SECRET` / `NORTHSTAR_QR_KEY_ID`. Not in source. Not rotated on a schedule;
  `revoke_site_token` exists for individual tokens.
- Cloudflare tunnel token: `C:\ProgramData\cloudflared\token`, outside the repo, installed by an
  elevated shell.
- `.gitignore` covers the database and secret. `AGENTS.md` carries an explicit never-commit list.
- No secret store, no rotation policy, no `.env.example` documenting the 24 environment variables.

### Audit
Append-only event tables per domain: `checkin_events`, `outage_events`, `alert_events`,
`switching_draft_events`, `voice_events`, plus the human-readable `logbook`.

Captured today: actor, action, entity + entity id, before/after for status transitions
(`prior_status`/`new_status`, `prior_help_state`/`new_help_state`), timestamp, and — for the
logbook only — a `source`. `details` is a free-text string, truncated (2,000 or 4,000 chars).

Not captured: correlation/request id, causation id, client/source IP or user agent, schema
version, structured before/after payloads, or a required reason field on destructive actions.
There is no common event envelope; each table has its own column set.

### Configuration
24 `NORTHSTAR_*` environment variables read directly by `os.environ.get` at **module import
time**, scattered across all four modules, each with an inline default:

`NORTHSTAR_ALERT_RECOVERY_MARGIN`, `NORTHSTAR_ALLOWED_ORIGIN`, `NORTHSTAR_BACKUP_MIRROR`,
`NORTHSTAR_BACKUP_REFRESH`, `NORTHSTAR_CHECKIN_ORIGIN`, `NORTHSTAR_COORDINATE_RETENTION_DAYS`,
`NORTHSTAR_DB`, `NORTHSTAR_OPERATOR_GATE`, `NORTHSTAR_OVERDUE_ALONE`, `NORTHSTAR_OVERDUE_CREW`,
`NORTHSTAR_PHONE_VERIFICATION_MODE`, `NORTHSTAR_PORT`, `NORTHSTAR_QR_KEY_ID`,
`NORTHSTAR_QR_SECRET`, `NORTHSTAR_QR_TOKEN_DAYS`, `NORTHSTAR_SCADA_PATH`,
`NORTHSTAR_SCADA_POLL_SECONDS`, `NORTHSTAR_VOICE_COMMAND`, `NORTHSTAR_VOICE_ENGINE`,
`NORTHSTAR_VOICE_INBOX`, `NORTHSTAR_VOICE_POLL_SECONDS`, `NORTHSTAR_VOICE_RETENTION_DAYS`,
`NORTHSTAR_VOICE_STORE`, `NORTHSTAR_VOICE_TIMEOUT_SECONDS`.

Import-time reads mean tests must set the environment before import, and nothing can be
reconfigured without a restart. There is no environment name (`dev`/`test`/`prod`) anywhere in the
codebase — the same process serves all three roles.

One safety interlock is implemented and worth recording: `ieso_backend.py:1429` **refuses to
start** when `NORTHSTAR_CHECKIN_ORIGIN` is an `https://` URL while the gate is not `access`.
`start-northstar.ps1` now defaults the gate to `access` and pins `NORTHSTAR_ALLOWED_ORIGIN` to the
check-in host.

---

## 8. Integrations (task 1)

| Integration | Direction | Transport | Auth | Failure behaviour |
|---|---|---|---|---|
| IESO public reports | Outbound read | HTTPS CSV from `reports-public.ieso.ca` | none (public) | 5 attempts, exponential backoff to 16 s, then `RuntimeError`; last good snapshot retained |
| ECCC SWOB | Outbound read | HTTPS from `api.weather.gc.ca` | none (public) | 3 retries, honours 429, 10-min cache, `stale` flag surfaced |
| Open-Meteo | Outbound read | HTTPS | none | fallback for weather; also called directly from dead browser code |
| SCADA | **Inbound read-only** | CSV files dropped in `NORTHSTAR_SCADA_PATH`, polled | filesystem ACL | validated import, rejects recorded in `scada_import_rejects`, watermarks prevent replay |
| Voice transcription | Local subprocess | `NORTHSTAR_VOICE_COMMAND` with `{file}` | n/a | `NORTHSTAR_VOICE_ENGINE=none` by default: audio is hashed and queued, never transcribed, never faked |
| Cloudflare Access | Inbound identity | HTTP header at the edge | — | header presence only |
| Cloudflare Tunnel | Inbound transport | outbound-only connector | tunnel token | — |

**There is no OT write path.** SCADA is file-drop, one-directional, into a validating importer.
No Microsoft 365 / Teams, Maximo / EAM, identity provider, or document-system integration exists —
`handoff/NO-PRIVILEGE-TEAMS-PILOT-HANDOFF.md` describes a Teams pilot that was never built.

---

## 9. Deployment and hosting assumptions (task 5)

**Live on the public internet since 2026-08-11.** The developer PC *is* the production host.

```
Internet ──> Cloudflare edge ──> cloudflared (Windows service, outbound-only) ──> localhost:4180
              │                                                                         │
              ├─ checkin.northstarenergy.ca  public, no login, path-regex allowlist ─────┤
              └─ ops.northstarenergy.ca      Cloudflare Access policy ────────────────────┘
                                                                          loopback only;
                                                                          no direct LAN path
```

- Tunnel `c40ae859-c686-46b8-a3af-3a67e7b81c5a`, **remotely managed** — ingress rules come from the
  Zero Trust dashboard. `cloudflared-config.yml` in the repo is documentation only and is not read
  at runtime.
- Access team domain `red-butterfly-38d1.cloudflareaccess.com`.
- Windows service `Cloudflared`, StartType Automatic. Install and stop need an elevated shell.
- `tools/cloudflared.exe` is vendored into the repo.
- Static web root is the project directory. `_static_forbidden()` allows only web-asset suffixes,
  denies `STATIC_DENY_DIRS` and dotfiles; `list_directory` returns 404. This is the fix for the
  audit finding that `data/northstar.db` and `.northstar-qr-secret` were LAN-downloadable.

**No test or staging environment exists.** There is no CI, no build, no container, no
infrastructure-as-code, no deployment automation beyond `start-northstar.ps1`, and no
monitoring/alerting on the process itself. `/api/health` is polled only by the launcher and the
dashboard watchdog. Recovery from host loss is manual and unrehearsed.

Per Packet 00 §4, none of this is an approved production architecture — see `GAP_ANALYSIS.md` §G-9.

---

## 10. Tests

Packet 17 verification on 2026-08-12: `python -m pytest tests -q` → **86 passed, 0 failed**.
The release build records the exact Sites source commit and backend hash in
`dist/.openai/release.json`; the older count below is retained as the pre-packet snapshot.

`python -m pytest tests -q` → **81 passed, 0 failed** (verified 2026-08-11, before any change in
this work order). Note `AGENTS.md` still records the older baseline of 66.

| File | Covers |
|---|---|
| `test_api_workflows.py` | Route contracts, error/preflight/CORS shape, operator gate incl. the two audit regressions |
| `test_safety_workflows.py` | Check-in lifecycle, help request/acknowledge/resolve, overdue evaluation |
| `test_phase1_port.py` | QR tokens, phone verification, retention, site policies, SCADA import |
| `test_switching_workflow.py` | Draft → ready → review-recorded transitions, version conflict |
| `test_voice_workflows.py` | The three load-bearing voice rules (never invent, never suppress safety, filtered ≠ deleted) |
| `test_alerts.py` | Price threshold breach, recovery margin, acknowledgement |

Two are named security regressions and are treated as stop-the-line by `AGENTS.md`:
`test_operator_gate_covers_help_subroutes_but_not_the_workers_alarm` and
`test_static_tree_does_not_serve_secrets_or_the_database`.

**Layers present:** domain-rule unit tests, API contract tests, permission/security tests, some
failure-path tests. **Layers absent:** migration tests, integration-adapter tests against recorded
fixtures, backup/restore verification, performance tests, and any end-to-end browser test.

---

## 11. Version control

Packet 17 establishes the canonical committed baseline for the Python runtime, current dashboard,
tests, deployment files, and architecture records. Generated output, operational data, screenshots,
archives, credentials, and frozen handoff copies remain outside the release baseline. The exact
deployed Sites source is identified by `dist/.openai/release.json` and the Packet 17 release tag.

`git log` shows two commits, the newest `1e2be5a "Update Northstar logo and favicon"`. Essentially
all of the current system — the store, phase 1, voice, switching, the gate, the audit fixes — is
uncommitted working tree. There is no branch, tag, release, or remote in use for this project.

Consequence for this work order: **there is no rollback point.** Any change is compared against
memory and the test suite, not against a baseline commit.

---

## 12. Documentation already in the tree

`AGENTS.md` (the operative brief — live invariants, verification baseline, Windows traps),
`CLAUDE.md` (a pointer to it), `DEPLOY-RUNBOOK.md`, `AUDIT-REPORT-2026-08-11.md`,
`REAL-DATA-SETUP.md`, and `handoff/` — 10 documents plus `MODULE-MAP.json`, several months stale
and explicitly marked read-only history by `AGENTS.md`.
