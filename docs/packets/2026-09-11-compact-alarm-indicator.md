# Compact alarm indicator — 2026-09-11

- Removed the large persistent Overview Events card, its title, filters, search field, and quick-entry field from the cross-section dashboard header.
- Added a compact persistent `Alarms (n)` button that opens the full Events workspace.
- Counts open market alarms and field-help alarms together.
- Uses a restrained pulse only while at least one alarm is unacknowledged; acknowledged/open alarms remain visible without flashing.
- Respects reduced-motion preferences.
- Verification: HTML and both new assets returned HTTP 200; JavaScript syntax passed; 209 tests passed.
