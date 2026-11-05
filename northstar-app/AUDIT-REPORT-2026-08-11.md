# Northstar Control Room — Whole-System Audit

**Audit date:** 2026-08-11 08:04 EDT
**Scope:** Canonical Northstar runtime in this project folder, SQLite persistence, worker/mobile check-in flow, operator UI/modules, switching workspace, deployment topology, backup posture, and automated regression coverage.
**Method:** Read-only source inspection, local health checks, public-host HTTP checks, SQLite integrity checks, service inspection, and test/static validation. No production changes were made.

## Executive conclusion

The system is functioning as a capable internal pilot, but it is **not ready for safety-critical or unrestricted public operation**. The release is blocked by one immediate exposure: the public check-in hostname currently returns the operator roster without Cloudflare Access authentication. The root cause is a hosted runtime configuration mismatch: the backend gate is designed and tested, but the running service is using the default `NORTHSTAR_OPERATOR_GATE=off`.

The second major concern is operational resilience. The life-safety workflow is explicitly advisory: browser heartbeat can stop when a worker's phone locks, and external notifications are still in shadow mode. Local backups are healthy, but there is no configured off-host mirror or demonstrated restore drill. The canonical runtime source is also largely outside Git, which makes the hosted system difficult to reproduce or safely roll back.

### Release decision

**RELEASE BLOCKED** until findings F-01 through F-06 are addressed and the acceptance checks below pass from an external network. The current build can continue as a controlled pilot only with the perimeter corrected and the known life-safety limitations explicitly accepted by the responsible operator.

## Severity scale

- **P0 — release blocker:** active exposure or condition requiring immediate containment.
- **P1 — high risk:** must be remediated before continued production/safety reliance.
- **P2 — material hardening:** important reliability, privacy, maintainability, or governance work.

## Findings

### F-01 — P0: Public check-in host exposes the operator roster

**Observed:** `GET https://checkin.northstarenergy.ca/api/checkins` returned `200 OK` without an Access identity. The response contained six current records and operator-facing fields such as names, sites, status, check-in times, overdue state, and help state. A single-record request using a returned identifier also returned `200 OK`.

**Why it matters:** The public worker hostname is exposing control-room roster data. The roster route is intended to be operator-only and can contain location and safety-state information. This is an active privacy and operational-security exposure.

**Root cause:** The hosted process is using the safe-for-local-development default in [start-northstar.ps1](<C:/Users/Ryan1/Documents/Work Projects/control-room-dashboard/start-northstar.ps1:103>): `NORTHSTAR_OPERATOR_GATE` defaults to `off`. The application gate itself is present in [ieso_backend.py](<C:/Users/Ryan1/Documents/Work Projects/control-room-dashboard/ieso_backend.py:690>) and is designed to return `403` for operator routes without the Cloudflare Access JWT, but it only engages when the environment is exactly `access`.

**Immediate remediation:** Set `NORTHSTAR_OPERATOR_GATE=access` in the actual service/startup environment, restart the backend, and remove the possibility of silently starting the hosted process with the local-only default. Do not rely on the tunnel path rule alone because `GET` and `POST` share `/api/checkins`; the application must distinguish operator GET from worker POST.

**Acceptance test:** From an external network, unauthenticated GET requests to `/api/checkins`, `/api/checkins/history`, `/api/checkin-tokens`, and `/api/logbook` return `403`; worker `POST /api/checkins` still works; an authenticated operator session can load the dashboard and the gated APIs.

### F-02 — P1: Worker record endpoint is not an authorization boundary

**Observed:** [ieso_backend.py](<C:/Users/Ryan1/Documents/Work Projects/control-room-dashboard/ieso_backend.py:799>) intentionally leaves `GET /api/checkins/<id>` open so a worker device can poll its own record. The code comment acknowledges that this route is public by design.

**Why it matters:** Anyone who obtains or guesses a check-in identifier can request the record. The response model is capable of carrying worker status, help state, and GPS fields. A worker ID is not a credential.

**Remediation:** Add a short-lived, signed worker-device token bound to the check-in ID and accepted only for that worker's GET/heartbeat/checkout/help operations, or introduce an equivalent capability-token design. Avoid putting sensitive operator fields in the worker response. Add tests for wrong-ID and expired-token access.

### F-03 — P1: Hosted runtime, source control, and deployment provenance are disconnected

**Observed:** The canonical folder contains only **7 tracked Git files**, approximately **149 untracked entries**, and the current runtime source, tests, documentation, and database-adjacent operational files are not committed. The Sites project has no live URL and its only recorded version is an older starter commit, while the actual hosted path is the local Python service behind the automatically running `Cloudflared` Windows service.

