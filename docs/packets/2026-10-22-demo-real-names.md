# Real site names in demo

## Request
Use Ryan's real station names throughout demo mode.

## Implementation
Demo API response compatibility translates legacy backend aliases into canonical names, including nested values and keys. Operator responses are unchanged. Existing backend source already uses canonical names.

## Runtime
Updated operator-session.js and dashboard asset version. Refresh activates compatibility without a backend restart.

## Verification
All 21 station/system aliases checked, including overlapping Iroquois Falls names and operator response isolation. JavaScript syntax passed.

## Limits
Existing backend still needs administrator restart to activate prior staffing changes. No authenticated live session inspected.

## Recovery
Private originals in private-preimages/demo-names.

## Handoff
Refresh demo dashboard to load real site names.
