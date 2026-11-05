# Location weather and water modules — 2026-09-30

## Delivered behavior
All eight existing weather locations open individual full-page modules through the shared Weather module tree or a single click on a Weather location card. Pages show current conditions, the next 24 hours, up to 14 days of forecasts, precipitation, selectable modeled weather history, current river gauges, and selectable gauge history with CSV download. Modules load on first selection and use the existing tab and window controls.

## Connector coverage
- Iroquois Falls: Abitibi basin; active Onakawana downstream context plus discontinued Iroquois and Twin Falls historical gauges.
- Atikokan: Atikokan River live gauge and Seine River at Sturgeon Falls published history.
- Kapuskasing: Kapuskasing River at Kapuskasing.
- Dokis FN: Little French River / Okikendawt Island, French River outlet, Lake Nipissing West Bay and North Bay.
- Fort Frances: Rainy Lake, Rainy River, Namakan, Lac La Croix (existing source mapping retained).
- Kenora: Kenora and Norman forebays/tailraces plus Keewatin (existing source mapping retained).
- Oshawa: Oshawa Creek. Toronto: Don River at Todmorden.

Official metadata: https://api.weather.gc.ca/collections/hydrometric-stations/items
WSC reference: https://wateroffice.ec.gc.ca/station_metadata/reference_index_e.html
Weather: https://open-meteo.com/en/docs and https://open-meteo.com/en/docs/historical-weather-api

River assignments are basin-context mappings, not new internal plant telemetry. Every water level retains its provider datum. No sea-level conversion or missing-value estimation is applied. Flow is shown only when reported. No river-level forecast provider is configured. Weather forecast horizon remains the existing 14-day maximum; historical weather is modeled reanalysis, with five days allowed for source lag. History requests are bounded to 366 days; older WSC ranges use published daily means and can omit recent/unfinalized dates.

## Changes
- module-workspace.js / .css: eight shared module registrations, single-click navigation, lazy page frames.
- weather-location.html / .js / .css: full page, date-range weather history, precipitation, missing-data corrections, location navigation.
- weather-location-water.js: current gauges, gauge history, provenance, partial failures, CSV.
- northstar_water_elevations.py: location mappings, additional WSC stations, historical-only handling, discharge.
- tests/test_water_elevations.py and tests/weather-location.browser.cjs: regression coverage.
- Build metadata incremented by the release script and commit hooks (v0.169). Concurrent changes were preserved.

## Verification
30 targeted Python tests passed (water elevations and flows). Browser regression passed all eight pages, card navigation, tab reopening, lazy loading, missing and zero readings, CSV invalidation, independent source failures, and mobile-width error states. Live official API checks returned current readings for 19 gauges across all eight locations; three additional gauges correctly remained historical-only. Canonical port-4180 source identity was verified against served JavaScript, then the backend was restarted with the existing demo-login gate.

## Remaining boundaries
Authenticated production verification passed after sign-in: Kenora forecast, modeled weather history, five live gauges and a 1,845-reading historical query with CSV enabled. Desktop screenshot inspected. Forecast paging controls are preserved. GitHub fetch is blocked by an existing invalid local ref: refs/heads/main (1). No unrelated refs, source changes, credentials or operational records were modified to bypass that problem.

GitHub publication was rejected by automatic approval review because it considered the destination unverified and publishing authorization insufficient. Local commits and the requested Drive delivery are retained.
