# V3 reduction from native v1

## Request

Correct the previous v3 redesign: reduce v1's existing content and controls, retain its familiar components and visual language, and make each view precise. The attached screenshot exposed an oversized overview event table, narrowed worker panel, replaced station tiles and inconsistent worker counts.

## Changes

The Overview now uses the actual v1 field roster and generating-station cards, with balanced columns and original geographic grouping. Add person replaces the roster heading; update status stays inline. Checkout reconciles keyed rows after confirmation without repainting unrelated rows. Failure retains the person, and delayed snapshots cannot resurrect a confirmed checkout. Company colors, station headings, pending-review and help workflows remain native.

Overview worker membership now matches the fixed header's canonical-station scope. Unknown or unconfigured visits remain in the flat Check-ins list, with an overview notice rather than invented station groups. Check-ins opens the original Active Workers component with one person per row, search, and full profiles on click. Time appears first so narrower columns retain the useful clock value; full dates remain in record details/tooltips.

The overview event feed has six recent rows showing time, level and message, plus the requested source filters. Full event records and pagination remain in Events. Original station cards sit directly below the feed. Operations activity requests only six operational records using server-side source filters. Its outage summary retains all non-past records, including unconfirmed status, and removes duplicate history filters. Full outage details remain clickable. Navigation now keeps the selected section highlighted on custom Events and Markets views.

Markets, Dispatch, UWPC training, Agent rail and Spill changes from the previous packet remain. Weather and the fixed dashboard are unchanged. No backend, auth, live records or source-data classifications were modified.

## Verification

- 19 native roster fixture checks pass: canonical IDs/aliases, unknown visits retained, old/missing timestamps, help/pending safeguards, full-list search/profile/add, stable rows, failed/successful checkout, delayed-snapshot race, stale-read safety, original colors and restoration to v1.
- Full-shell Edge fixture passes overview geometry at 1253x510, 1253x800 and 1600x900; original station content reuse; native Check-ins/profile/checkout; Events/Markets selection; Operations/outages/details; Spill/Dispatch; Agent without header movement; UWPC; unchanged Weather; cross-window build switching; detached windows; demo restrictions. No browser errors or horizontal overview overflow.
- Operations fixture passes repeated server source filters, six-row scope, unknown outage state retained, v1 history controls, and late responses in both build-switch directions. Native generation gauges remain intact.
- Existing v1 worker regression passes add/save failure and success, shared header totals, and cross-window arrivals/checkouts.
- Full isolated Python suite: 512 passed, 21 skipped, 4 failed and 8 errors; 347 subtests passed. All failing identities match the pre-existing baseline. See verification/PYTHON-CORRECTION-REGRESSIONS.md. Later presentation-only adjustments are covered by the final browser checks; no backend changes were made.

All operational API mutations in verification are intercepted fixtures. Installed source is verified separately by hashes and full-shell browser checks; no authenticated production checkout was performed.

## Runtime

Install the eight allowlisted static assets into C:/Users/User/NorthStar/northstar-local. Reload northstar-clean.html?buildView=v3. No service restart is required. The old v3 worker/station renderers are no longer mounted; native data-owned nodes remain in place.

## Recovery

Installation uses an exclusive coordinator lock, compares current files to base.json, stores private originals under private-preimages/20261027-v3-v1-reduction, installs dependencies before HTML, and verifies SHA256SUMS.json. Select v1 for immediate presentation rollback. Restore only this packet's seven existing-file preimages and remove its one new CSS file under a fresh lock for source rollback.

## Delivery

Source cde686b06356aa14c11f8dcd7df19a47fb887771; tag packet-20261027-v3-v1-reduction. [Verified Drive archive](https://drive.google.com/file/d/1NWAaA9qoDpjiEzVuDBvtuPYV6HogBHMS/view?usp=drivesdk). Eight source hashes match runtime and archive; reload v3.

Source packet is committed and tagged before archiving, with the exact identity and Drive receipt recorded in DELIVERY.md. Archive destination is the verified Work Projects/NorthStar folder. No GitHub remote is configured; the existing origin is a separate Sites repository and is not a valid GitHub delivery target.

## Limits

This corrects the v3 presentation and content scope. It does not establish a live IESO connection, supply calibrated bay discharge, issue UWPC permits, or resolve the existing backend test failures. Training examples remain fictional review drafts. Source installation does not claim authenticated live-browser verification.
