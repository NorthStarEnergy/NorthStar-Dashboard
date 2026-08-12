# Northstar live data

Double-click `start-northstar.bat` on the host PC. It starts
`http://localhost:4180` and exposes:

- `/api/market-prices` — IESO real-time energy LMP and APIROQ 10S/10N/30R operating reserve prices
- `/api/weather` — Open-Meteo current conditions for the grouped operating areas

The IESO source reports are public and refresh on the IESO schedule. On a cold
start, operational APIs are ready first and the external feeds warm in the
background. The dashboard opens from the same local server.
