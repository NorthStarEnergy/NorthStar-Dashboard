# Overview worker frame from v1

## Request
Keep the overview worker module the same as v1; use the remaining width for the event log and station tiles.

## Changes
The overview uses the original v1 roster controls, columns and actions, with its 722px desktop frame, padding and height rule. Only the full Check-ins page retains the reduced v3 roster. The overview grid allocates the remainder to the event feed and station tiles. Tiles fill that column and reflow when it cannot hold five geographic columns. Narrow screens stack the panels. Weather, the fixed dashboard and the new IESO streams integration are preserved.

## Verification
Edge fixtures compare v1 and v3 toolbar text, columns, checkout controls, desktop frame width/height, remaining-width geometry, no horizontal page overflow, and the separately reduced Check-ins list at 1600, 1253, 1024 and 768 pixels. All pass without browser errors. All API traffic uses fixtures. Installed source hashes are checked separately. The required isolated Python suite returned 512 passed, 21 skipped, 4 existing failures and 8 existing errors, with 347 subtests passed. Results are saved in python-suite.log; its backend source copy retains the established baseline rather than the concurrent IESO-streams backend changes.

## Runtime
Five static files in C:/Users/User/NorthStar/northstar-local. Refresh buildView=v3; no service restart is needed for this layout change. The separate IESO streams backend restart requirement remains unchanged.

## Recovery
The coordinator lock and base-hash guards protect concurrent edits. Private originals are saved under private-preimages/20261027-v3-worker-v1-width. Restore only those five files under a fresh lock to undo this packet.

## Delivery


Source: a90b8f9313ee942f086d5540d300f7583aea3809

Tag: packet-20261027-v3-worker-v1-width

[Verified Drive archive](https://drive.google.com/file/d/1ePUjLTBT9XUubL-CjW652Lkar-1HhlSA/view?usp=drivesdk)

Installed static files are hash-verified. Refresh v3; this layout change needs no service restart. The separate IESO streams backend restart requirement remains unchanged.
Commit/tag identity and verified Drive delivery are recorded in DELIVERY.md. No GitHub remote is configured. The existing Sites origin is not used for publication.

## Limits
The desktop default matches v1; narrow layouts stack to remain usable. Verification is fixture-based, not an authenticated production workflow. The full v1 overview restores its original controls and listing behavior as requested, including its original scope/count semantics.
