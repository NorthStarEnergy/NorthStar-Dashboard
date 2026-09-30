- 2026-09-30: NorthStar v0.156 — large-area Event Log with dashboard-only alarm controls, custom-module deletion, Manager readiness improvements, and timestamp-tolerant versioning. See [report](packets/2026-09-30-event-log-v0156.md).

- 2026-09-28: Station schematic builder foundation — equipment metadata, durable SCADA bindings, read-only display, dynamic measurements, reusable templates and editing tools. See [report](packets/2026-09-28-station-schematic-builder.md).

- 2026-09-28: Advanced module asset editor v0.126 — individual geometry and styling, custom module builder, live bindings, undo/redo and saved reset. See [report](packets/2026-09-28-module-asset-editor.md). Local implementation; Git publication pending separation from concurrent changes.

# Controlled operator knowledge library - 2026-09-26

Added reviewed source intake, scoped AI retrieval and exact evidence links. Standalone Git publication is blocked by the inherited source baseline. See [report](packets/2026-09-26-operator-knowledge-library.md).

# IESO HE clock and 24-hour times — 2026-09-18

Event log shows live `[HE xx - HH:MM]` and operator clocks use Toronto 24-hour
IESO system time (no AM/PM). See [report](packets/2026-09-18-ieso-he-times.md).

# Unified dogear style — 2026-09-18

Replaced status / Overview / market `↗` expand arrows with the weather-module
clip-path triangle dogear. See [report](packets/2026-09-18-dogear-unify.md).

# Event log alarm listing — 2026-09-18

Widened the top Event log into a filterable alarm listing with unacknowledged
`×` markers. See [report](packets/2026-09-18-event-log-alarm-listing.md).

# Status bar card theme — 2026-09-18

Themed the top Event log / Dispatch / Market pricing / Crew status tiles as
dashboard cards with metric layouts matching Overview modules. See
[report](packets/2026-09-18-status-bar-card-theme.md).

# Overview weather module fit — 2026-09-17

Densified Overview weather card face content so title, icon, temperature,
condition, and precip fit inside the saved module size. See
[report](packets/2026-09-17-weather-module-fit.md).

# One-line catalogue 2026.4 — 2026-09-18

Synced JSON catalogue, aliases, and dashboard labels to the 2026.4 symbol library (VCB/SF6/HVI/cutout/MOD/GSU/CVT/meters). See [report](packets/2026-09-18-one-line-catalogue-2026-4.md).

# Black schematic builder — 2026-09-18

The Engineering one-line board is a black drafting surface with a command toolbar. It is not a live mimic. See [report](packets/2026-09-18-black-schematic-builder.md).

# Operations data catalog — 2026-09-17

Added a private, auditable metadata catalog and operator-facing library view for the known operations data collections. See [report](packets/2026-09-17-operations-data-catalog.md).

# Legacy SOP reference library — 2026-09-15

Imported 94 private FirstLight SOP PDFs as `LEGACY_REFERENCE`, with checksums, operator-only serving, company-library access, and affected-station Operating Instructions listings. See [report](packets/2026-09-15-legacy-sop-library.md).

# Overview weather header — 2026-09-15

Replaced the retired Overview header strip with 75% whole-card weather modules and protected saved layouts during status-bar startup. See [report](packets/2026-09-15-overview-weather-header.md).

# Flow workspace consolidation — 2026-09-15

Flows now opens as one complete Tools module rather than four identically named submodules. See [report](packets/2026-09-15-flow-workspace-consolidation.md).

# Flow workspace asset recovery — 2026-09-15

Committed the Flow workspace stylesheet, script, backend source adapter, and static-asset regression check so `flows-workspace.js` is always part of the release. See [report](packets/2026-09-15-flow-workspace-asset-recovery.md).

# Editable UI style cycler — 2026-09-15

Added nine persisted Edit-mode dashboard palettes, preview swatches, accessible selected state, and Next Style cycling. See [report](packets/2026-09-15-editable-ui-style-cycler.md).

