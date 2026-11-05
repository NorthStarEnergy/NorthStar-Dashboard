# Station whiteboard menus — 2026-09-13

Each generating station now follows the Twin Falls whiteboard: **Operations**, **Equipment**, **Data**, **Notes**, and **Reports**.

## Available behavior

- **Operations** — Operating Conditions, Operating Instructions, Field Notes.
- **Equipment** — Maximo Database first, then Powerhouse, Switchyard, Protection & Control, Waterways, and Station Service.
- **Data** — Water, Pond, Operating Data, Historical.
- **Notes** — append-only station notes that may expire at a time or persist on a date. Expired notes stay on the record.
- **Reports** — Daily Production, Flows, Outages, Forecasting.
- Pending leaves stay **Setup pending**. They do not invent readings, production, flows, outages, or forecasts, and they do not command equipment.
- Maximo remains read-only on **Maximo Database**. It does not write work orders or acknowledge alarms.
- Notes still do not acknowledge, clear, or change an alarm.

## Validation

Full Python suite: 227 passed. Coverage includes the Twin Falls menu order on all 18 stations, Maximo attached only to the station and Maximo Database, pending leaves with no invented readings, and expired notes remaining queryable.

## Activation required

Python catalog and note-column changes need a backend restart. Static Tools assets are `device-library.js/.css?v=20260913-4`.
