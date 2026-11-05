# Simplified daily-report PDF

## Request
Only station/site, reading and collection time in PDF output.

## Changes
Three-column paginated table, units retained, timestamps with timezone. Uses actual observation timestamps or source dates; unavailable values remain explicit. Removes images, cell references, source URLs and detailed notes from PDF only.

## Verification
Edge downloaded the PDF with an unmatched UI filter. Parsed PDF confirms readings, no images or source notes. Rendered and checked layout.

## Runtime
Refresh daily-report page. No backend changes. Previous latest-source restart requirement remains unchanged.

## Recovery
Private preimages and SHA256 guards used before integration.

## Delivery
Source packet in workspace repository; no configured GitHub remote or verified Drive destination.

## Limits
Date-only providers retain dates without inventing times. Exports the selected prepared snapshot.