# Complete module editor — 2026-09-15

Expanded editing to every registered module, with selectable module/presentation, text and image overrides, data blocks, restore controls, and custom placement. See [report](packets/2026-09-15-complete-module-editor.md).

# Collapsible module menu — 2026-09-15

Added a persistent per-section Show/Hide modules toggle. See [report](packets/2026-09-15-collapsible-module-menu.md).

# Compact platform formatting — 2026-09-15

Extended compact navigation and control styling across dashboard chrome, catalog and editor. See [report](packets/2026-09-15-platform-compact-format.md).

# Compact section menu — 2026-09-15

Reduced section rail widths and row spacing, aligning floating module offsets with CSS. See [report](packets/2026-09-15-compact-section-menu.md).

# Persistent operations status bar — 2026-09-15

Added the condensed cross-section event/dispatch/market/crew bar with bottom-right dogears and a 500ms hover event preview. See [report](packets/2026-09-15-persistent-status-bar.md).

# Match weather cards to Atikokan — 2026-09-15

Applied the saved Atikokan dimensions, 88 x 165 CSS pixels, to all eight Overview weather cards while preserving their positions. See [report](packets/2026-09-15-match-atikokan-size.md).

# Restore pre-redesign weather cards — 2026-09-15

Reconnected the original weather renderers from b766d9f to the module canvas, preserving native card formatting and forecasts. See [report](packets/2026-09-15-original-weather-cards.md).

# Restore coloured weather artwork — 2026-09-15

Replaced the unintended outline substitutions with coloured weather graphics in all Overview weather modules. See [report](packets/2026-09-15-weather-art-restoration.md).

# Unrestricted module sizing and Overview graphics — 2026-09-15

Removed content minimums and restored feed-based charts to larger Overview cards. See [report](packets/2026-09-15-unrestricted-module-sizing.md).

# Dashboard asset connection backlog — 2026-09-15

Reproduced connection resets during the 51-asset navigation burst; increased the server backlog from the stdlib default to 128. Administrator backend restart required. See [report](packets/2026-09-15-asset-connection-backlog.md).

# Dashboard loading guard scope — 2026-09-15

Optional injected scripts no longer block dashboard startup; required asset failures identify the filename. See [report](packets/2026-09-15-load-guard-scope.md).

# Overview refresh stability — 2026-09-15

Feed updates no longer rearrange saved canvas geometry or add native roster panels to Overview. Failed scripts show recovery UI before partial initialization. See [report](packets/2026-09-15-refresh-stability.md).

# Saved Overview placement and uppercase menus — 2026-09-15

Existing saved profiles receive the five-indicator row once, with a full profile backup. Legacy Events content is hidden behind Overview, and menu/tree/tab labels are uppercase. See [report](packets/2026-09-15-saved-row-caps.md).

# Section consolidation and bold titles — 2026-09-15

Flows, Modules and Training move into Tools; SCADA moves into Engineering. Legacy links, saved module IDs and UWPC access remain supported. Section titles use a bold monospace font matching the APIROQ style. See [report](packets/2026-09-15-section-merges.md).

# Short Overview indicator row — 2026-09-15

Events, dispatch, crew tracking, IESO and APIROQ prices share a 96 px desktop row. Compact content retains source status and adapts when resized. See [report](packets/2026-09-15-overview-indicators.md).

# Event return and stylesheet recovery — 2026-09-15

Restores the correct section after an event report, retries failed styles before layout initialization, and preserves saved geometry when assets remain unavailable. Browser regression coverage includes both return paths and injected stylesheet failures. See [report](packets/2026-09-15-event-return-fix.md).

# Dashboard visual polish — 2026-09-15

Rendered local-UI review led to readable navigation, tighter Overview modules, clear empty states, a shared editing dock, small corner grips and keyboard content editing. See [report](packets/2026-09-15-dashboard-polish.md).

# Overview redesign — 2026-09-15

