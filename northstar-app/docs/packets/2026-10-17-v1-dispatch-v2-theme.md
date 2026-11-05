# V1 fixed dispatch matches v2

User requested the v2 dispatch layout in v1's fixed top dashboard. Browser comparison confirmed both views already use identical dispatch markup, controls and saved geometry; only inherited palette differed. Scoped v2 theme variables to the shared fixed dispatch module so v1 has the same dark blue panel and text colors, retaining existing status colors and editor geometry.

Source change: build-view-v2.css. HTML asset key and build/cache metadata updated. No dispatch JavaScript, telemetry, acceptance handler or saved layout changes.

Browser fixture at1600x1000: final v1 matches original v2 exactly for module/title/metrics/OR badge/reserve/Accept positions, dimensions, font, foreground and background. Panel136x112px atx868.993/y0; Accept remains disabled for absent instruction; zero browser errors. Screenshot contains fixture data. Authenticated production and native app rendering not verified.

483 Python and 65 Node checks passed; 12 PostgreSQL checks skipped locally. Final committed-release results recorded in delivery handoff. Protected dashboard-layout-default.js retained unchanged.
