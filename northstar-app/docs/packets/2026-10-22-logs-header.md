# Logs header timestamp — 2026-10-22

## Request
Move the update time into the column-header bar and remove the separate space.

## Implementation
Place the existing live status element at the right of the EVENT column header. Remove its standalone header row. Preserve loading, updated and error status updates and column resize controls.

## Runtime
Apply event-log-modules.js, event-log-modules.css and northstar-clean.html with refreshed asset versions.

## Verification
JavaScript syntax passes. Browser layout checks at 1600, 1000 and 768px confirm timestamp containment, no separate row and no gap below categories. Screenshot reviewed.

## Limits
Long status messages truncate within narrow event columns. Backend unchanged; pytest unavailable. Runtime has no Git metadata or configured GitHub remote; task repository retains changes.

## Recovery
Private preimages saved under private-preimages/logs-header. Compare current hashes before restoring.

## Handoff
Refresh Events → Logs. All timestamp refresh logic remains attached to the same status element.
