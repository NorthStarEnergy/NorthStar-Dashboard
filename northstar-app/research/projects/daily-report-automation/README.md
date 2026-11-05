# Daily report preparation

Open `daily-report-automation.html` from Water collection → Daily report. Authenticated operators can refresh, change the schedule, filter public inputs, preview provider images, and download the input CSV/JSON and a separate image-only report draft.

## Scheduled operation

Initial schedule: **06:30 America/New_York**, adjusting automatically for daylight saving time. The worker runs inside the NorthStar backend. Hourly retries continue until noon Eastern (configurable: none, 30, 60 or 120 minutes). A missed start produces one catch-up draft when the backend returns. SQLite stores the queue, settings, run history and configuration audit under private `data/daily-report/`; duplicate slots and overlapping manual jobs are suppressed. Provider Retry-After cooldowns persist across restarts. Interrupted jobs are shown as interrupted. No emails or workbook macros execute.

07:00 gauge sampling uses **America/New_York (Eastern)**, confirmed by the user. Operators can change it in the schedule controls if future reporting requirements change. The 06:30 draft cannot contain later 07:00 readings: these remain pending. Water samples must be at or before the requested instant and no more than 15 minutes earlier. Precipitation is the previous provider reporting day, not a generic rolling 24-hour total. Rainy River temperature is the latest published current-day sample in fixed EST, explicitly requiring review of the intended report statistic.

## Public inputs

Twenty-one connected destinations from West 2026 Daily_Input:

- D9:D13: WSC 05PA006, 05PA013, 05PB024, 05PB007, 05PC024 water levels in metres.
- E6:E8: USGS 05127500, 05129115, 05129290 **00065 gauge height in feet**. Never substitute 63160 absolute elevation; the workbook has separate stage offsets/conversions.
- D16:D20 and F16:F19: nine ECCC climate-daily precipitation products, preserving LOCAL_DATE and trace flags.
- F20:F21: Québec 7011190 and 7033650 precipitation, validating station, month, daily row and column layout.
- D21: Timmins Weatherstats daily precipitation, validating millimetres, daily product and zero-based provider month.
- D26: Wateroffice 05PC021 parameter 5 water temperature. Units are checked; this is an output without provider quality assurance.

Three destinations remain explicitly blocked: Raft Lake D5 needs authorized NOAA access/decoder; D23:D24 MNR North-WEST/North-EAST forecasts require OPS/BPS access. Cogen PDFs, International Falls email and internal unit runtime are deferred. Missing/trace/zero are distinct. Alias, stage datum and Rouyn/LaSarre label conflicts remain visible for operational review. Collected values are separate review drafts; the original WaterDB and PostgreSQL operating datasets are not modified.

## Forecasts and graphs

Capture the original provider's next five full-day cards for Atikokan, Fort Frances, Kenora, La Sarre, Iroquois Falls, Smooth Rock Falls, Kapuskasing, Dokis, Lachute and Pont Rouge from The Weather Network. Date sequence and temperature presence are checked. Capture WSC 04LF001 **daily mean discharge**, plus CEHQ 040110 and 050801 **Détail des prochains jours**, retaining the provider forecast/confidence bands and legends. CEHQ expired forecasts fail closed. Source URLs, timestamps and selected products accompany every image.

Unavailable images are replaced with a clearly labelled unavailable panel; old images are never silently reused. Only the 30 mapped PNG media parts of the report snapshot are replaced, including piled older images in chart userShapes. All other ZIP entries must remain byte-identical: VBA, cell values, formulas, native charts, external links and anchors. The original workbook is never overwritten. This preserves content but does not execute Excel, recalculate formulas or prove native Excel rendering.

**The downloadable workbook is an image-only draft. Its operational figures and report date remain those of the configured template. Review/update these before distribution.** The supplied Downloads file is a September 15 snapshot, not a verified live SharePoint template. Configure the actual maintained template locally when available.

## Setup and API

Requires Python plus existing NorthStar requirements, Node and Playwright with installed Edge/Chrome/Chromium. The workstation uses the bundled Codex Playwright runtime; configure a permanent administrator-managed runtime for an independent service host. Run `python scripts/setup-daily-report.py --template <absolute-xlsm-path> --playwright-module <module-path> --enable`. Existing settings require `--replace`. No URL, executable or filesystem path can be supplied through the web API.

Operator-only endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/daily-report/status | Configuration and latest 30 runs |
| GET | /api/daily-report/run?id=… | Inputs, image metadata and preservation proof |
| GET | /api/daily-report/file?id=…&name=… | Allowlisted run artifact or PNG |
| POST | /api/daily-report/refresh | Queue current-day refresh |
| POST | /api/daily-report/settings | enabled, time, timezone, readingTimezone, retryMinutes |

All routes share the existing operator gate, public-host rejection, viewer-role exclusion and cross-origin write checks. Private templates, configuration and job databases cannot be downloaded through these routes. Runs are retained locally; periodically archive them using the normal private-data backup process. Source workbooks, operational report drafts and credentials are excluded from Drive/source delivery packages.
