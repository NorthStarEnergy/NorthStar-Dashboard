# Latest report readings and weather order — 2026-10-24

## Request
Use each location's latest available readings when generating reports, not a 07:00 window. Show weather snippets in daily-report order.

## Changes
WSC queries newest observations and USGS uses latest-continuous (00065 gauge height retained). NOAA chooses the newest valid GOOD Raft transmission; receipt and observation times remain separate. Temperature selects latest nonfuture valid observation from a 30-day query. Precipitation uses latest published completed daily totals, preserving dates and trace/zero distinction. Older water readings (>6h) and daily totals (>2 days old) are labelled. Corrected corrupted Celsius/French month literals. CSV includes ages, receipt time and reporting-period notes. Forecast slots sort by workbook row; concurrent captures persist that order. UI also sorts historical captures by the verified report order.

## Verification
Five regression tests and browser UI checks pass. Live collection: all eight previously missing water levels recovered, Raft collected, Monetville October 19 total clearly marked older; 19 collected, 3 provider errors and 2 access-blocked forecasts. Full pytest unavailable.

## Runtime
Installed source requires backend restart. Automatic approval review blocked the command containing restart, with reason: blocked by policy. No restart attempted after rejection. Existing reports remain historical snapshots. Refresh report after restart to collect latest data.

## Recovery
Private preimages under private-preimages/20261024-latest-report-readings; source hashes checked before integration.

## Delivery
Source and tests in task repository. No configured GitHub remote or verified Drive destination. Provider references: https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous?f=html and https://eccc-msc.github.io/open-data/usage/tutorial_OAFeat_Power-BI_en/.

## Limits
QC climate and Wateroffice temperature connections fail; two MNR forecasts require OPS/BPS login. No values fabricated. Precipitation is a dated daily total, not instantaneous rainfall. Searches are bounded: NOAA seven days, temperature 30 days, QC three months, GeoMet 12 pages. Workbook operating figures/date remain the template snapshot; collected public inputs are separate review data.
