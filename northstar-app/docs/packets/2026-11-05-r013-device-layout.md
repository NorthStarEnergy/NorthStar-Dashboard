# r013 device proportions and label layout

## Result

Breaker scale reduced from 0.75 to 0.62; other switching symbols from 0.65 to
0.56. Generator scale increased from 0.56 to 0.68, giving a 34-unit circle
versus the unit breaker's 27.28-unit box (before strokes). Position colors and
inset breaker bars are preserved; no OFF/ON or C/O badges are reintroduced.

## Transformer geometry

All transformer drawings now use aligned vertical leads and overlapping winding
circles. The old sideways winding doglegs are removed while retaining their
original connection endpoints. The 600 V transformer also uses that convention.
No electrical connection or model parameter changes accompany the redraw.

## Labels

Primary device labels use a uniform 13-unit Helvetica/Arial font; secondary
voltage/rating text uses 11 units. Labels are positioned in each device's local
coordinates. Every unit breaker gets a 52-Gn tag beside its symbol, generators
use Gn below, and tie labels sit above the bus. Detached duplicate line/tie
labels are removed. Unverified markers have explicit anchors clear of labels.

## Verification

Chrome checked across CTS, the station/unit rows and the lower auxiliary area.
Regression checks cover generator/breaker size ratios, uniform label fonts,
straight transformer leads, inset breaker bars, topology and source provenance.
Full Python suite: 632 passed, 21 skipped, 347 subtests passed (159.88 seconds).
JavaScript suite: 72 passed. Optional PostgreSQL/browser integrations remain
skipped and unverified.

## Runtime

The local simulator serves the updated artwork and renderer. The paused review
is left open full-screen. One untouched, zero-time review session was finished
through the API to free a slot; its record/debrief was retained, not deleted.

## Provenance

Only derived runtime artwork, its generator, marker placement and regression
checks changed. Original SVG and metadata bytes and model revision 2 are retained.

## Remaining uncertainty

As-built acceptance, transformer equipment data and all previously unresolved
wiring/protection assumptions remain explicitly unverified. This is a visual
layout correction, not an engineering acceptance or native ABB rendering check.
