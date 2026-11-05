# Inflow activation

## Request
Perform the administrator restart and verify automatic inflow updates on Flows.

## Changes
Administrator restart replaced backend PID 21408 with 42156. Corrected explicit UTF-8 reading of forecast snapshots; no model coefficient or source-record changes. Existing authentication and worker-host isolation retained.

## Verification
Authenticated Flows displays current forecasts, Kap's collected gauge source and 7/14-day horizons. Source check advanced from 2026-10-27T07:07:35.49747-04:00 to 2026-10-27T07:12:35.605478-04:00 automatically. The page showed the changed timestamp without manual refresh. Four outlooks, ten complete Kap days, zero source errors. Thirty-nine focused Python checks pass; prior full-suite baseline and browser checks are unchanged.

## Runtime
ACTIVE. The backend checks sources every five minutes and weather every six hours. Forecasts recompute when usable inputs change; unchanged inputs do not create duplicate runs. The page polls every two minutes.

## Recovery
UTF-8 code preimage: workspace private-preimages/20261027-inflow-activation/pilot.py. No operational data was changed. Preserve the forecast archives.

## Delivery
Source 7df3399e5101fbe757a80a3d61bb0f8e94f6ea68; tag packet-20261027-inflow-activation. [Source-only Drive archive verified](https://drive.google.com/file/d/1nzodKVMEDCijrldzqGtFwTdZpBINFufD/view?usp=drivesdk). Existing GitHub publication remains unavailable because no GitHub remote is configured.

## Limits
Seven targets still lack fresh inflow records. The existing shadow-model limitations remain; activation does not establish prospective accuracy.
