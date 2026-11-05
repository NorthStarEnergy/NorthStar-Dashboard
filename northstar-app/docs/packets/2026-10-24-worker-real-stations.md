# Worker tracker real stations — 2026-10-24

## Request
Remove fake stations from the fixed dashboard worker tracker.

## Changes
Resolve station IDs and aliases through NorthStarSites and require membership in its station catalog. Unknown names can no longer manufacture station buttons. Use canonical labels for buttons and navigation. The fixed worker total uses the same station filter. Other roster records and history are preserved.

## Verification
Eight headless Edge layouts pass in main and fixed windows, with all 20 catalog stations and nine unconfigured names in the input (including Alder Creek GS, Silver Falls GS and Pine River GS). Exactly 20 stations and 60 valid-site workers display. No overlap or scrolling; warning states and station clicks pass. Worker flow regression passes. Full Python suite attempted but unavailable in the bundled runtime (pytest missing).

## Runtime
Two static files installed with source hash checks and coordinator lock. Reload dashboard and fixed windows. No backend restart needed. Browser checks use fixture APIs; authenticated live session not exercised.

## Recovery
Private preimages saved under private-preimages/20261024-worker-real-stations. Compare hashes before restoring.

## Delivery
Source and verification saved in this task repository. No configured github remote or verified Drive delivery destination; retired Sites remote is not a deployment target.

## Handoff
Fixed tracker now derives station eligibility from the catalog, not free-text worker records. Stored operational records are not deleted.
