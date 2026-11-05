# Worker list grouping — 2026-10-22

## Request
Reduce name text, separate areas with stronger borders, match fixed-dashboard site groups, shade and border companies, and keep NorthStar crews first at each site.

## Implementation
Overview names and site headings are 13px. Geographic headings have 3px borders and sites have 2px borders. The fixed dashboard publishes its existing five site groups for the roster to reuse. Each site appears once; NorthStar and NorthStar Energy share the first company block. Other companies have stable colored shading and borders. Alone badges and priority within each company remain. Iroquois TS aliases resolve to the existing 230 kV site. Unknown sites remain visible in Other sites.

## Runtime
Allowlisted changes: field-roster.js, field-roster.css, dashboard-chrome.js. Reload the dashboard after application. No backend or operational record changes.

## Verification
Browser fixture checks pass at 1600, 1024, and 768px: site order, alias merge, no duplicate site sections, NorthStar priority, company colors, name size, borders, search and no horizontal overflow. Screenshot reviewed. JavaScript syntax passes.

## Limits
Backend suite could not run: bundled Python has no pytest. Runtime has no Git metadata or configured GitHub remote; source and verification are retained in the task repository. Browser checks use synthetic records, not an authenticated production session.

## Recovery
Private original files are stored outside the served runtime in the task's northstar-roster/preimages folder. Integration compares baseline hashes before changing runtime files.

## Handoff
Refresh the browser to load the new list. No service restart is necessary for these static assets.
