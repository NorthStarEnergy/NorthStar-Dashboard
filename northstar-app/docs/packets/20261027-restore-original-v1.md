# Restore the pre-v3 v1 build

## Request
Restore v1 to how it was before work on v3.

## Changes
Restored the pre-v3 HTML shell and byte-identical original roster, generating stations, module layout, module workspace and asset editor scripts under separate v1 filenames. V1 loads no v3 styles or controllers. The existing build picker switches across the v1/v3 boundary using a new document; explicit v1 links override stored v3 selection. Original v1 controls, layout, station tiles and market graph are preserved. The unrelated IESO streams script remains included.

## Verification
Edge fixture checks pass: original pre-v3 geometry at 1600, 1253 and 768 pixels, original roster headings/actions, absence of v3 assets in v1, v1/v3 round trip, reload and explicit selection overriding stale storage. Zero browser errors. Installed source hashes match the packet. Required isolated Python baseline suite: 4 failed, 512 passed, 21 skipped, 8 errors, 347 subtests passed in 225.45s (0:03:45). Known failures concern missing baseline schema/server files and legacy static expectations; backend code was not changed.

## Runtime
Static files installed in C:/Users/User/NorthStar/northstar-local. Open northstar-clean.html?buildView=v1 (redirects to the isolated original shell), or select v1 after refreshing. No service restart. The separate IESO backend restart remains pending.

## Recovery
Private preimages: private-preimages/20261027-restore-original-v1. Restore only the two previously existing files under the coordinator lock; additional v1 assets can remain unused. No saved user layout preferences or operational data were reset.

## Delivery
Commit/tag and Drive archive are recorded separately after verification. There is no configured GitHub remote; the Sites remote is not a publication target for this packet.

## Limits
Verification uses intercepted fixture APIs, not authenticated operational actions. Restores source and behavior from the saved pre-v3 baseline; prior browser-local customizations remain intact.
