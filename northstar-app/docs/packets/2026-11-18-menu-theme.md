# Native menu buttons

## Request
Match SCADA Bench and Outage Manager entries to the existing NorthStar theme.
## Change
Both entries use native menu buttons and inherit dashboard typography, spacing, colours and responsive rules. Hover and focus use existing theme tokens.
## Coordination
The active Log Book task owns other sidebar entries. Its in-progress files are preserved. Completed wide-monitor packet a87e132 is included in the release ancestry.
## Verification
Both dashboard shells, operator visibility, native style parity, keyboard and pointer navigation, resizing and icon loading passed the isolated browser fixture.
## Activation
Static assets installed into source and live runtime; refresh the dashboard. No backend restart or record changes.
## Recovery
Restore the two private preimages under outputs/change-coordinator/preimages/20261118-menu-theme-01a1ec95.
## Source
Focused release based on a87e132. Publication recorded separately after regression checks.
