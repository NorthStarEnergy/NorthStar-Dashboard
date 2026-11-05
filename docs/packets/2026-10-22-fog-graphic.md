# Fog graphic — 2026-10-22

## Request
Fix the broken square fog graphic across the platform, visible on KAP.

## Implementation
Replace the system fog emoji with a transparent, scalable SVG. Overview fog uses the shared renderer already used by dashboard cards, weather modules and location forecasts. Refresh script version URLs in both entrypoints.

## Runtime
Apply weather-icons.js, overview-modules.js, northstar-clean.html and weather-location.html to the current local runtime. Reload the dashboard.

## Verification
JavaScript syntax checks pass. Browser fixture verifies weather codes 45 and 48, transparent SVG rendering at 20/27/54px and the KAP card. Screenshot visually reviewed.

## Limits
Runtime has no Git metadata; task repository retains this change. Old configured Sites remote is unrelated to this runtime; no GitHub remote is configured. Backend suite cannot run because pytest is absent. No backend changes.

## Recovery
Private preimages are saved under private-preimages/fog in the task workspace. Compare current contents before restoring.

## Handoff
Refresh open dashboard and location tabs to load the corrected graphic. Operational data and existing layout preferences remain unchanged.
