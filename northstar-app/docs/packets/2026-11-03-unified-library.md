# Unified Library

## Request
Make Library the home for reports, research, assets and tools, with lists and dedicated pages across v1, v2 and v3. Preserve disabled red modules.

## Changes
Shared Library navigation replaces Tools. The catalog has search, type filters and stable detail links. Seven existing research projects retain full reports and downloadable supporting evidence; daily report controls live only on the report workspace. Schematic builder and connection information open dedicated workspaces. Asset library, data workspace, flows and training remain disabled. Research leaves Operations navigation. Both module engines now enforce Ryan's restricted-module rules for opening and popouts, including v3 availability filtering.

## Verification
Isolated browser checks pass for catalog filters, research deep links and reloads, disabled asset deep links, tool routing and Library navigation in all three builds. Responsive checks pass at 1400, 768 and 390 pixels. No live writes are used in tests. Existing isolated Python regression: 549 passed, 21 skipped, 311 subtests passed, 26 failed and 8 errors, matching the recorded prior fixture baseline; no backend code changes.

## Runtime
Ten static files. Existing server authorization and underlying operational records are unchanged. Reload dashboard tabs. New Library uses the existing protected research catalog. Report and tool entries open their original dedicated workspaces directly, with a Back to Library link.

## Recovery
Hash-checked private preimages are saved before installation. Restore only the five modified existing files after checking for newer changes. The five new Library files can remain unused after removing the shell references. No data migration or service restart.

## Delivery
Source and verification in library-work. Installed manifest records before/after hashes. Source commit and publication result recorded separately.

## Limits
Assets remain a disabled catalog entry because the existing Library and Device Library were red. This does not activate asset browsing, data workspace, flows or training. UI availability is not a claim of provider health. Existing report controls and tools retain their current capabilities and server permissions.