Priority compact modules, responsive saved layouts, four-corner resize and optional snap, linked full views, editable live labels, and truthful source states. Five viewport sizes pass browser containment checks. See [report](packets/2026-09-15-overview-redesign.md).

# Module workspace — 2026-09-15

Section trees and browser-style module tabs replace stacked application lists.
Linked full/Overview editing, persistent custom modules, UWPC nesting, and four-corner resizing.
See [report](packets/2026-09-15-module-workspace.md).

# Dashboard review and regression automation — 2026-09-14

Cross-workspace source review identifies deployment and workflow gaps. Added
Windows CI and optimized-Python release-check regression.
See [review](packets/2026-09-14-dashboard-review.md).

# Deployment verification — 2026-09-14

Isolated committed-source smoke checks replace startup against operational data;
private environment files are ignored. Backup structural restore passed.
See [report](packets/2026-09-14-deployment-verification.md).

# NorthStar UWPC form templates — 2026-09-14

Engineering has a NorthStar-owned draft sheet for each UWPC form and permit type. The sheets cite the 2024 Code and do not copy Hydro One forms or issue a permit. 243 Python tests pass. See [report](packets/2026-09-14-uwpc-templates.md).

# UWPC 2024 governing source — 2026-09-14

Switching and outage work-protection drafts cite the 2024 Utility Work Protection Code. Switching site uses the 18-station catalog. The origin lists section and instrument names only and does not reproduce the Code. 242 Python tests pass. See [report](packets/2026-09-14-uwpc-2024.md).

# Canonical station identity — 2026-09-14

The 18 library station names and `site:{slug}` ids are the single identity for outage and crew writes. Historical aliases match station event logs. 241 Python tests pass. See [report](packets/2026-09-14-canonical-sites.md).

# Event log navigation — 2026-09-13

Every recorded event, report, alarm and library note has a bookmarkable event report. Station Outages and Operating Conditions list only recorded rows. 230 Python tests pass. See [report](packets/2026-09-13-event-log-navigation.md).

# Station whiteboard menus — 2026-09-13

Each generating station follows the Twin Falls board: Operations, Equipment, Data, Notes, and Reports. Maximo sits under Equipment. Pending leaves invent nothing. Station notes may expire or persist on a date. 227 Python tests pass. See [report](packets/2026-09-13-station-whiteboard.md).

# Station menus — 2026-09-13

Each generating station opens with Info, Operating Conditions, and Data. Equipment folders live under Info. Operating Conditions stays Setup pending. Data holds the read-only Maximo pane. 226 Python tests pass. See [report](packets/2026-09-13-station-menus.md).

# Maximo station API — 2026-09-13

Read-only, operator-gated Maximo API under each generating station. Setup pending until authorized credentials; no invented assets and no Maximo writes. 225 Python tests pass. See [report](packets/2026-09-13-maximo-api.md).

# Device library — 2026-09-13

Tools Library module: company device repository by West, East and Quebec, Windows-style sunflower folder tree, operator-gated append-only notes. Reference records only. See [report](packets/2026-09-13-device-library.md).

# Event reporting — 2026-09-11

Dedicated event pages, recurrence metrics, explicit linked history, persistent filters and source coverage gaps. 211 Python tests pass; two Node UI checks pass. Backend restart remains blocked by Windows process ownership. See [report](packets/2026-09-11-event-reporting.md).

## 2026-09-11 — Brand version button

Moved the version badge beside the NorthStar logo/name. 207 tests passed. See [report](packets/2026-09-11-brand-version-button.md).

## 2026-09-11 — GitHub publication baseline

Merged the independently advanced GitHub dashboard releases with the six local packets, preserved both feature sets, made GitHub publication mandatory and pushed the complete history and tags. 207 tests passed. See [report](packets/2026-09-11-github-publication.md).

## 2026-09-11 — Control room Events register

