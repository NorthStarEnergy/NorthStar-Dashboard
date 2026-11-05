# Agent navigation and fixed dashboard

NorthStar icon and text now invoke the existing menu Agent destination. The icon no longer moves the assistant sidebar into the main rail. Agent retains the main rail, preserving the fixed dashboard position and width.

Changed dashboard-build.js and northstar-clean.html (including launcher cache key); added tests/agent-fixed-dashboard.browser.cjs. Existing saved layout changes are excluded.

Verification: rendered synthetic dashboard fixture at 1440 and 1024 pixels checks visible entry points, identical Agent content geometry, unchanged fixed strip/crew/Event Log rectangles, saved fixed-layout preference, and reload. Existing notification/Event Log browser checks and 53 Node tests pass. Full Python result is recorded in the source commit and delivery report. Authenticated operator and packaged native UI were not verified.
