# Shared research and AI navigation

## Request
Use NorthStar's normal navigation on research pages. Let AI replace the left menu with a collapsible NorthStar rail, consistently across builds.

## Changes
Library and its dedicated research pages now render within the real dashboard shell. The compact catalog and details overlays remain intact. AI owns the left rail; a full-height 14px arrow bar reveals or collapses the default NorthStar menu. Escape collapses it. Leaving AI restores normal navigation. Saved asset geometry no longer positions AI navigation items. Red modules remain disabled.

## Verification
Isolated browser checks pass for v1, v2 and v3: research with the actual default menu, disabled modules, AI rail geometry, menu toggle, Escape, and return to Overview. Library catalog/filter/deep-link/tool checks pass. Required Python regression: 549 passed, 26 failed, 21 skipped, 8 errors, 311 subtests passed; the same existing fixture failures as the preceding packet. Static-only change, no Python changes.

## Runtime
Install the nine manifest-listed static files with source-drift checks and preimages. No restart required. Operator authentication and operational data remain unchanged.

## Recovery
Private preimages are in private-preimages/20261103-navigation-shell. Restore only manifest-listed files after checking for subsequent edits; remove the two new navigation assets if rolling back.

## Delivery
Source and verification scripts in navigation-work. GitHub publication remains blocked by unavailable repository credentials from the preceding attempt.

## Limits
Synthetic browser fixtures return incomplete feed API data and produce existing feed-rendering errors; authenticated visual verification is recorded separately. Source packaging excludes runtime data and preimages.

Authenticated verification: Ryan session shows the default research navigation and working AI open/close rail. Final fixed dashboard alignment checked live. Library rows remain 34px with unchanged geometry when overlays open at 1400, 768 and 390px.

Source commit: 95d1299; tag packet-20261103-navigation-shell. GitHub publication blocked by missing credentials.
