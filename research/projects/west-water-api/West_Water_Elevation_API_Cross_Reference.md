# West water elevation API cross-reference

Checked 22 September 2026. Read-only research; no source workbooks, macros, live dashboard or integrations changed.

## What needs connecting

Two public API adapters cover 13 candidate gauges: ECCC/WSC (10) and USGS (3). Live readings were returned for all 13. The Lac La Croix and Squirrel Falls aliases still need confirmation. Additional connections are needed for Raft Lake (NOAA GOES DCS), the LWCB lake-average/partner series, internal plant readings, and PCA/International Falls. These are separate source requirements, not 13 separate APIs.

## Canadian gauges: ECCC / Water Survey of Canada

| Workbook site | WSC ID | Source locator | Match / remaining check |
|---|---|---|---|
| Lac LaCroix | [05PA006](https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=05PA006&sortby=-DATETIME&limit=1&f=json) | WaterDB Daily_Input!B9:D9 | Candidate: live outlet gauge; workbook links only to a saved station list. Confirm intended gauge. 05PA011 Campbell's Camp has REAL_TIME=0 and no returned readings. |
| Squirrel Falls / Namakan | [05PA013](https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=05PA013&sortby=-DATETIME&limit=1&f=json) | WaterDB Daily_Input!B10:D10 | Likely match: official name Squirrel Island. Confirm alias before binding. |
| Rainy Lake near Bear Pass | [05PB024](https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=05PB024&sortby=-DATETIME&limit=1&f=json) | WaterDB Daily_Input!B11:D11 | Name match; assumed datum requires reconciliation. |
| Rainy Lake near Fort Frances | [05PB007](https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=05PB007&sortby=-DATETIME&limit=1&f=json) | WaterDB Daily_Input!B12:D12 | Name match; lake gauge is distinct from plant forebay. |
| Point Park #1 / Pithers Point #1 | [05PC024](https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=05PC024&sortby=-DATETIME&limit=1&f=json) | WaterDB Daily_Input!B13:D13; Input!B18 | Current API name is Point Park Site No.1. |
| Kenora forebay | [05PE006](https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=05PE006&sortby=-DATETIME&limit=1&f=json) | LFLOWS Data Entry!A6:B6 | Exact workbook station ID. |
| Kenora tailrace | [05PE001](https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=05PE001&sortby=-DATETIME&limit=1&f=json) | LFLOWS Data Entry!A7:B7 | Exact workbook station ID. |
| Norman forebay | [05PE029](https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=05PE029&sortby=-DATETIME&limit=1&f=json) | LFLOWS Data Entry!A8:B8 | Exact workbook station ID; retain local offset review. |
| Norman tailrace | [05PE012](https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=05PE012&sortby=-DATETIME&limit=1&f=json) | LFLOWS Data Entry!A9:B9 | Exact workbook station ID; archive includes Norman TW offset reference. |
| Keewatin | [05PE014](https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=05PE014&sortby=-DATETIME&limit=1&f=json) | LFLOWS Data Entry!A10:B10 | Exact workbook station ID; not the Lake of the Woods average. |

Use `hydrometric-realtime` for timestamped `LEVEL` values, with station metadata from `hydrometric-stations`. Fetch a bounded time window for 07:00 readings or daily aggregation; the latest reading is not a daily mean. Follow pagination. WSC also offers historical daily means and Datamart CSV feeds. LFLOWS already stores five Datamart CSV addresses in the gauge sheets at D1.

## U.S. gauges: USGS

| Workbook site | USGS ID | Source locator | Workbook elevation formula (metres) |
|---|---|---|---|
| Basswood River near Winton | 05127500 | Daily_Input!B6:E6 | (gage height ft + 1296.8) × 0.3048 |
| Vermilion River near Crane Lake (workbook: Vermillion) | 05129115 | Daily_Input!B7:E7 | (gage height ft + 1180) × 0.3048 |
| Gold Portage outlet from Kabetogama Lake | 05129290 | Daily_Input!B8:E8 | (gage height ft + 1100) × 0.3048 |

The workbook hyperlinks explicitly identify these three stations. Verified endpoint: `https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items`. Filter by `monitoring_location_id=USGS-<ID>` and `parameter_code=63160` for stream water-level elevation above NAVD88, in feet. Multiply by 0.3048 for metres NAVD88. Keep parameter `00065` separately for raw gage height and workbook comparison. Use `continuous` with a bounded interval for historical/07:00 observations. Version v0 responded with v1 links, so the verified requests use v1. API keys support higher request limits.

Do not apply the old workbook offsets to the NAVD88 elevation series. They produce a different elevation basis. Do not treat monitoring-location altitude as an automatic gage-zero offset either. Preserve the workbook basis separately until its datum and any station changes are reconciled.

## Other required sources

