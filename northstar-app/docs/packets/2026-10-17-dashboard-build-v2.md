# Dashboard Build View v2

Hamburger > Build View > v2 selects an alternate navy/teal operational template. v1 remains the default and retains its existing module layout and saved geometry.

- Idle overview: all 18 existing generating-station profiles, tiles or list with HW (m), Flow (m3/s), and Output (MW), Active Workers, market and fleet charts, recent events/outages, weather and the original fixed status strip.
- Active workspace: station list alongside focused readings, generation history, recent activity and workers.
- Detailed popout: selected saved single-line geometry uses the existing equipment catalogue and explicit connections. Exact SCADA bindings supply device names and read-only feedback; missing/ambiguous/stale feedback remains unknown. Untraced device names are editable and saved through revision-checked schematic storage. The existing builder edits topology and device bindings.

The selected view and drawing association persist in this browser. Existing qualified telemetry is preferred; configured profile values remain explicitly labelled. No plant topology or SCADA bindings are invented. No database migration or import was added.

## Validation

- 59 Node checks passed, including exact/ambiguous binding, manual fallback, saved-only wiring, stale feedback and escaping tests.
- Rendered loopback fixture checks cover toggle, persistence, 18 plants, active workspace, saved diagram, manual-name revision save, editor navigation, and tablet layout. The original canvas layout engine pauses while v2 is active, preserving v1 saved positions.
- Canonical Python: 483 passed, 12 PostgreSQL integration tests skipped locally. Committed-release checks recorded in outputs/dashboard-build-v2-20261017/REPORT.md.
- The first isolated Python run encountered Windows path-length errors in temporary test files; the canonical rerun uses a short temporary directory.
- Browser evidence uses disposable fixture data. Authenticated production rendering and packaged Electron remain separate verification boundaries.

## Integration

Prepared from 258aab7 in an isolated worktree, then contextually integrated under the coordination lock onto 6307bb6. Protected dashboard-layout-default.js was hash-checked and left unchanged. Source assets only; no service restart required for this UI change. The earlier PostgreSQL activation blocker remains outside this packet.
