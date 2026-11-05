# Event reporting pages — 2026-09-11

The Events register now opens a dedicated, bookmarkable event report. Overview event links open the same page. Search and source/category/severity/state/date/site/equipment/actor filters continue to run on the server; selected filters are retained in session storage when returning to the register.

The responsive report includes occurrence and recording timestamps, category, severity, recorded state, source, actor, site, equipment, object identity, correlation and cause identifiers, full recorded fields, and safe original-message links. Object history, matching occurrences and explicitly linked events have independently selectable, snapshot-paginated views. Each history entry links to its own report.

Recurrence counts require the same source, object (or provider thread), event type and state; notes are excluded. Previous occurrences means strictly earlier occurrence times, not insertion order. First/latest occurrence timestamps are computed across the snapshot, not only the visible page. Linked events require explicit causation or same-source correlation; similar titles and nearby timestamps do not assert incident relationships.

Operator notes remain immutable and idempotent, with server-attributed authors and no alarm state changes. The report escapes untrusted content and inherits the session guard; data APIs remain operator-only, and report assets are denied on the public check-in hostname.

## Collection coverage and limits

The shared audit ledger covers operator logs, market alarms, workforce, outages, switching, field operations, voice, governance, SCADA import outcomes and assistant conversations. This release reads the entire ledger using server-side filtering and pagination. It does not invent records for unconnected systems. Outlook and Teams remain setup pending; physical SCADA feeds still need integration. Weather observations and dispatch telemetry are not archived in the event ledger; the source inventory now exposes that gap. This is not yet complete collection of every telemetry system.

## Validation and activation

Python suite: 211 passed. Node register and detail tests cover escaping, retained results, navigation, response races and safe note retries. No browser visual acceptance was performed.

Windows refused stopping the existing Python process on port 4180 (Access is denied). Stopping/starting the existing scheduled task left that process unchanged. An administrator or its owning account must restart the canonical backend while preserving DemoLogin, NoBrowser, ServiceMode and the public hostname protections. New static pages are on disk; new recurrence and linked-history behavior needs this restart. Existing backend responses show an explicit restart notice rather than incorrect linked histories.

## Delivery

Local archive: outputs/event-reporting-2026-09-11/NorthStar-Event-Reporting.zip. Drive: Work Projects/NorthStar/Dashboard UI/Event Reporting - 2026-09-11. Source only; no live databases, records or credentials.