Built searchable, paginated all-event history with source/type filters, event detail and linked history, append-only notes, AI outcome capture and SCADA import outcomes. Outlook/Teams remain pending setup. Windows denied restarting the older running backend; activation needs its service account. See [report](packets/2026-09-11-events-register.md).

## 2026-09-11 — Shared dashboard canvas

Removed Overview group confines. Leaf cards now move and resize independently across one canvas with persistent geometry. See [report](packets/2026-09-11-shared-dashboard-canvas.md).

## 2026-09-11 — Microsoft Events integration structure

Added disabled Outlook/Teams ingestion contracts, idempotent audit mapping, Communications filtering and a setup-pending indicator. No Microsoft connections are enabled. See [handoff](packets/2026-09-11-microsoft-events-structure.md).

## 2026-09-11 — Compact dispatch

Reduced dispatch to a compact card and replaced the oversized OR activation box with an inline status badge. See [report](packets/2026-09-11-compact-dispatch.md).

## 2026-09-11 — Main page repair

Restored the weather lineup, IESO/APIROQ panels and field tracking with responsive flow layout and one-time preference migration. Restored single-account authentication compatibility. See [completion report](packets/2026-09-11-main-page-repair.md).

# NorthStar packet log

History, newest first. **`AGENTS.md` holds the invariants an agent must not violate; this file
holds what happened.** If the two disagree about current behaviour, `AGENTS.md` wins and this file
is stale — it is a record, not a specification.

Each packet is one commit and one annotated tag. To see exactly what a packet changed:

    git show packet-21-field-staff-auto-height
    git diff packet-20-hostname-separation..packet-21-field-staff-auto-height

Full completion reports for recent packets are in `docs/packets/`.

---

## Packet 28 — overview live chat with Teams bridge (2026-09-03)

Tag `packet-28-overview-live-chat` · report `docs/packets/packet-28-overview-live-chat.md`

Added an operator-gated Overview chat box with rooms General, Operations, Field,
Contractors, and Management. Messages are source-tagged (`northstar` / `teams` /
`system`). Teams pull/post is opt-in via `NORTHSTAR_TEAMS_MODE` and never invents
inbound traffic. Suite: 198 passed.

## Packet 26 — controlled engineering bundles and server revisions (2026-08-26)

Tag `packet-26-controlled-engineering-bundles` · report
`docs/packets/packet-26-controlled-engineering-bundles.md`

Added an operator-gated controlled ZIP export containing the switching package, append-only audit,
Packet 13 review evidence, attachment manifest and hashes, and exact stored diagram/procedure bytes.
Each export is audited and carries a whole-bundle SHA-256 response header. Reviewed packages remain
immutable; a new server revision action copies stored sources under new IDs while clearing diagram
revision, qualification evidence, reviewer identity/comments, and every review check. Reviewed UI
controls are locked until a new revision is created. The workflow still ends at REVIEW RECORDED -
NOT RELEASE. Suite: 153 passed.

## Packet 25 — durable engineering packages and schematic revisions (2026-08-26)

Tag `packet-25-engineering-persistence` · report
`docs/packets/packet-25-engineering-persistence.md`

Moved switching source files and one-line drawing revisions from browser-only state into the
operator-gated, backed-up SQLite record. Outages can open a prefilled Engineering package;
operators can search and reopen drafts from another browser; schematics can be saved as append-only
server revisions and attached directly to a package. Diagram/procedure uploads are extension,
content-type, signature, size, hash, and authentication checked. Drawing export now includes JSON,
SVG, PNG, and print/PDF. Ready-for-review now requires durable source records and a current server
schematic with a matching utility symbol-profile approval reference when a schematic is used.
Suite: 151 passed.

## Packet 24 — IEEE compatibility symbol library (2026-08-26)

Tag `packet-24-ieee-symbol-library` · report
`docs/packets/packet-24-ieee-symbol-library.md`

