# Weather date navigation — 2026-10-22

## Request
Start station forecasts on the current day and provide arrows on either side for earlier conditions and future forecasts. Fix the literal expression in the heading.

## Implementation
Use the station-local calendar date rather than the first feed date or a stale current observation. Keep all daily feed entries (seven previous days and fourteen forecast days). Render seven/fourteen entries beginning today; arrows move the window one day. Today and range selection reset the window. Past conditions, Today and Forecast labels distinguish dates; arrows disable at feed boundaries. Preserve existing historical lookup for older records. Correct the heading and version both assets.

## Runtime
Apply weather-location.js, weather-location.css and weather-location.html to the current local runtime. Refresh station tabs.

## Verification
JavaScript syntax passes. Browser tests cover a stale current timestamp and different browser timezone near midnight, initial Oct 22 through Nov 4, correct temperature alignment, both ranges, earlier dates, future dates, Today reset, both boundaries, empty feed, and 1600/768/390px arrow containment. Desktop screenshot visually reviewed.

## Limits
Daily arrows browse available feed records only. Historical data is modeled, not station observations. Backend unchanged; pytest is unavailable in the runtime. Runtime has no Git metadata; task repository stores source and tests. No GitHub remote is configured for this runtime.

## Recovery
Private preimages under private-preimages/forecast in the task workspace. Compare hashes before any restoration.

## Handoff
Reload open weather views. Prior fog fix and unrelated changes preserved. Commit tracked separately in task repository.
