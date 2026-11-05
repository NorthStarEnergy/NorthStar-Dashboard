# Daily report PDF export

## Request
Add an Export PDF button to the daily report.

## Changes
Browser PDF download bundles pdf-lib 1.17.1 with its MIT license in the existing allowed script. Includes all selected-run readings, timestamps, review notes and ordered captures. No new routes or permissions. Pending runs disable export; failures display notices.

## Verification
Edge browser fixture downloaded a valid 15-page PDF with all readings despite an active unmatched filter and 10 embedded captures in report order. First page rendered and visually checked.

## Runtime
Refresh the daily-report page for the button. Earlier latest-reading backend changes still require the previously documented restart; this feature adds no restart requirement.

## Recovery
Hash-checked integration; private preimages under private-preimages/20261024-report-pdf-export.

## Delivery
Source packet in task repository. No GitHub remote or verified Drive destination.

## Limits
Exports the prepared review snapshot, not the original Excel template. Missing capture downloads are explicitly labelled. Provider failures remain visible; no values fabricated.
