# Main page repair — 2026-09-11

The canonical operator page had 14 conflicting header positioning patches, nested absolute-position layout zones, and a shared default that closed the field tracker. Together these clipped weather and market cards and revived overlapping positions across reloads.

The main page now uses a responsive flow: a weather lineup, APIROQ dispatch and IESO/APIROQ pricing, the event log, field staff and tracking, and generating stations. Existing feeds, market details and worker actions remain connected. Smaller screens wrap the cards into fewer columns. New asset versions avoid mixing old scripts with the repaired page.

The existing module layout system now reorders main-page modules in flow. A one-time migration backs up prior layout preferences, clears the affected geometry, and restores staff and tracking visibility; other workspaces retain their preferences. The shipped default only seeds absent browser preferences. The backend's existing Save Layout generator still publishes the operator's saved default to all browsers; its behavior was not changed in this UI repair.

Validation also exposed a pre-existing authentication regression: the multi-account authenticator rejected the single-account configuration returned by build_config. Compatibility is restored without bypassing authentication or enabling disabled accounts. A pre-existing source assertion was updated to recognize the editor's already-escaped label variable.

Validation: 172 Python tests passed (70.59 seconds); tests/overview-layout.test.cjs passed. The latter checks old-position migration, restoration of tracking, preservation of unrelated preferences, repeated loads, malformed/blocked storage, and compilation of all dashboard script blocks. HTTP checks cover the operator entrypoint, weather and market endpoints, and new static files with no-store headers. No browser visual testing was performed.

Delivery is a repair-source ZIP, not a standalone offline dashboard: the existing protected Python/SQLite service supplies its data. No Sites deployment is used; the canonical project instructions explicitly retire that dashboard path. HTML/CSS/JS are served from disk immediately. The authentication compatibility change takes effect at the next normal backend restart; the running service already accepts its normalized account configuration.

Pre-existing work in ieso_backend.py, one-line-editor-ui.js and untracked runtime/configuration files is preserved. Credentials, operational records, live databases, and environment files are excluded from delivery.
