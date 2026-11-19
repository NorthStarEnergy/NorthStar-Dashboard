# Main-menu tool links

## Request
Add SCADA Bench and Outage Manager directly to the main menu, opening separate pages.

## Implementation
Shared scada-workbench-link.js adds native anchors in both v1 and v3. SCADA Bench uses the approved rounded gauge/grid icon. Existing submenu links remain.

## Access
SCADA Bench retains Ryan/operator visibility. Outage Manager retains operator/development visibility. No server access policy changed by this packet.

## Verification
77 JavaScript tests passed. Browser fixture passed both shells, Ryan/operator/viewer visibility, keyboard/pointer navigation, resize persistence, icon loading and duplicate checks. Python suite could not run: available Python has no pytest.

## Source state
Integrated into NorthStar Dashboard checkout at base 27c66b8; existing dirty files preserved. No commit or release created.

## Deployment
Authenticated production rendering and runtime deployment are not verified. Legacy AGENTS canonical path does not exist on this workstation.

## Follow-up
User subsequently requested standalone password demo access for both tools. Workspace-data scope awaits user response; no broader access enabled.
