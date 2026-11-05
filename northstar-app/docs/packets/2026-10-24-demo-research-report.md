# Demo Research and on-demand daily report — 2026-10-24

## Request
Show Research to demo/demo and allow pulling daily report data on demand.

## Changes
Research is an allowed Operations module. Demo sees its existing pull button and can request report status, run details, allowlisted downloads, and manual refresh. Both authorization layers permit only these exact daily-report routes. Schedule changes, other data workspaces and unrelated red sections remain restricted. Demo report page hides schedule editing and the unavailable water-collection link. Existing shared report queue, rate limit and duplicate suppression apply; requests retain demo as actor.

## Verification
Actual isolated-backend browser test passes: demo opens Research, clicks Pull daily report now, queues a job as demo and reviews its state. Regression tests cover real temporary report queue, duplicate suppression, download dispatch/traversal guard, cross-origin rejection, anonymous/site-viewer denial and unchanged authentication/roster checks. Counts in tests.log. No provider capture was run by the fixture.

## Runtime
Installed source requires administrator backend restart, then browser refresh/sign-in. No credentials, roles or production report records changed during validation. Overview station tile repair preserved.

## Recovery
Private hash-checked preimages saved under private-preimages/20261024-demo-research-report.

## Delivery
Source and verification recorded in task repository. No configured GitHub remote or verified Drive delivery target.

## Limits
Full pytest unavailable in installed runtime. Live production authorization verification awaits restart. Existing report source availability and collection limitations remain unchanged.
