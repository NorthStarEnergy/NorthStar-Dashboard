# Event log navigation — 2026-09-13

Every recorded event, report, alarm and library note now has a bookmarkable event report. Overview, Events, station menus, outages and market alarms open that same page.

## Available behavior

- `northstar_events.record()` includes `href` (`event-detail.html?id=`). Register, detail, `/api/events`, library notes, outages and market alerts carry the same link.
- Library notes dual-write the ledger as `library.note.added` with category `library`. Each note row has **Open event report**.
- Station **Outages** lists recorded outage events for that exact site. **Operating Conditions** lists recorded site alarms. Station and item panes show those rows; they stay empty until a real write exists. Daily Production, Flows and Forecasting still invent nothing.
- Outage writes use `source=outage` (legacy `outages` rows still classify as Outages).
- Overview stream rows, Events register rows, outage cards and market alarm banners are real links. Notes still do not acknowledge or clear alarms.

## Inputs

No new feeds. Weather observations and dispatch telemetry remain unarchived. Outlook/Teams remain Setup pending. Maximo stays read-only and does not invent work orders.

## Validation

Full Python suite: 230 passed. Coverage includes report hrefs on ledger rows, library classification, outage category, exact-site station event lists, and public-host refusal of operator event routes. Node checks cover register navigation and library event-report links.

## Activation required

Python ledger and library query changes need a backend restart. Static assets are `device-library.js/.css?v=20260913-5`, `events-register.js/.css?v=20260913-5`, and `outages-workspace.js?v=4`.
