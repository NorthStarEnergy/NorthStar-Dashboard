# Popout overview and header repair — 2026-10-22

## Request
Remove station gaps, default to the same list as the main overview, fix the compressed logbook and overlapping market/weather panels.

## Implementation
The shared station-display controller now defaults to List in both windows and preserves explicit subsequent choices. Both use the existing field-roster component without a separate list renderer. Graphical station cards retain geographic columns, with independently measured heights and 4px vertical spacing; ResizeObserver handles changes in contents. Detached header geometry repairs legacy half-height or overlapping frames and wraps panels at smaller widths. Event rows have a readable minimum height and a scrolling viewport. Markets can fill their allocated frame. Updated asset versions load the changed scripts and stylesheet.

## Runtime
Applied five static assets to C:/Users/User/NorthStar/northstar-local after source-hash checks under the coordinator lock. Refresh the main dashboard and reopen or refresh the popout. No backend restart is needed for these static assets.

## Verification
Headless Edge with the complete dashboard and synthetic API records: identical main/popout roster markup; List default; explicit Graphical/List choice survives reload; all five header panels stay within the viewport and do not overlap at 2530, 2048, 1600, 1024, 768 and 480px; log rows remain at least 22px high; list has no horizontal overflow; graphical station spacing is 3–5px; quick-log dialog opens/closes; no browser JavaScript errors. The fixture includes a saved legacy half-height event panel and overlapping weather/market frames. Screenshots inspected. JavaScript syntax checks pass.

## Limits
The Python regression command cannot run because the local runtime lacks pytest. No backend code changed. Tests use synthetic records, not authenticated live operator writes. The checkout has no Git metadata; source and test are committed in the task repository. No configured github remote or verified Drive delivery destination is available. The previous demo-data-isolation backend activation limitation is outside this static layout change.

## Recovery
Private preimages and base hashes are saved in the task workspace. Compare current hashes before any restoration; do not overwrite later changes.

## Handoff
All requested display changes are applied. Reload is required in existing windows. Valid saved popout frames remain usable; legacy invalid geometry is repaired on rendering without changing main-dashboard layout storage.