| Site / measurement | Source evidence | Connection needed / unresolved detail |
|---|---|---|
| Raft Lake elevation | Daily_Input!B5:D5; Instructions!B13 and B15 | NOAA GOES DCS platform **4815D640**, group H2O. Message order: water level, water temperature, precipitation. Use authorized LRGS/DDS or provider-supported retrieval; confirm units, datum, decoding and platform activity. Login not attempted. |
| Calm Lake forebay and tailrace | Input!D6:D7 → external Daily_Report!D10/F10 | Internal historian/SCADA or approved daily-report feed. Exact tags and API not supplied by the workbook. |
| Sturgeon Falls forebay and tailrace | Input!D8:D9 → external Daily_Report!D11/F11 | Internal historian/SCADA or approved daily-report feed. Do not substitute a nearby river gauge without confirming measurement location. |
| Fort Frances forebay, tailrace and canal | Input!D19:D21 → external Daily_Report!D12/F12/N12; Input!D44:F46 min/max/average | Three distinct measurements. Internal feed required. Partner CSV also has Fort Frances Dam level, but its equivalence is not established. |
| Kenora and Norman plant readings | Input!D22:D25 → external Daily_Report!D13/F13/D14/F14 | WSC gauges above are explicit LFLOWS inputs. Confirm equivalence and corrections before replacing internal report readings. |
| Lake of the Woods average elevation | LW!C4 and LW!AB2:AB5; partner station 11978, ts_id 1165010 | LWCB partner data feed/export. Preserve the published lake average; do not replace it with Keewatin alone. Current API route/access not verified. |
| PCA / International Falls forebay and tailrace | Daily_Input!A37:F38; Input!A52:F53; linked ijcdata.pdf | Workbook uses PCA/Boise daily report. Partner CSV contains International Falls PH station 13090, series 3611010 and 3630010. Confirm forebay/tailrace assignment and reporting window with provider. PDF link was inaccessible in this check. |

## Live verification and datum evidence

These are one-time connectivity samples, not operating instructions or a persistent feed. Values may be provisional. All sample timestamps below are UTC on 2026-09-22.

| Site / ID | Returned value | Observation UTC | Provider datum |
|---|---|---|---|
| Lac LaCroix / 05PA006 | 360.452 m | 2026-09-22T10:30:00Z | UNITED STATES AND CANADA BOUNDARY SURVEY DATUM |
| Squirrel Falls / Namakan / 05PA013 | 340.452 m | 2026-09-22T10:15:00Z | UNITED STATES COAST AND GEODETIC SURVEY DATUM |
| Rainy Lake near Bear Pass / 05PB024 | 337.467 m | 2026-09-22T10:30:00Z | ASSUMED DATUM |
| Rainy Lake near Fort Frances / 05PB007 | 337.474 m | 2026-09-22T10:30:00Z | UNITED STATES COAST AND GEODETIC SURVEY DATUM |
| Point Park #1 / Pithers Point #1 / 05PC024 | 337.466 m | 2026-09-22T10:50:00Z | UNITED STATES COAST AND GEODETIC SURVEY DATUM |
| Kenora forebay / 05PE006 | 322.617 m | 2026-09-22T10:40:00Z | LAKE OF THE WOODS DATUM |
| Kenora tailrace / 05PE001 | 316.174 m | 2026-09-22T10:40:00Z | GEODETIC SURVEY OF CANADA DATUM (LOCAL 1923 ADJ.) |
| Norman forebay / 05PE029 | 322.613 m | 2026-09-22T10:30:00Z | LAKE OF THE WOODS DATUM |
| Norman tailrace / 05PE012 | 316.124 m | 2026-09-22T10:40:00Z | GEODETIC SURVEY OF CANADA DATUM (LOCAL 1923 ADJ.) |
| Keewatin / 05PE014 | 322.657 m | 2026-09-22T10:25:00Z | LAKE OF THE WOODS DATUM |
| [USGS 05127500](https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items?f=json&monitoring_location_id=USGS-05127500&parameter_code=63160&limit=10) | 1300.40 ft | 2026-09-22T10:30:00+00:00 | NAVD88, parameter 63160 |
| [USGS 05129115](https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items?f=json&monitoring_location_id=USGS-05129115&parameter_code=63160&limit=10) | 1164.04 ft | 2026-09-22T10:30:00+00:00 | NAVD88, parameter 63160 |
| [USGS 05129290](https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items?f=json&monitoring_location_id=USGS-05129290&parameter_code=63160&limit=10) | 1117.45 ft | 2026-09-22T10:30:00+00:00 | NAVD88, parameter 63160 |

The WSC forebay and tailrace metadata do not all use the same named datum. Preserve each raw datum and validate transformations before computing head or comparing sites. Retain observation time, receipt time, units, datum, parameter, quality flags and source ID. Explicitly define whether 07:00 means Central standard time or daylight-adjusted local time; the workbook label alone does not resolve that.

## LWCB level-series inventory

The local Water Management partner file contains 29 level series across 21 stations. They are supporting inventory, not all proven mandatory dashboard inputs. Keep `station_id` and `ts_id` separate. Multiple level series at one plant are not labeled forebay/tailrace in this export. Obtain series metadata before assigning them.

