# Worker visit continuity and roster lifecycle

Verified the live dashboard source resolves siteId/site through NorthStarSites, groups under the resolved station, includes provisional arrivals and excludes checked-out visits from active presence. Visible roster refresh is every 30 seconds and when the page regains visibility. No dashboard change was needed.

Isolated HTTP tests exercise manual arrival at Twin Falls, Iroquois Falls and Iroquois Falls 230 kV, active roster presence with exact site, visit re-fetch without deadline change, safety check-in, checkout removal, and historical record retention. Nine focused lifecycle/manual safety tests pass. No synthetic workers were inserted into the production database.

Worker page now stores one active visit pointer across QR/manual entry links, restores the active visit in the same browser, and clears that pointer on confirmed checkout. Existing per-link storage remains a migration fallback. JavaScript tests cover cross-link resume, CHECK OUT control restoration, cleanup, manual selection and QR resolution.

Live mobile session guidance verified at 390x844. The worker must keep the page open/visible for hourly reminders. Closing it neither checks out the visit nor resets server safety deadlines. Same-browser storage supports return; private browsing or clearing data can lose this device's visit controls. Actual automated telephone calls are not implemented; the copy explicitly distinguishes hourly safety reminders from phone calls.

Deployment: static contractor-checkin.html and sw.js installed with coordinator lock, hash guard and private preimages under 20261105-worker-session. Full suite results in commit message.
