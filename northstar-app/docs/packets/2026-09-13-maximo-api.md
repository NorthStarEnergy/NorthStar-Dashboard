# Maximo station API — 2026-09-13

Each generating station in the Tools Library now has a read-only Maximo API. The origin queries Maximo OSLC object structures by mapped `siteid` and `location`. It does not write work orders, change asset status, or acknowledge alarms.

## Available behavior

- `GET /api/maximo` lists every library station and reports whether Maximo credentials are present. Configuration alone is never reported as a successful connection.
- `GET /api/maximo/station?id=site:…` is the per-station read. Unconfigured stations return empty asset and work-order collections with **Setup pending**.
- When `NORTHSTAR_MAXIMO_URL` (HTTPS) plus an API key or username/password are present, the station endpoint reads `mxapiasset` and `mxapiwo` (names configurable) and returns bounded, normalized fields only.
- Station records include a `maximo` pointer. The Library detail pane shows the Maximo state under a selected generating station.
- Credentials live in environment variables or `data/.northstar-maximo.json`. `maximo.example.json` has no secrets and is not a live loader.

## Limits

No Maximo tenant is connected in this release. The API is the contract and the operator-gated read path. A future authorized setup supplies the HTTPS host and credential on the operator PC. This origin still does not POST, PATCH, or delete in Maximo.

## Validation

Full Python suite: 225 passed. Coverage includes setup-pending empty collections, no invented records, status not probing Maximo, mocked OSLC reads, HTTP URL refusal, secret redaction, and public-host 403. Library item responses carry the station href.
