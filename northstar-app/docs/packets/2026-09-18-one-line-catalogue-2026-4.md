# One-line catalogue 2026.4 — 2026-09-18

Synced `one-line-symbol-catalogue.json` to the symbols already present in
`one-line-symbol-library.js` under profile `northstar-ieee-compat-2026.4`.

## Added visible symbols

- `breaker-vacuum`, `breaker-sf6`, `hv-interrupter`
- `fuse-dropout`, `disconnect-mod`
- `transformer-gsu`
- `cvt`
- `meter-ammeter`, `meter-voltmeter`, `meter-kwh`, `meter-multifunction`

## Aliases

Added workplace aliases for HVI, vacuum/SF₆ breakers, cutouts, MOD, GSU, CVT/CCVT,
and metering (`ammeter`, `voltmeter`, `kwh` / `energy-meter`, `multifunction` / `pq-meter`).

## Verification

- Dashboard cache-bust: `one-line-symbol-library.js?v=20260918-4`
- Catalogue labels in `northstar-clean.html` and editor status text bumped to 2026.4
- Regression coverage in `tests/test_one_line_symbol_library.py` and
  `tests/test_switching_workflow.py`

No security-gate changes. Existing symbols retained.
