# Daily report automation — v0.220

Operators previously copied public values and pasted ten forecasts plus three flow graphs. The new daily-report page collects 21 mapped public fields, creates provider screenshots and produces a new image-only XLSM draft. It supports an Eastern daily start, configurable morning retries, on-demand refresh, filtering, source links, image previews and protected downloads. The approved initial schedule is 06:30 Eastern.

Three public fields still need authorized access (NOAA Raft Lake and two Ontario MNR forecasts). Cogen PDFs, International Falls email and internal unit runtime are deferred. Water observations use the user-confirmed 07:00 Eastern time; flagged mappings remain provisional; no automatic operational writeback or macros/email execution occurs. A template snapshot's report date and operating figures are unchanged and must be reviewed before distribution.

Verification: twelve focused tests, 65 Node regressions, authenticated disposable-server browser checks at 1440px and 390px, live retrieval of 20 values with one missing provider value, and all thirteen provider screenshots. Thirty image ZIP entries replaced; every other workbook entry byte-identical. Excel recalculation/rendering and future unattended execution are separate, unverified boundaries. Full Python suite: 525 passed, two opt-in browser skips; both opt-in PostgreSQL browser tests subsequently passed. Twelve focused tests were rechecked after the Eastern-time confirmation. Release/deployment evidence is recorded in the delivery handoff.

Existing PostgreSQL was unresponsive during validation; graceful restart restored SQL connectivity. The first full-suite attempt used the application account and encountered database-creation privilege errors; rerun uses the protected administrator configuration solely for disposable ns_test_* databases. The unrelated saved dashboard layout is protected throughout integration.

See [operator/setup guide](../DAILY-REPORT-AUTOMATION.md).
