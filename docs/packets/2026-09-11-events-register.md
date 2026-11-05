# Control room Events register — 2026-09-11

Events now opens a chronological register. Select an event to open its recorded details and related history. Operator log entry is a secondary action. Overview events also open the detailed history.

## Available behavior

- Search all recorded history, with server-side filters for type, source, severity, state at event, date range, site, equipment and actor. Filters apply before pagination, including records older than the former 250-row window.
- Snapshot pagination avoids duplicates or skipped records when new or late events arrive. A new-events notice allows the operator to refresh deliberately.
- History links by recorded object identity, or by provider plus message thread for communications. It does not infer incident relationships from similar titles or nearby times.
- Append-only operator notes preserve original records and never acknowledge, clear or otherwise change an alarm. The server supplies the authenticated actor. Retry IDs prevent duplicate notes after uncertain responses.
- Failed refreshes retain previously loaded results and identify stale data. The Overview feed no longer reports LIVE after a failed refresh.
- Source status shows recorded counts and last recorded times separately from connection status. Historical records are not proof of a working connection.

## Inputs

The register reads the existing shared audit ledger for operator logs, market alarms, workforce activity, outages, switching, field operations, voice and governance. SCADA import completion/failure is now recorded in the same transaction as its batch outcome. AI questions and configured-service answers or failures are recorded as linked, assistive-only conversation history.

Outlook and Teams use the existing disabled ingestion contract and remain **Setup pending**. No Microsoft credentials, subscriptions, collectors or message sending were enabled. Physical SCADA alarm ingestion and any other external feed still need their specific integration. This release does not claim external feeds are connected or provide an alarm acknowledgement workflow.

## Validation

Full Python suite: 189 tests. Targeted coverage includes pagination beyond 250 rows, timezone ordering, source/thread separation, immutable and idempotent notes, authenticated actor attribution, public-host refusal, AI failure capture, invalid cursors and missing events. Node checks cover escaping, failed-refresh retention, detail response races, note retries and existing dashboard layout behavior. No browser visual acceptance was performed.

## Activation required

The service listening on localhost:4180 is an older Python process. Windows rejected Stop-Process with **Access is denied**, so it was not restarted. The static UI files are available immediately; new backend endpoints require a restart of that existing service by its owning Windows account or an administrator. Until then the Events workspace displays a restart notice and leaves the existing logbook available.

The existing scheduled task is `NorthStar Control Room backend`; its action runs the canonical `start-northstar.ps1` with `-DemoLogin -NoBrowser -ServiceMode`. Preserve that gate and the published check-in origin. Stop the existing backend process, then run this existing task. ServiceMode alone will keep an already healthy old process running. Do not use Launch-NorthStar.cmd, which seeds data and changes launch settings.

After restart, sign in, open Events, apply a source filter, select a real record and inspect its history. Confirm source statuses and confirm that public check-in requests cannot access the register. No operational data or credentials are included in this release archive.

## Delivery

The archive is built from the tagged commit and contains the affected canonical source, Microsoft scaffold, tests and this report. Local destination: `outputs/events-register-2026-09-11/NorthStar-Events-Register.zip`. Drive destination: `Work Projects/NorthStar/Dashboard UI/Events Register - 2026-09-11`.