| Station | Station ID | Series ID | Series type | Units |
|---|---|---|---|---|
| Caribou Falls Dam | 13203 | 3745010 | 10.DayMean | m |
| Clearwater | 11752 | 1030010 | 10.DayMean | m |
| Cyclone | 11751 | 1085010 | 10.DayMean | m |
| EarFallsPH | 12991 | 3387010 | 10.DayMean | m |
| EarFallsPH | 12991 | 3406010 | 10.DayMean | m |
| Fort Frances Dam | 13082 | 4057010 | 10.DayMean | m |
| Hanson | 11750 | 1110010 | 10.DayMean | m |
| International Falls PH | 13090 | 3611010 | 02.Production | m |
| International Falls PH | 13090 | 3630010 | 02.Production | m |
| Keewatin | 11753 | 1063010 | 10.DayMean | m |
| KenoraPH | 11758 | 1596010 | 10.DayMean | m |
| KenoraPH | 11758 | 1615010 | 10.DayMean | m |
| LW Summary Station | 11978 | 1165010 | 10.DayMean | m |
| Lac Seul at Goldpines | 12911 | 3282010 | 10.DayMean | m |
| Lac Seul at LS Post | 12909 | 3254010 | 10.DayMean | m |
| Manitou Falls Dam | 14427 | 4316010 | 10.DayMean | m |
| Manitou Falls Dam | 14427 | 4340010 | 10.DayMean | m |
| Namakan Summary Station | 12624 | 14687010 | 10.MergedDayMean | m |
| Namakan Summary Station | 12624 | 2354010 | 10.DayMean | m |
| NormanPH | 11757 | 1350010 | 10.DayMean | m |
| NormanPH | 11757 | 1370010 | 10.DayMean | m |
| Rainy River | 12662 | 2477010 | 10.DayMean | m |
| Rainy Summary | 12775 | 14690010 | 10.MergedDayMean | m |
| Rainy Summary | 12775 | 2923010 | 10.DayMean | m |
| Rat Rapids | 13136 | 3558010 | 10.DayMean | m |
| Root River | 13148 | 4288010 | 10.DayMean | m |
| Springsteel | 11754 | 937010 | 10.DayMean | m |
| Whitedog | 12142 | 4437010 | 10.DayMean | m |
| Whitedog | 12142 | 4468010 | 10.DayMean | m |

CSV coverage: 2026-07-26T05:00:00Z through 2026-09-14T05:00:00Z. The file is historical, not current telemetry. Level inventory: 29 series / 21 stations.

## Integration priority and remaining decisions

1. Connect WSC and USGS in read-only collection mode using the verified station IDs and raw datum metadata. Confirm Lac La Croix and Squirrel Falls aliases before final binding.
2. Reconcile USGS NAVD88 versus workbook offsets and WSC forebay/tailrace datum corrections. Obtain approved time-window definitions.
3. Set up authorized NOAA retrieval for 4815D640 and obtain LWCB partner interface/series metadata.
4. Identify internal tags/API for Calm Lake, Sturgeon Falls and Fort Frances (including canal). Confirm PCA/International Falls daily series.
5. Preserve missing/stale readings as missing/stale. Do not substitute nearby gauges or silently convert them into equivalent plant readings.

Precipitation, river temperature, discharge, rule curves and generation are outside this elevation cross-reference. In particular, 05PC021 appears in WaterDB as a Rainy River temperature source, not as one of the required elevation rows. A targeted source search found the existing ECCC backend URL is weather `swob-realtime`, not a verified hydrometric collector. No comprehensive implementation audit was performed.

## Source files and references

- `C:\Users\Ryan1\Downloads\WaterDB_WEST_2026 (1).xlsm`: Input, Daily_Input, LW and Instructions cells cited above. The unsuffixed workbook was also inspected for sheet structure and top input rows; the suffixed copy supplies the detailed cross-reference.
- `C:\Users\Ryan1\Downloads\Tools.zip` → `Tools/West/LFLOWS/LFLOWS.xlsm`: Data Entry!A6:B10 and five station-sheet headers.
- `control-room-dashboard/data/water-management/source/Water_Management/DATA/LW/LWCB_Partner_Data.csv`: newer extracted Water Management series inventory. The Tools.zip copy was also checked and has older/different series coverage.
- Original Water_Management.zip was not re-extracted. This review uses its existing extracted CSV layer plus the West workbook and LFLOWS sources.
- [ECCC hydrometric access documentation](https://eccc-msc.github.io/open-data/msc-data/obs_hydrometric/readme_hydrometric_en/).
- [USGS API documentation](https://api.waterdata.usgs.gov/docs/ogcapi).
- [NOAA DCS and LRGS/DDS resources](https://dcs1.noaa.gov/).
- [LWCB partner page from workbook](https://lwcb.ca/datasharing/) and [PCA report from workbook](http://boisepaperapp.com/bph/lakelevels/ijcdata.pdf): not accessible through the web check; this does not establish that the services are unavailable to authorized users.

Source spreadsheets were read without executing macros or refreshing external links. Embedded account information was excluded from deliverables. API responses are retained locally in api-evidence.json.
