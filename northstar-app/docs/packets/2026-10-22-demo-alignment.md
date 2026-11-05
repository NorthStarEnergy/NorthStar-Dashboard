# Demo account alignment

## Request
Preserve Ryan's station names, populate half the 20 catalog sites with 1–3 staff and four sites with 2–5 additional contractors, and match person-name colors to company/team colors.

## Implementation
Removed server and browser station aliases. Deterministic ephemeral roster: 19 NorthStar staff and 14 contractors, across 10 occupied sites, with contractor counts 2/3/4/5 at four of those sites. Shared Crew and Overview roster names use the existing company palette. Existing account authorization remains unchanged.

## Runtime
Source installed and browser asset versions updated. Backend restart REQUIRED: scheduled-task restart could not stop listener PID 5520; direct stop returned Access denied. Existing backend remains healthy, public health and operator page return HTTP 200. Server-side changes are not yet active in that process.

## Verification
2 roster/isolation tests and 27 authentication tests passed. Browser fixture verifies 33 people in both roster views, canonical names, and computed team-matching colors at 1600/1024/768 widths. Full pytest unavailable in runtime Python. No authenticated live browser verification.

## Limits
Runtime has no Git metadata or github remote. Source retained in task repository. No Drive upload performed. No operator profile/preferences copied; demo uses shared current UI and retains its role permissions.

## Recovery
Private preimages: private-preimages/demo-alignment in task workspace.

## Handoff
Restart the NorthStar backend from an administrator session, then refresh the dashboard. Windows denied process termination from this session.