Expanded the graphical one-line builder from nine generic shapes to 21 searchable symbols grouped
by network, primary equipment, and measurement/protection. The profile distinguishes the familiar
IEEE/ANSI 315-1975 graphical convention, which IEEE marks inactive-reserved, from the active IEEE
C37.2-2022 device-function designations. Version-2 JSON exports carry the standards profile while
legacy local drafts remain loadable. The inspector now supports C37.2 numbers and suffixes, and a
pre-existing status update bug that broke selected-symbol inspection was corrected. Suite: 145
passed; authenticated live browser smoke passed.

## Packet 23 — recovered sanitised rich-text logbook editor (2026-08-26)

Tag `packet-23-logbook-rich-editor` · report
`docs/packets/packet-23-logbook-rich-editor.md`

Recovered the text editor behavior into the current email-style Logbook without restoring the
stale dashboard snapshot around it. Operators can apply bold, italic, underline, bulleted and
numbered lists, and block quotes. Content is allowlist-sanitised, remains on the existing
operator-gated `/api/logbook` route, and continues through the append-only hash-chained store.
Deprecated `execCommand`, executable markup, and inline image data URLs were not restored. Suite:
139 passed; authenticated live desktop smoke check passed on `ops.northstarenergy.ca`.

## Packet 21 — dashboard UI, layout zones and workspace modules (2026-08-13)

Tag `packet-21-field-staff-auto-height` · shipped build
`NorthStar-Field-Staff-Auto-Height-2026-08-13`

Zone-based layout with per-zone size snapping and stable `data-module-id` identity; the shipped
default layout used as the saved-UI reset target; Market, Events and one-line-editor surfaces;
Field Staff auto-height and two-station columns; IESO/APIROQ modules made freely positionable.
Suite: 127 passed.

## Packet 20 — hostname separation and worker safety (2026-08-13)

Tag `packet-20-hostname-separation` · report `docs/packets/packet-20-completion.md`

The origin now mirrors the Cloudflare edge rule instead of trusting it. Hostname rules run before
dispatch, so a new route is contained by default. 12 new tests, one of which parses the real
`SHELL` array out of `sw.js` so the allowlist cannot drift from what the worker app caches.

## Packet 19 — demo operator authentication (2026-08-13)

Tag `packet-19-demo-operator-auth` · report `docs/packets/packet-19-completion.md`

Local runtime credential with a salted scrypt verifier in gitignored
`data/.northstar-demo-auth.json`. No password reaches HTML, JS, git, Drive or logs. Server-validated
sessions, failed-login throttling, `ron` as the demo audit actor.

---

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
# 2026-09-11 — Flowchart and operations graphics builder

- Expanded the Tools flowchart prototype into a full diagram workspace with a larger shape and device library, configurable colors and connector styles, undo/redo, layering, zoom, local autosave, and JSON/SVG interchange.
- Details: `docs/packets/2026-09-11-flowchart-operations-graphics.md`.
- Verification: 209 tests passed.

# 2026-09-11 — Weather module layout repair

- Removed the override that expanded every Overview weather module and permanently exposed its forecast periods.
- Details: `docs/packets/2026-09-11-weather-module-layout-repair.md`.
- Verification: 209 tests passed.

# 2026-09-11 — Field tracker demo-data repair

- Restored a refreshable six-worker mock roster with site GPS points and current heartbeats for the Field Tracker and Mobile views.
- Details: `docs/packets/2026-09-11-field-tracker-demo-data-repair.md`.
- Verification: idempotent refresh confirmed; 209 tests passed.

# 2026-09-11 — Compact alarm indicator

- Replaced the large persistent Events card with an `Alarms (n)` button that pulses gently only for unacknowledged alarms and opens the full Events workspace.
- Details: `docs/packets/2026-09-11-compact-alarm-indicator.md`.
- Verification: 209 tests passed.

## 2026-09-28 — AI environment guidance
Versioned operational prompting, selected-section/site/time context, response-depth budgets, and incomplete-answer handling. Targeted checks: 26 passed. Backend restarted; authenticated UI check and coherent Git publication pending. See `docs/packets/2026-09-28-ai-environment.md`.
