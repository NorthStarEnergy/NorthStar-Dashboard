# V2 primary site comparison

The active site workspace and detailed popout now lead with Headwater vs station output: cyan metres, green MW, separate scales, light area fills, dated ET time axis and one 28px header row.

Existing station profiles provide paired history from the same sample times. Qualified SCADA snapshots provide only their actual observations; missing values remain unavailable and single observations do not become invented history. A historian connection is still needed for live historical SCADA traces. No operational writes, v1 presentation or saved user layout changes.

Source: build-view-panels.js, build-view-v2.js/css, generating-stations.js; tests/build-view-panels.test.cjs. Version/cache metadata including web-toolbar.js and dashboard-build-data.js belongs to this change.

Validation: 65 Node and 483 Python checks passed; 12 PostgreSQL checks skipped locally. Browser fixture verified both series/axes, date labels, 28px single-row headers, saved diagram, zero movement under More overlay (y246.414px), and no horizontal overflow at 1024px. No console errors. Browser images contain fixture/profile data; authenticated production and native rendering remain unverified.

The preceding hosted run39028277962 failed its unrelated Agent-count UI assertion; it is not proof against this chart. Follow up through the pipeline audit. Other pending menu work is outside this packet and was not integrated.

Protected dashboard-layout-default.js matches its saved preimage. Source package contains allowlisted committed files only.
