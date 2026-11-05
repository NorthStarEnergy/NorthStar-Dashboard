# Packet 24 — IEEE Compatibility Symbol Library

**Date:** 2026-08-26  
**Live target:** `https://ops.northstarenergy.ca/`  
**Tag:** `packet-24-ieee-symbol-library`

## Standards basis

- [IEEE/ANSI 315-1975](https://standards.ieee.org/ieee/315/515/) is the IEEE graphical-symbol
  reference used as the library's one-line convention. IEEE currently lists it as
  **inactive-reserved**, so the product does not label the graphics as an active IEEE standard.
- [IEEE C37.2-2022](https://standards.ieee.org/ieee/C37.2/6043/) is the active IEEE standard used
  for electrical power-system device function numbers, acronyms, and contact designations.
- This is an explicit compatibility profile, not an engineering certification or a substitute
  for the utility's controlled drawing standard, approved symbol catalogue, or qualified-person
  review.

## Shipped behavior

- 21 searchable symbols in Network, Primary equipment, and Measurement & protection groups.
- AC source, bus, line/cable, junction, terminal, ground, disconnect, circuit breaker, fuse,
  transformer, generator, motor, capacitor bank, reactor, battery, surge arrester, load, CT, VT,
  protective relay, and lockout relay.
- C37.2 designation field with curated common choices including 25, 27, 32, 46, 49, 50/50N,
  51/51N, 52, 59, 67, 81, 86, 87, and 89; custom suffixes remain accepted.
- Symbol tooltips and inspector identify whether geometry follows the 315 convention or the item
  carries a C37.2 designation.
- Version-2 JSON exports include the symbol-library profile and both standards references.
- Existing version-1 local drafts and imported records are normalized and retained.
- Imported ids, labels, coordinates, rotations, and designations are bounded before rendering.
- Status updates now retain the symbol/connection counter, fixing selected-symbol inspection after
  a canvas change.

## Verification

- JavaScript syntax checks passed for the symbol library and editor.
- Focused engineering, switching, symbol-library, and hostname-containment checks: 24 passed.
- Full suite: **145 passed**.
- Authenticated live smoke: Engineering opened; symbol search filtered correctly; capacitor and
  relay insertion rendered; C37.2 inspector choices appeared; count updated; no one-line-editor
  runtime errors were recorded.
- Operator assets returned HTTP 200 on `ops.` and remained HTTP 404 on public `checkin.`.

## Files

- `one-line-symbol-library.js`
- `one-line-editor-ui.js`
- `one-line-editor.css`
- `northstar-clean.html`
- `tests/test_one_line_symbol_library.py`