**Why it matters:** There is no dependable source-of-truth commit for the system currently serving operators. A rollback, peer review, incident reconstruction, or clean rebuild could select the wrong starter project or omit the working runtime.

**Remediation:** Put the canonical runtime, tests, deployment configuration, and runbook under Git; exclude logs, screenshots, local exports, and generated artifacts; protect the main branch; run tests in CI; tag the exact deployed commit; and make the deployment process consume only that artifact. Reconcile the Sites project so it is either clearly retired or explicitly mapped to the canonical source.

### F-04 — P1: Life-safety status is advisory, not a reliable alarm path

**Observed:** The worker heartbeat is a browser `setInterval` at 300 seconds in [contractor-checkin.html](<C:/Users/Ryan1/Documents/Work Projects/control-room-dashboard/contractor-checkin.html:63>). The runbook correctly notes that a phone lock, browser throttling, or process termination can stop it. The live health response reports `externalNotifications` as `shadow`; there is no verified SMS/email/Teams delivery path. The live SCADA feed reports waiting/no readings.

**Why it matters:** An overdue card or dashboard alarm cannot be treated as proof that a lone worker is safe or that an urgent notification was delivered. A stalled browser may look like an overdue worker, and a shadow notification only records what would have happened.

**Remediation:** Keep the UI language explicitly advisory; require direct emergency procedures and operator escalation. Before safety reliance, add a server/device supervision design that does not depend on a foreground browser timer, implement a real notification connector with delivery/acknowledgement evidence, and test end-to-end failure paths. Keep the SCADA state visibly `UNAVAILABLE/WAITING` until a real feed is connected.

### F-05 — P1: Recovery is local-only and has not been restore-tested

**Observed:** There are 12 local daily database backups, and all 12 pass `PRAGMA integrity_check`. The live health snapshot reports `backupMirrorConfigured=false`. No off-host mirror or completed restore drill was evidenced.

**Why it matters:** A disk failure, ransomware event, or host loss can remove the database and its backups together. SQLite integrity proves file consistency, not recoverability of the service, secrets, or operational configuration.

**Remediation:** Add encrypted off-host backups with retention and access controls, include the QR secret and deployment configuration through a documented secret-recovery process, and perform a scheduled restore into an isolated instance. Record restore time, row-count checks, and a successful health/test result.

### F-06 — P1: Public health endpoint discloses internal operational details and CORS is wildcarded

**Observed:** `GET https://checkin.northstarenergy.ca/api/health` returned `200 OK` without authentication. Its response includes database, market, weather, SCADA, notification-mode, and check-in-origin objects. The SCADA feed object includes a `sharePath` field; the public response therefore exposes an internal Windows-path-shaped value. The check-in API also returned `Access-Control-Allow-Origin: *`.

**Why it matters:** Health status is useful for a worker shell, but detailed diagnostics and filesystem metadata are not required on the public host. Wildcard CORS increases the number of browser contexts that can read the response.

**Remediation:** Split health into a minimal public liveness response and an operator-gated diagnostic response. Redact filesystem paths, error details, and internal counts from public output. Set an explicit allowed-origin policy for the worker app; do not use `*` in the hosted configuration.

### F-07 — P2: Phone-verification request path lacks abuse throttling

**Observed:** Phone verification codes expire and individual codes have an attempt limit, but the request endpoint can create new verification records repeatedly for valid QR tokens. No IP, phone, token, or device rate limit was evidenced.

**Why it matters:** In shadow mode this is primarily a database/CPU abuse path; when SMS delivery is connected it can become an SMS-cost and nuisance-notification path.

**Remediation:** Add request throttles by token, normalized phone, source address, and time window; cap active requests per token; add audit metrics and a safe operator override. Keep the current short expiry and attempt limit.

### F-08 — P2: Switching workspace has a good release boundary, but not a controlled document record

**Observed:** The switching workspace synchronizes draft metadata and review state to operator-gated endpoints. Its durable states are `DRAFT`, `READY FOR QUALIFIED REVIEW`, and `REVIEW RECORDED · NOT RELEASE`; reviewed packages are immutable and no equipment-command path was found. Source diagram bytes remain local to the browser, as documented in [switching-workspace.js](<C:/Users/Ryan1/Documents/Work Projects/control-room-dashboard/switching-workspace.js:355>).

**Why it matters:** Metadata-only synchronization prevents the server from being mistaken for an approved engineering-document repository, but it also means another operator cannot reliably retrieve the exact source diagram used to prepare a form. There is no evidence here that the generated form is a legally or procedurally sufficient UWPC/EUSR switching order.

**Remediation:** If controlled records are required, add approved document storage, versioning, retention, access logging, and hash binding between the source diagram and generated draft. Keep qualified-person approval separate from system-generated suggestions. A separate authoritative compliance review is required before treating the workflow as a UWPC or life-safety approval system.

