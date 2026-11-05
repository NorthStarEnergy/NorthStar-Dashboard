# Dashboard review and first implementation steps

## Assessment

The canonical Python/SQLite operator dashboard has substantial working record
workflows and regression coverage. It is not yet a verified professional
production release. The public Vinext landing shell, operator dashboard and
separate outage-stitch app remain distinct products/runtime surfaces.

Scope: source and configuration review across navigation, workspace scripts,
backend services, authentication, backups, integration state and tests. This
is not a completed visual/accessibility audit, external penetration test or
operator acceptance exercise. No live records were modified for this review.

## Prioritized findings

| Priority | Finding and evidence | Required work and acceptance |
|---|---|---|
| P1 | Connectivity overlay defaults to `http://127.0.0.1:43147` (`outages-workspace.overlay-from-git.js:7`). On another operator's computer this addresses that computer. | Configure an approved reachable deployment, show unavailable state when absent, and verify outage IDs map to the same records. A button opening a separate app does not establish synchronized data. |
| P1 | Access mode checks a header at the origin; protections rely on loopback binding and hostname separation (`ieso_backend.py`). | Verify real edge login/policies and plan cryptographic identity validation and roles. Do not expose a non-loopback origin with the current trust model. |
| P1 | No repository CI workflow existed; Python-only runs omit five JavaScript suites. | First step implemented: Windows CI for Python, JavaScript, preflight and isolated HTTP checks. Require its successful status in branch protection after a completed hosted run. |
| P1 | Release verifier used `assert`, removable under `python -O`. | Fixed with explicit failure checks; regression verifies an unexpected HTTP 200 fails under optimization. |
| P1 | Service runbook documents at-logon recovery; full unattended restart/reboot and alert delivery are not proven by HTTP smoke checks. | Staging restart/reboot drill, external uptime checks with tested alert delivery, documented owner and rollback procedure. |
| P1 | Backup check proves SQLite structure, not restoration of all application workflows and attachments. | Rehearse restored application reads/migrations and recovery of controlled sources and voice files; define recovery objectives and off-host retention. |
| P2 | Dispatch defaults to simulated data (`northstar_dispatch.py`); client labels it simulated (`dispatch-client.js:108`). | Retain explicit labels, configure production simulation policy and validate real read-only telemetry before operational reliance. |
| P2 | Field UI renders SERVER CONNECTED before fetch, clears prior records on refresh failure and parses local drafts without error handling (`field-operations-workspace.js`). | Add connecting/stale states, preserve last successful data, tolerate corrupted local storage, and verify offline draft persistence and retry. |
| P2 | Field station intake is free text while outage/library use canonical site IDs. | Apply the canonical station selector and identity contract to field records with backward-compatible handling of historical records. |
| P2 | One-line catalogue label was placed inside a container replaced by palette rendering (`northstar-clean.html:541`, `one-line-editor-ui.js:148`). | Move version/source labels outside the dynamic palette and verify rendered controls, exports and revision recovery in a browser. Static-string tests missed this. |
| P2 | Maximo, Teams/Outlook and transcription have explicit setup-pending/off modes. | Track each integration separately: credentials, source owner, permissions, failure/retry handling and readback acceptance. Passing endpoints does not prove live integration. |
| P2 | Large inline dashboard scripts coexist with external overrides; source-only tests cannot prove all click paths. | Add browser scenarios for login, outage-to-draft, field submit/retry, log notes, library navigation and one-line save/export. Confirm active handler/load order before refactors. |
| P3 | Training section is a placeholder; layout preferences are browser-local. | Keep incomplete features clearly marked. Prioritize role-specific onboarding, keyboard navigation, responsive layouts and account preference synchronization after core workflows. |

## Workspace coverage and next validation

| Area | Current evidence | Next acceptance scenario |
|---|---|---|
| Overview/layout | Canvas, overview migration and script compilation tests pass | Drag/resize, refresh and recover layout on desktop/mobile |
| Markets/weather/dispatch | Backend tests and simulation/source contracts exist | Feed outage, stale data, recovery and truthful timestamps |
| Crew/mobile/check-in | Workflow, safety and hostname security regression suites | Phone lock/background behavior, failed help delivery, session isolation |
| Events/logbook | Ledger, integrity, event navigation and JS race/escaping suites | Concurrent notes and safe failed-request retry |
| Outages/UWPC/switching | Durable SQLite drafts, controlled-source and workflow tests | Link real source records, clone/revise, review evidence and export; no permit issuance |
| One-line editor | Catalogue/runtime tests | Actual rendered palette, saved revision and SVG/PNG/print exports |
| Field/readiness | Report/action/governance backend coverage | Offline recovery, retained stale data, canonical site identity |
| Library/Maximo | Station/library tests and honest pending states | Notes expiry and real authorized Maximo readback |
| Chat/voice/AI | SQLite chat, voice safety and AI tests | Real connector delivery, citation/source validity, disclosure and retention |
| Landing/deployment | Build/preflight and isolated HTTP verification | Hosted CI, staging edge login, reboot and rollback |

## First steps implemented

- Added `.github/workflows/dashboard-regression.yml` with read-only repository
  permissions, bounded runtime and action revisions pinned to resolved commits.
- Runs Python regression, all five existing Node suites, preflight, and the
  isolated runtime verifier under optimization. No deployment or secrets needed.
- Replaced removable release assertions with explicit status failures.
- Added a regression that deliberately supplies the wrong status under `-O`.

The workflow does not yet build the Vinext shell or run browser automation.
Those are follow-on gates; a green regression job must not be described as
complete deployment acceptance. The existing local landing build remains a
separate release check.
