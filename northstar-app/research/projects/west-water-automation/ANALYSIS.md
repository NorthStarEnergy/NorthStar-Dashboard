# West water management 2026: automation analysis

The active entry sheet is **Daily_Input**, identified by **Cogen at A59**, with M1–M3 energy counters in B60:B62 and current power in D60:D62. The hidden **Input** sheet is still a dependency of the macros and linked SCADA reporting; it must not be removed.

Reviewed source: `C:/Users/Ryan1/Downloads/WaterDB_WEST_2026 (1).xlsm`, modified September 15, 2026. This is the newest located local snapshot, not a confirmed current SharePoint edition. The archived unsuffixed copy is older. Original workbook remains unchanged.

## What needs collection

The [field map](input-field-map.csv) identifies **47 input positions**: 9 water levels, 12 precipitation totals, 2 regional forecasts, 1 water temperature, 5 PCA values, 12 unit operating-hour values and 6 Cogen values. These are input positions rather than proof that every value was typed manually. No operational readings or credentials are included in the deliverables.

- **USGS:** workbook hyperlinks explicitly identify Basswood 05127500, Vermilion 05129115 and Gold Portage 05129290. NorthStar already has these gauges, but collects parameter 63160 absolute NAVD88 elevation. Excel E6:E8 expects relative gauge height, then D6:D8 adds C6:C8 and converts feet to metres. Confirm parameter 00065 and the workbook's local stage offsets before connecting. Copying absolute elevations into E6:E8 would double-count the offsets. [Official USGS station](https://waterdata.usgs.gov/nwis/uv?legacy=1&site_no=05127500), [API documentation](https://api.waterdata.usgs.gov/docs/ogcapi/).
- **WSC:** five workbook fields match existing registry candidates: 05PA006, 05PA013, 05PB024, 05PB007 and 05PC024. Confirm the Lac LaCroix/Squirrel Falls aliases, datum and exact 07:00 time convention. The collector still needs a daily selection layer. [Official GeoMet service](https://eccc-msc.github.io/open-data/msc-geomet/readme_en/).
- **Precipitation:** nine ECCC climate IDs are present in hyperlinks, plus two Québec climate station keys and the Timmins Weatherstats site. Preserve those exact stations and reporting periods. Timmins needs a station/product mapping. Rouyn's label conflicts with the defined name `LaSarre.Precip`; resolve before activation. Québec links are fixed to March 2026 and need date-driven requests. [Official historical climate service](https://climate.weather.gc.ca/).
- **Raft Lake:** instructions identify NOAA DCS platform **4815D640**, with message values ordered water level, water temperature, precipitation. An authorized machine-access method and verified decoder/units are needed; the current public collector does not decode it.
- **PCA:** the workbook points to a Boise/PCA PDF for forebay, tailrace, outflow and minimum/maximum water temperatures. It is not an established API. The linked endpoint was inaccessible during this review. A dated document parser or approved structured feed is needed.
- **Forecasts:** the two five-day regional totals point to Ontario SWMC. The endpoint was inaccessible during review; identify the actual regional product and issue/valid dates before implementing collection. A generic weather forecast is not an equivalent replacement.
- **Rainy River temperature:** workbook link identifies **05PC021**. NorthStar's existing WSC collector reads level/discharge only; temperature availability needs verification.
- **Internal operations:** Fort Frances units 1–8, Calm Lake units 1–2 and Sturgeon Falls units 1–2 need runtime totals or run-state history. Cogen M1–M3 needs separate counter and instantaneous-power tags. Units/scaling are absent from the Cogen headers. The exact source/tag IDs remain unresolved.

## Additional automation already partly present

The hidden Input sheet has **45 formula links** to `SCADA_Production_Summary.xlsm`, covering plant levels, temperature, unit data and other reporting. [SCADA dependency map](scada-linked-inputs.csv) preserves their exact source-cell references. Use an authorized read-only report/export connector or historian integration; do not replace existing linked values with public gauge estimates.

The **LW / LotWData** workflow already imports a partner CSV by date and series ID, after a person downloads it to SharePoint. Seven mappings are recoverable from VBA: lake level 1165010, inflow 5159010, outflow 5145010, Norman forebay/tailrace 1350010/1370010 and Kenora forebay/tailrace 1596010/1615010. Their targets are LW!AC:AI. Automating this download is a high-value separate task; access and provider schema still need validation. The macro hardcodes `T05:00:00Z`; establish whether that is the provider's reporting convention before changing it.

## Preserve collection and reporting separately

`Submit_Data_DAY` transfers data into histories and other workbooks. `TransferEASTPrecip` also sends Cogen values to the **Québec workbook's COGEN sheet**, using yesterday's date. Keep this downstream dependency visible. Polling a provider must not trigger workbook submission, email forms or macros.

Static VBA also references a sheet named `Daily Report`, while this snapshot contains `DailyReport`. The `ClearData` defined name contains broken references and ranges covering formula cells. These are compatibility findings to verify in an isolated Excel copy, not defects proven by macro execution. There are 8,926 cached formula errors across the workbook; without recalculation and external dependencies, this does not establish 8,926 live defects.

## Implementation order

1. Reuse NorthStar's existing public collector. Add verified relative USGS series and a date/time selection layer for the five WSC fields. Store raw observations and quality separately from the daily form.
2. Add exact-station climate adapters; preserve zero, trace, missing and provisional flags. Add bounded PDF/forecast adapters only after their live products are accessible and validated.
3. Add authorized NOAA, LWCB/SharePoint and internal SCADA/Cogen sources. Keep credentials in secure configuration; never extract credentials from the workbook.
4. Build a **West Daily Water** view: selected reporting date, 07:00 readings, prior-day statistics, source timestamps, freshness/quality, missing-field warnings, audited corrections, refresh now and review/export actions. Match the current Daily_Input layout and keep Cogen visible.
5. Validate side-by-side against operators' readings before any automatic workbook writeback or report submission.

Suggested starting intervals: water every 15 minutes; daily weather/report availability checks hourly; a draft after 07:00; refresh on demand. These are proposals, not activated settings. Confirm the operating timezone, daylight-saving treatment and precipitation reporting day. A rolling 24-hour average is not automatically the workbook's daily average.

The [automation contract](automation-contract.json) records exact cells, source IDs, transformations, seven LWCB series and proposed API boundaries. All proposed West-specific routes are **unimplemented**; actual existing APIs remain documented in `docs/WATER-COLLECTION.md`.

## Verification and boundary

Read-only OOXML inspection of 17 sheets, 55,371 formula cells, 14 external-link parts and static extraction of 37 VBA modules. All 47 mapped destinations are non-formula cells; all source IDs above derive from hyperlinks, VBA or current NorthStar registry code. Original workbook SHA-256 is recorded in analysis-evidence.json. No macros, link refresh, recalculation, data imports, new schedules, backend restart or source-code deployment occurred. Embedded credentials were excluded from outputs; they should be rotated by the account owner.
