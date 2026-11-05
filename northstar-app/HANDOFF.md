# Objective
Remove station badges such as Alder Creek GS above the Overview worker module.

# Current status
Implemented locally. Rendered verification is pending due unavailable Playwright dependency.

# Changes and important files
`northstar-clean.html` removed Overview-only solo station button container. Worker/site groups are preserved. See `outputs/change-coordinator/overview-no-solo-station-row-20261013/REPORT.md`.

# Verification performed
Static source inspection passed. Crew-strip unit test fails on existing Cogent alias mismatch. Browser fixture cannot run because Playwright is not installed. Diff check reports trailing blank line at EOF.

# Decisions and constraints
Preserved unrelated dirty work, site groups, fixed dashboard crew tracker. No export artifact/Drive upload required.

# Remaining work or blockers
Verify signed-in Overview rendering and rerun browser fixture when Playwright is available.

# Fresh-chat prompt
Read this handoff first, then verify the authenticated Overview worker module has no station badge row above the cards. Continue from remaining work; investigate the existing Cogent alias test failure separately.
