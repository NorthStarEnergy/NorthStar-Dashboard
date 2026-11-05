# NorthStar Flows: live inflow integration

The Inflow Outlook tab is installed in both NorthStar build shells. It uses same-origin operator-only APIs and keeps forecast archives separate from operational records. It does not operate gates or change releases.

Activation requires an administrator restart of the existing NorthStar backend. The current Python process rejected a normal stop with Windows “Access is denied.” The existing service remains healthy. Do not launch a competing server or disable authentication to work around this.

Once the backend restarts, its scheduler launches the worker every five minutes. The worker reads committed Water Log and WSC records, refreshes GFS/antecedent weather and LWCB balances every six hours, checks for changed EAST/WEST workbooks, and issues a forecast when usable daily inputs change. It archives each issued run and scores it when actuals become available. A restart catches up without requiring an open browser. The existing daily Codex follow-up now checks this integrated installation and refreshes it if overdue.

## Input roles

| Target | Current connection | Additional requirement |
|---|---|---|
| Kap OWF | WSC 04LF001 discharge × 0.836, matching workbook | Complete hourly coverage for each daily mean; model retrained without forebay level |
| Rainy | LWCB daily balance and Namakan releases | Fresh public report or corresponding Water Log records |
| Namakan | LWCB daily balance | Fresh public report or corresponding Water Log records |
| Lake of the Woods | LWCB daily balance and Rainy releases | Baseline only; rainfall model did not justify operational selection |
| Raft | Water Log Raft Lake INFLOW and ELEVATION | Seven consecutive completed days plus comparable level change |
| Calm total | Calm Lake INFLOW and ELEVATION | Valerie Lake OUTFLOW |
| Sturgeon total | Sturgeon Falls INFLOW and ELEVATION | Calm Lake OUTFLOW |
| Black local | Iroquois Falls INFLOW minus Twin Falls OUTFLOW | Both same-day records; accounting residual, not independent Black River gauge |
| Island local | Island Falls INFLOW minus Iroquois and Frederick House OUTFLOW | All same-day records; residual can be negative |
| Lake Abitibi | Lake Abitibi INFLOW and ELEVATION | Fresh complete daily tracking |
| Lake Nipissing | Lake Nipissing INFLOW and ELEVATION | Lake inflow, not Okikendawt/Dokis plant discharge |

Water Log selects the latest appended correction per Toronto calendar day and explicit metric. Inflow/release units must be m³/s and levels must be metres with comparable datum/source conventions across days. Records should represent the existing daily tracking values, not arbitrary instantaneous samples. Forecast-type records and incomplete current days are excluded. Other public gauges remain context; generic PostgreSQL `ns_data.water.flow_m3s` has no verified inflow role and is not silently imported. The production `ns_water.observations` table supplies the Kap proxy. The Water Log was empty at installation.

## Persistence and maintenance

Private runtime configuration: `data/.northstar-inflow.json`. Engine: `data/inflow-engine`. Forecast SQLite database, immutable run/model/provider archives, weather history, latest snapshot and worker log: `data/inflows`. Original uploaded/recovered workbooks remain unchanged. Bundled Python provides numpy/pandas; the private engine contains the existing psycopg adapter dependencies. No database password is copied into the new configuration.

The HTTP backend only reads bounded saved outputs and launches a worker; it never performs weather downloads or model fitting on an HTTP request thread. Duplicate starts are suppressed in-process; the forecast engine also has a SQLite refresh lease. Failed refreshes preserve the prior archive, expose an error, and retry on the next scheduler tick. Old forecasts and overdue checks are visibly labelled. The public check-in hostname and restricted demo accounts cannot access the forecast API.

`shadow-ridge-positive-rain-v2.3-live` omits the unavailable Kap forebay-level feature in both training and prediction. All other model features retain their prior definitions. The chronological diagnostic was recomputed. New public/gauge/Water Log records initialize and score forecasts but are excluded from workbook-only model training. Kap uses the historical proxy rather than a direct plant inflow measurement.

## Verification and limits

Four current outlooks were generated: Kap, Rainy, Namakan and LOTW baseline. Seven other targets correctly remain unavailable for lack of fresh inflows. Adapter tests cover daily completeness, DST, nulls, corrections, upstream requirements, negative residuals and duplicate scheduling. Browser checks cover same-origin Flows embedding, tab switching, archived runs, horizons, mobile layout, CSV export and private-file denial. HTTP tests verify authenticated dispatch and public-host refusal. Full-suite results and final source hashes are recorded in DELIVERY.md.

Historical tests use realised weather, not issued 14-day forecasts. Live skill is unproven; error ranges are historical residual envelopes, not calibrated probability bands. No calibrated snowmelt or changing release-plan model is available. Wetness is a reanalysis proxy, not a field measurement of saturation. These remain shadow forecasts.

Verified results: 19 model tests, 14 adapter/scheduler tests, 5 HTTP access tests and 18 browser checks pass. Full suite: 515 passed, 21 skipped, 347 subtests passed, with the existing 4 failures and 8 errors (missing baseline schema/legacy server source and two research static contracts). Run Activate-Inflow.ps1 from an administrator PowerShell to perform the remaining restart using the existing NorthStar scheduled task.
