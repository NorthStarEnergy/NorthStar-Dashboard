# r013 readable labels and measured clearance

## Result

Primary device labels increased from 13 to 22 SVG units with semibold weight;
secondary text increased from 11 to 18 units. This is roughly 70% larger label
geometry, with a small right margin for L3/transformer notes. The full-width
100% review is substantially more legible without enlarging the symbols.

## Placement

Unit breaker tags sit in aligned rows beneath the generator tags, keeping each
unit column together. Island bus tags, Twin line tags and explanatory captions
were moved into clear spaces. Redundant Details text and the isolated Island MW
labels were removed; engineering values remain accessible in device details.
Transformer information uses the right margin instead of crossing the G9 row.

## Measured overlap audit

The browser supplied rendered text/symbol rectangles in SVG coordinates, visible
unverified-marker rectangles, and stroked non-symbol wire paths. The reproducible
scripts/audit-r013-labels.py checks label pairs, symbols, markers, captions and
wire samples at 0.5 SVG-unit intervals with a 2-unit clearance margin. Unsupported
path commands fail the audit instead of being silently skipped.

Both normal and fullscreen exports pass with **zero conflicts**: 113 device
labels, 92 symbols, 23 unverified markers, 58 wire paths and 31 captions. Source
checks exposed and corrected Island bus, Twin station title and unit-caption
conflicts before completion. Browser screenshots were also visually reviewed.

## Regression verification

Full Python: 632 passed, 21 skipped, 347 subtests passed (156.92 seconds).
Final focused r013/HTTP checks after caption adjustments: 17 passed.
JavaScript: 72 passed. Optional PostgreSQL/browser integrations remain unverified.

## Runtime

The new review is open paused at 100% in full screen on local port 43209.
Untouched intermediate review sessions were completed through the API, retaining
their records/debriefs rather than deleting saved data. No plant controls used.

## Provenance

Only derived artwork, its generator, a clearance-audit utility and the expected
font-size regression check changed. Electrical model revision 2, original r013
source SVG/metadata bytes and all connection assumptions are unchanged.

## Unverified boundaries

The persistent draft warning, amber question marks and unknown transformer data
remain visible. As-built acceptance, native ABB rendering, protection settings,
station-service routes and other previously unknown data remain unverified.
Clearance was checked in Chrome; other browser/font rendering is not claimed.
