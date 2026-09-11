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
