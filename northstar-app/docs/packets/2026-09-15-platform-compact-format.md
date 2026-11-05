# Compact platform formatting

Extended the compact section-menu rhythm across the operator dashboard chrome: 12 px monospace navigation/control text, tighter primary menu rows, compact section tabs and toolbars, and smaller module catalog/editor spacing. Existing uppercase navigation remains. Coarse-pointer devices retain 44 px control targets, and keyboard focus receives a visible outline.

Weather card presentation, saved module geometry, feed rendering, status-bar dimensions, and backend/authentication code are unchanged. No backend restart is needed; the stylesheet URL is versioned for refresh.

Validation: module-workspace, persistent-status-bar, and overview-module browser scenarios passed (including six viewport widths, navigation, resize, profile persistence and event hover). Inspected the rendered Tools catalog. Full Python suite count is in the commit; clean checkout release preflight and isolated HTTP verification follow commit.
