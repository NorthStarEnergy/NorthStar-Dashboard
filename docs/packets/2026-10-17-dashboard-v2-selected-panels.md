# Selected v2 panel references — v0.215

Implemented the four user-selected reference directions within the optional v2 template:

- Flat Active Workers table: person, company, station, time in, last seen and presence, with approximately 26px rows. Shared profile, search, station/presence filters, refresh and Add person handlers remain available. Other roster mounts keep their existing grouped layout and controls.
- Markets & demand: RT/DA prices and demand/forecast on separate engineering-unit axes, with a compact IESO/APIROQ/demand summary. Uses the existing market-workspace adapter, matching the fixed strip. Missing observations stay missing and break the line rather than becoming zero.
- Combined Events & Outages register: compact event table, severity colors, navigable event IDs and an outage section. Displays reported status rather than inferring acknowledgement.
- Narrow plant list: source/state dots and HW/Flow/Output columns. Profile data uses neutral dots; operational state colors require the existing qualified telemetry projection.
- Detailed station popout: saved schematic, generation chart, unit table, water table, recent events and workers. SVG framing fits the actual saved drawing bounds without changing geometry or connections. Unit/water values come from the existing telemetry-only station model; unresolved readings remain unknown. Operating bands are explicitly unconfigured.
- Fixed market strip colors and text wrapping follow the reference; dispatch actions/data routing and user layout remain unchanged.

Single-row headers and native overlay More controls remain. No new operating commands, synthetic production readings, inferred topology, document links or unsupported target/forecast series were introduced. Existing labeled station-profile fallback remains for overview metrics/history. Detailed unit and water tables deliberately do not use that fallback.

## Verification

483 Python passed; 12 PostgreSQL checks skipped locally. 63 Node passed, including four new checks for independent axes, missing observations, unknown telemetry and event escaping/identity. Syntax and diff checks passed.

Disposable browser fixture: worker names open the existing profile; 6 flat rows measured 25.71px; Workers/Markets/Events panels share the same Y coordinate at 1600px. Header remains 36px. Popout More leaves unit data at y=516.974px. Diagram bounds are fitted and all saved devices remain visible. At 1024px, v2 has zero horizontal overflow and the combined event panel spans both columns. No console errors observed. Screenshots contain fixture/profile data, not authenticated live observations.

Final HTTP/preflight checks, commit, hosted CI and delivery verification are recorded in outputs/HANDOFF.md. Previous v0.214 hosted CI 39027136686 completed successfully.

## Files and delivery

Runtime: build-view-v2.js/css, build-view-panels.js, field-roster.js compact opt-in, generating-stations.js telemetry accessor, northstar-clean.html and version/cache metadata. Tests: build-view-panels.test.cjs and richer disposable build-view-v2-fixture.py.

Local delivery: outputs/dashboard-v2-selected-panels-20261017. Drive: https://drive.google.com/drive/folders/1qSZb58ZeLpU9lFMW46Wrj6KilY5ic-EB . Source ZIP is an allowlist of committed source; excludes protected layout, operational data and private backups.
