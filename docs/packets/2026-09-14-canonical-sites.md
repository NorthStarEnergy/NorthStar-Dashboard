# Canonical station identity — 2026-09-14

Library station names and `site:{slug}` ids are now the single identity for operator dropdowns, outage writes, crew writes, and station event logs.

## Available behavior

- `northstar_sites.py` holds the 18 generating stations in catalog order (West, East, Quebec) plus **System / transmission**. It does not import the library or the store.
- Outage and operator crew writes store the canonical `site` name and `siteId`. Historical labels such as `Iroquois Falls GS` and `Iroquois Falls 230 kV` resolve to `site:iroquois-falls`.
- Library Outages, Operating Conditions, and station panes match `payload.siteId` **or** the canonical name **or** known aliases. An `Iroquois Falls GS` outage appears under Iroquois Falls and not under Twin Falls.
- `GET /api/sites` is operator-only (403 on the check-in hostname). The dashboard fills `#outageSite` (18 + System) and `#crewSite` (18 stations) from that route, with the same list as a fallback.
- Staff and crew cards group by canonical name. Extra sites with live check-ins (Timmins, Carmichael) still display. They are not added to the catalog.
- Worker QR strings and `contractor-checkin.html` are unchanged. When a worker site string resolves, the audit payload receives `siteId`.

## Inputs

No new feeds. Timmins, Carmichael, and Smooth Rock are not invented into the catalog. Maximo stays read-only. Notes still do not acknowledge alarms.

## Validation

Full Python suite: 241 passed. Coverage includes alias resolution, unknown-site passthrough, 18-station order, `/api/sites` 200 on ops / 403 on check-in, and an `Iroquois Falls GS` outage appearing only on the Iroquois Falls station log. Node check compiles `northstar-sites.js` and asserts the cache-busted script tags.

## Activation required

Python site, outage, check-in, and `/api/sites` changes need a backend restart. Static assets are `northstar-sites.js?v=20260914-1` and `outages-workspace.js?v=5`. Do not add either to the worker allowlist. Preserve `DemoLogin`, `NoBrowser`, `ServiceMode`, and the published check-in origin.
