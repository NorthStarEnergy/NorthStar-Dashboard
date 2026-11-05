# Overview station tiles — 2026-10-24

## Request
Restore station summary tiles missing from demo Overview.

## Cause
The generating-station summary container was associated with the restricted SCADA module. The new red-module filter hid that container.

## Change
Associate the demo Overview station summary with allowed operations:sites. Operator association and restricted SCADA access remain unchanged. Updated script version.

## Verification
Isolated actual backend browser check: all 18 station tiles visible with names and basic info; shared shell, Operations menu, red endpoint/file restrictions and direct popout checks pass. Full pytest unavailable in installed runtime.

## Runtime
Installed static JavaScript and HTML. Refresh dashboard; no backend restart needed.

## Recovery
Hash-checked private preimages saved under private-preimages/20261024-overview-station-tiles.

## Delivery
Source and browser test in task repository. No configured GitHub remote or verified Drive delivery destination. Production account visual check not performed.
