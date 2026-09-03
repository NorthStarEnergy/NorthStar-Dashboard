# Packet 28 — one-line catalogue 2026.3

**Date:** 2026-09-03  
**Live target:** `https://ops.northstarenergy.ca/`  
**Tag:** `packet-28-one-line-catalogue-2026-3`

## Why

The shop drawing sheet (Figure A-1 circuit notation) and the workplace one-line
switching glyphs were close to, but not the same as, the IEEE compatibility sketches
in catalogue 2026.2. Operators asked for the symbols they actually use.

## Catalogue identity

`one-line-symbol-catalogue.json` remains the explicit catalogue. Python loads it; the
editor and library expose the same strings.

- Profile: `northstar-ieee-compat-2026.3`
- Notation source: Workplace Figure A-1 circuit notation
- Workplace switching glyphs for line switch, breaker, circuit switcher, and fuse
- Graphics: IEEE/ANSI 315-1975 convention (inactive-reserved) where the shop sheet
  does not override
- Designations: IEEE C37.2-2022 (active)
- This remains a compatibility profile, not a certified utility legend, live
  equipment state, or operational release

## Workplace switching glyphs

- **Line switch** (`disconnect`, alias `line-switch`): circle with a line through it.
  Closed aligns the line with the circuit; open rotates that line 90°.
- **Circuit breaker**: the same rotary contact, with a square around it.
- **Circuit switcher** (`circuit-switcher`, aliases `circuit-switching` /
  `circuit-switch`): circle, line, and square, with the line drawn through the square.
- **Fuse**: an open-switch arm with the fuse cartridge on the blade. Closed lays that
  arm into the circuit; open swings the fused arm away.
- Load-break and sectionalizer use the line-switch rotary contact. Recloser uses the
  boxed breaker contact.

## Figure A-1 circuit notation

Palette group **Circuit notation**: capacitor, resistor, light resistive sensor,
diode, transistor, inductor, switch, lamp, power, potentiometer, LED. Ground and
motor already matched the sheet and stay in Network / Primary equipment. The
workplace typo `capacitior` is accepted as an alias of `capacitor-element`.

`LOAD CIRCUIT EXAMPLE` places a Figure A-1 fragment on the canvas. `LOAD EXAMPLE`
still loads the feeder one-line, now including a circuit switcher.

## Safety boundary

Drawn OPEN/CLOSED is schematic annotation for a switching package. It does not
command equipment, authorize isolation, or replace the utility's approved symbol
catalogue.

## Verification

- JavaScript syntax checks passed for the symbol library and editor.
- Full suite: **196 passed**.
