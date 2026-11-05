# Demo shared dashboard — 2026-10-24

## Request
Demo/demo sees the same dashboard as Ryan, except red-marked menu sections.

## Changes
Return platform_demo sessions to northstar-clean.html and load the shared dashboard assets. Preserve existing red-menu rules for Engineering, Outages, Games, Development and restricted Operations/Tools modules. Wait for session resolution before registering modules. Block red modules through direct popout URLs and saved overview pins. Preserve synthetic demo crew and read-only writes. Known permitted read APIs and an explicit static asset manifest replace the isolated shell allowlist; unknown APIs, private files and document-search paths remain denied.

## Verification
Browser check against an isolated actual backend: shared dashboard renders, no page JavaScript errors, non-red Operations menu is correct, red top-level menus absent, red APIs/files refused and direct restricted popout refused. Authentication, role, roster and menu access regression results recorded in tests.log. Fixture weather is intentionally empty; external forecast provider returned throttling during rendering.

## Runtime
Source installed in canonical local runtime. Backend restart required; current elevated process cannot be restarted by this task. Use Restart-NorthStar-Demo.ps1 as Administrator, then sign in again.

## Recovery
Private preimages saved under private-preimages/20261024-demo-menu-access. Compare current hashes before any restore.

## Delivery
Source, tests, explicit asset manifest, browser harness and restart script recorded in task repository. No configured GitHub remote or verified Drive delivery target.

## Limits
Production login verification remains pending the restart. Cross-section AI/document retrieval and operator writes remain blocked to prevent access to red-section records. No roles, credentials or operating records changed. Raft Lake decoder and concurrent dashboard changes preserved.
