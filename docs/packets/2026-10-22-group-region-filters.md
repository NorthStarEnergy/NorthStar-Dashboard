# Worker group outlines and region filters

## Request
Remove joined group headings, retain groups with different borders, and add All/East/West/QC filters. CEN explicitly excluded.

## Implementation
Preserve station/company ordering and company shading. Outline each geographic group in a stable distinct color; remove joined area headings. Region buttons use canonical site area, reset station selection, and expose pressed state.

## Runtime
Applied field-roster.js, field-roster.css and asset versions in northstar-clean.html.

## Verification
Browser checks pass for all four filters (20/9/6/5 fixture rows), no area headings, six distinct outlines, and toolbar widths 1600/1024/768. Syntax check passes.

## Limits
Fixture verification; no authenticated live UI inspection. Runtime has no Git metadata/remote; retained in task repository. Backend unchanged.

## Recovery
Private preimages in task workspace private-preimages/group-filter.

## Handoff
Refresh dashboard to load updated assets.
