# Packet 27 — one-line catalogue 2026.2

**Date:** 2026-09-03  
**Live target:** `https://ops.northstarenergy.ca/`  
**Tag:** `packet-27-one-line-catalogue-2026-2`

## Why

Packet 24 shipped an IEEE compatibility sketchbook whose client profile id did not match the
server stamp, wires ran through glyph centers, switching devices had no drawn OPEN/CLOSED
position, and the library lacked the distribution devices a UWPC package actually uses.

## Catalogue identity

`one-line-symbol-catalogue.json` is the explicit catalogue. Python loads it; the editor and
library expose the same strings; tests eval the browser library and require the three copies to
match.

- Profile: `northstar-ieee-compat-2026.2`
- Graphics: IEEE/ANSI 315-1975 convention (inactive-reserved)
- Designations: IEEE C37.2-2022 (active)
- This remains a compatibility profile, not a certified utility legend, live equipment state,
  or operational release.

Server `_normalise_one_line_record` now stamps those strings itself. A client cannot rename the
profile on save.

## Shipped behavior

- Shared profile id on client JSON, server records, and the catalogue file.
- Terminal snap points, including bus-span projection. CONNECT can target a port.
- Drawn OPEN/CLOSED on isolation/switching devices (disconnect, breaker, fuse, load-break,
  recloser, sectionalizer, grounding switch, ATS). Inspector copy states this is a drafting
  position, not live state.
- Δ/Y winding configuration on two-winding, three-winding, and autotransformers.
- Utility-critical types: recloser, sectionalizer, load-break, grounding switch, ATS,
  three-winding transformer, autotransformer, PT. Legacy `edge` is accepted on the server so old
  drafts are not silently rewritten as utility sources.
- Unknown types are dropped, not drawn as an AC source.
- The empty-canvas hint no longer paints over a populated drawing (`display:grid` had
  overridden the `hidden` attribute).
- Version-3 records carry `catalogueVersion`, `operatingState`, `windingConfig`, and
  `fromTerminal` / `toTerminal`. Version-1 local drafts and version-2 server records still load.

## Safety boundary

Drawn OPEN/CLOSED is schematic annotation for a switching package. It does not command
equipment, authorize isolation, or replace the utility's approved symbol catalogue. Ready-for-review
still requires the operator-supplied utility symbol-profile approval reference when a schematic
is attached.

## Verification

- JavaScript syntax checks passed for the symbol library and editor.
- Focused catalogue, switching, engineering, and hostname-containment checks: 37 passed.
- Full suite: **194 passed**.
