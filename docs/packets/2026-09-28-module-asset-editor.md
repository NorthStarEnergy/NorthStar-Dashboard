# Advanced module asset editor — v0.126

## Changes
The bottom-right EDIT control now opens a visual module designer. Assets mode selects individual elements inside overview, section, and fixed-header modules; Modules mode retains whole-module movement. Selected elements support pointer movement, eight resize handles, keyboard nudging, position/size inputs, font family/size/weight/style, color pickers, alignment, spacing, background, corner radius, opacity, layering, hiding, and reset.

Users can create blank modules under a selected section and add headings, text, images, shapes, dividers, and read-only live values. The asset list supports selection of hidden elements. Custom assets can be duplicated or deleted. Undo/redo covers asset changes. Drafts save in browser storage; SAVE checkpoints the complete existing layout flow, and RESET restores that checkpoint. Full, overview, and fixed presentations are independent. The Add Module toolbar action opens the new builder during editing.

Geometry remains in module-layout.js. Feed elements are not reparented or replaced with stale values. Overrides use keyed ancestors where available and are reapplied after feed DOM replacement. Built-in text content remains owned by its source; existing module settings continue to edit labels. Canvas, SVG, and embedded documents are selectable graphics rather than editors for their internal content.

## Files
- New: module-asset-editor.js, module-asset-editor.css, tests/module-asset-editor.browser.cjs.
- Integration: module-layout.js, module-workspace.js, module-workspace.css, northstar-clean.html.
- Release: scripts/bump-dashboard-version.py, BUILD-VERSION.txt, dashboard-build-data.js, web-toolbar.js cache reference.

## Verification
- Browser fixture passed: individual drag/resize and keyboard movement; cancelled drag rollback; typography; suppression of normal module actions in edit mode; keyed row replacement/reordering; fixed/full/compact saved reload; custom text; duplication/deletion; undo/redo; live data binding; asset reset; normal actions restored outside editing.
- Actual dashboard shell with read-only API fixtures passed: bottom-right EDIT integration, fixed-header styling, module mode, blank module creation, custom asset addition, persisted reopening, global RESET restoring saved assets. No page errors.
- Existing shared canvas geometry test passed.
- Dashboard version tests: 2 passed.
- JavaScript syntax checks passed for the new editor and geometry/workspace integration.
- Local port 4180 serves byte-identical editor JS/CSS, geometry, workspace and dashboard HTML. Build v0.126 recorded.
- Existing broader module-workspace browser test fails on its old star-marker expectation; the pre-change baseline already lacked that marker. Existing status-bar browser test expects five market nodes while the current header renders two. These unrelated source behaviors were not changed.

## Boundaries
Authenticated production visual verification was unavailable: browser-control initialization timed out twice; the local protected roster returned 401. Browser integration evidence uses the real shell with fixture APIs, not an authenticated live operator session. Preferences are local to the browser, not account-synchronized. Existing uncommitted and untracked work was preserved; this task did not commit or push the mixed working tree. Only an individual Drive artifact upload is performed.

Concurrent weather changes subsequently advanced the shared runtime to v0.127; this archive includes that current shared shell and its release metadata. The editor feature was introduced in v0.126.
