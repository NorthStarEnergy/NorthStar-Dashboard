# Compact Library rows

## Request
Keep each entry to one line, reduce padding and show extra information in overlays.

## Changes
Every catalog row is 34px tall with 2px vertical padding. Titles, type, snapshot date and status are inline and truncate rather than wrap. At narrower widths, metadata moves to the details overlay. The arrow opens a native top-layer popover containing the full title, description, metadata and an enabled item link. Disabled items remain disabled. Header and filter spacing is reduced.

## Verification
Browser checks cover all builds, filters, detail routes and disabled assets. At 1400, 768 and 390px, every row stays 34px tall and no horizontal overflow occurs. Opening a popover leaves all row geometry unchanged; popovers stay within the viewport and close with Escape.

## Runtime
Only library.css and library.js change. Refresh the Library page; no backend restart or data changes.

## Recovery
Original files preserved in private-preimages/20261103-library-compact. Manifest records before/after hashes. Restore only these two files after checking for later changes.

## Delivery
Source, compact manifest and browser verification in library-work.

## Limits
Long titles are ellipsized in the row; their full text remains in the overlay and dedicated page. Narrow screens omit date/status columns, retaining those values in the overlay.