### F-09 — P2: Operator layout edits are browser-local and can diverge between consoles

**Observed:** Shared module layout and overview movement/size state use browser `localStorage` in [module-layout.js](<C:/Users/Ryan1/Documents/Work Projects/control-room-dashboard/module-layout.js:35>) and [northstar-clean.html](<C:/Users/Ryan1/Documents/Work Projects/control-room-dashboard/northstar-clean.html:471>). This supports the requested per-module movement/resizing, but it does not synchronize layout state to the server or to other operator browsers.

**Why it matters:** Two operator consoles can show different placement, sizing, or visibility assumptions. A saved layout is a workstation preference, not a shared operational configuration.

**Remediation:** Label layouts as local preferences, provide a visible reset/export option, and add server-backed named layouts only if a shared console layout is operationally required. Do not let layout state affect safety logic.

### F-10 — P2: Runbook and handoff documentation are stale relative to the hosted system

**Observed:** [DEPLOY-RUNBOOK.md](<C:/Users/Ryan1/Documents/Work Projects/control-room-dashboard/DEPLOY-RUNBOOK.md:9>) says nothing is routed publicly and leaves the gate off, while the host is now routed and serving the check-in API. [AGENTS.md](<C:/Users/Ryan1/Documents/Work Projects/control-room-dashboard/AGENTS.md:89>) records an older `61 passed, 1 failed` baseline; the current suite is 66 passing. These contradictions make it easy for the next operator or agent to repeat the unsafe deployment state.

**Remediation:** Update the runbook to describe the actual hosted topology, add a required fail-closed startup check, record the current test baseline, and make the canonical-source rule prominent in the handoff. Remove or clearly label superseded starter/handoff material.

## Controls that passed the audit

- The local Python test suite passed: **66 passed**.
- Python compilation passed for the backend, store, and safety module.
- JavaScript syntax checks passed for the mobile dashboard, module layout, switching workspace, weather cards, and service worker using the bundled Node runtime.
- The local database reported SQLite integrity `ok`; the backend session enables foreign keys and uses WAL mode.
- All 12 available local database backups passed SQLite integrity checks.
- The `Cloudflared` Windows service is present, running, and configured for automatic start.
- The operator hostname redirects to Cloudflare Access; the separate public check-in hostname is the path that currently bypasses the application gate because the runtime gate is off.
- The public path configuration did not expose the dashboard HTML, backend source, or database file through the check-in hostname.
- The service worker intentionally bypasses `/api/`, so check-in, heartbeat, help, and checkout failures are not silently queued as successful actions ([sw.js](<C:/Users/Ryan1/Documents/Work Projects/control-room-dashboard/sw.js:42>)).
- QR tokens use signed/expiring/revocable records; phone codes use a bounded lifetime and attempt count.
- Dynamic mobile-dashboard fields are escaped before insertion, reducing the obvious XSS risk in the roster UI.
- Switching review state is separated from operational release and does not issue equipment commands.

## Test and evidence record

| Check | Result |
|---|---|
| `python -m pytest tests -q` | 66 passed |
| Python compile checks | Passed |
| JavaScript syntax checks | Passed with bundled Node |
| Current database integrity | `ok` |
| Backup integrity | 12/12 passed |
| Public `checkin/api/checkins` without Access | **200 — finding F-01** |
| Public `checkin/api/health` without Access | 200 — finding F-06 |
| Public `ops` root without Access | 302 to Cloudflare Access |
| Cloudflared Windows service | Running / Automatic |
| Off-host backup mirror | Not configured |
| External notifications | Shadow mode |
| SCADA | Waiting/no readings |

## Remediation order

1. **Contain F-01 immediately:** enable the operator gate in the actual hosted process, restart, and verify the external status matrix.
2. **Close F-02 and F-06:** protect worker record capability access; minimize/redact public health; pin CORS.
3. **Make the system reproducible:** commit the canonical source and tests, add CI, tag the deployed commit, and reconcile the Sites starter project.
4. **Address safety operations:** make the advisory nature visible, implement and test real notification delivery, and keep SCADA unavailable until its feed is proven.
5. **Establish recovery:** configure encrypted off-host backups and complete a documented restore drill.
6. **Harden and govern:** add verification throttles, controlled switching-document retention if required, and update all runbooks/handoff instructions.

## Limitations

This audit did not approve a switching order, certify UWPC/EUSR compliance, or validate a qualified person's credentials. It assessed the software controls and deployment state visible in the canonical project and reachable hosts. An authenticated Cloudflare Access operator session was not exercised from the shell; the public unauthenticated boundary and local application behavior were tested separately. No production changes were made.
