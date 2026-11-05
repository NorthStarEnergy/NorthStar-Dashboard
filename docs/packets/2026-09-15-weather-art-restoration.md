# Restore coloured weather artwork — 2026-09-15

The original weather card renderer uses coloured emoji weather graphics. Overview presentation hid those source nodes and replaced them with a two-state outline SVG. This was the missing weather artwork reported by the user, not a missing market chart.

The compact renderer now displays coloured condition-specific weather graphics using the system colour-emoji font. Clear, cloudy, rain, drizzle, snow, fog and thunderstorms retain distinct artwork; unknown conditions display a dash. Each graphic has an accessible condition label. Graphics are embedded text and require no extra network requests. Existing resizing and saved placement behavior are unchanged.

The browser regression verifies all eight station graphics at six viewport sizes, plus the existing resize/persistence scenarios. The fixture screenshot is visually reviewed; test and release results accompany the package. Reload the dashboard to activate the versioned static assets. No backend restart is required.

Validation: 260 tests passed in the full run; one hostname test encountered Windows connection-abort error 10053. All 13 hostname tests passed on rerun. Five Node suites and the Overview browser suite passed. No backend code changed.
