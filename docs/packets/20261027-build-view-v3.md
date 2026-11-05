# NorthStar Build View v3

## Request

Create a fresh, minimal presentation using v1 as the base. Give each main function one home, use one-line records with full details on click, preserve the fixed dashboard and Weather, and add source-backed UWPC training examples.

## Changes

- Overview now has a compact worker tracker with Add person, an X for checkout, inline update status, an event feed with source filters, and station tiles beneath the event feed. Checkout removes only the confirmed worker and preserves other row elements. Help, overdue and provisional states remain visible; existing profile actions retain their safeguards.
- Check-ins lands on one simple person list. A person opens the existing full profile. Events uses a consistent control-room table with time, severity, source, station, message and state. Filtering and cursor pagination use the shared server event register; opening a record never acknowledges an alarm.
- The overview price graph has one home under Markets, with time-window, view and vertical-scale controls. Additional series and data are collapsed. The selectable window is limited to received data; it does not imply a new historical archive.
- Operations tiles contain their text. Activity/outage entries are one line; details and existing actions open separately. Outage entry is collapsed behind Add outage. Secondary tools remain available through one local toolbar toggle where needed. The v3 menu removes duplicate listing destinations.
- Dispatch has a compact status page, connection checks, measured browser-to-NorthStar API latency, local connection-check history, telemetry, and recorded dispatch events. The backend remains a simulator; actual IESO connectivity and IESO round-trip latency explicitly show unavailable.
- Agent's Back, new chat and history menu occupies the existing navigation rail. Its width follows the original rail at each breakpoint, leaving the fixed dashboard in place.
- Engineering includes four fictional UWPC studies derived from the supplied Drive training: PC10A electrical work, PC17B mechanical/sluice work, PC2 work with two supporting guarantees, and PC14 testing. Each contains filled draft form fields, proposed order records, details, source links and printable HTML. Equipment identifiers, actual site sequence and release evidence remain explicit review hold points.
- Spill uses narrow square log stacks and narrower bay cards. Qualified plant headwater appears only when an exact canonical binding supplies a current reading. Missing lake mapping, measured bay flow and calibration remain explicit.
- v3 starts without saved v1 content-placement overrides, while preserving those preferences for return to v1. Separate module and status windows keep their original ownership. View changes synchronize across windows without overwriting a v2 choice. Demo navigation uses the existing module allowlist; a discovery-order fix preserves its allowed UWPC entry.

## Verification

- Full-shell Edge fixtures exercise overview, worker profiles, failed/successful checkout, stable remaining rows, event filtering, market controls, station details, Operations, compact outage details and entry form, Spill, Dispatch, Agent at 1600/1024/768px, UWPC, unchanged Weather content, v1/v2/v3 switching and reload, cross-window view changes, detached Dispatch, and demo Tools/UWPC navigation. No browser errors or horizontal overview overflow.
- Existing v1 worker-flow regression covers add-person failure/success, station/crew suggestions, shared header totals and cross-window arrivals/checkouts.
- Component verification: 28 worker/event/help browser checks; Dispatch lifecycle, failures and GET-only requests at 1280/800/500px; qualified Spill readings and unavailable states; all four UWPC exports/details at desktop/tablet/mobile sizes.
- Full isolated Python run: 511 passed, 21 skipped, 7 failed and 8 errors (325 subtests passed). Three failures came from a missing research folder in the test copy; corrected affected-file reruns against v3 and the original baseline both returned 4 failed, 2 passed and 8 errors. The remaining failures reproduce before v3: missing schema/legacy files and existing research-access expectations. See evidence/PYTHON-REGRESSIONS.md. No fully green backend suite is claimed.
- All operational API traffic in UI tests uses fixtures. Authenticated production workflows and real IESO connectivity were not exercised. Installed source is hash-verified separately from those browser fixtures.

## Runtime

Runtime: C:/Users/User/NorthStar/northstar-local. Open northstar-clean.html?buildView=v3 or choose Build view v3. Static assets take effect on refresh; no backend/service restart is required. Weather source, backend routes, auth gates and operational databases were not changed. v1 and v2 remain selectable.

## Recovery

The integration uses an exclusive coordinator lock, compares all four preimage SHA-256 values before writing, and stores originals under the private-preimages/20261027-build-view-v3 directory in the workspace. New assets install before HTML references. SHA256SUMS.json records the exact deployed allowlist. Selecting v1 is the immediate UI rollback; source rollback restores only the four preimages and removes only this packet's nine new assets under a fresh coordinator lock.

## Delivery

Source commit: 02d23daf3e8ab290f316a5d75cdf49ece36d8863. Tag: packet-20261027-build-view-v3. [Verified Drive source archive](https://drive.google.com/file/d/1hDEwrxXun9j0Fd4DkKBgvlodxaChBZB9/view?usp=drivesdk). Installed-file browser checks pass; live backend health is healthy, while unauthenticated source requests are refused.

This folder contains the allowlisted source, fixture verification, source evidence and four printable examples. The local source commit/tag and delivery receipt are recorded in DELIVERY.md. A source archive is saved to the verified Work Projects/NorthStar Drive destination. No GitHub remote is configured for this workspace.

## Limits

The current Dispatch endpoint supplies simulation, not an IESO connection. Plant profiles and spill inventory already include illustrative data; v3 labels it and does not turn it into live telemetry. Actual dynamic bay discharge needs qualified bay measurements or an approved rating curve and physical inventory. UWPC examples are fictional training drafts, not executable site orders or issued permits. Existing backend activation blockers from earlier packets are unchanged.
