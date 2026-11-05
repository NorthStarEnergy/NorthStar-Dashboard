# Compact section menu

Section navigation now uses a 180 px desktop rail (previously 230 px) and a 140 px rail below 850 px. Rows use 12 px text, 6 px vertical padding, and tighter tree indentation; long names wrap. Bold uppercase naming and nested navigation remain available.

Tabs and full module content move left with the rail. Floating window placement reads the actual main padding, keeping its offsets aligned with desktop and narrow layouts. Saved module dimensions and positions are not rewritten.

Validation: module-workspace browser scenarios passed, including desktop/narrow rail widths, tab clearance, horizontal overflow, navigation, floating resize, edits, and reload persistence. Rendered Tools screenshot inspected. Full Python suite result recorded in the commit. Clean release preflight and isolated release checks run after commit.

Suggested future additions: a collapse toggle to reclaim the rail width, plus a quick module filter for large trees.
