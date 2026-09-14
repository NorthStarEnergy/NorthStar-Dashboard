# Control-room dashboard overlay

This folder is an overlay for the live Python control-room dashboard (Drive canonical folder [control-room-dashboard](https://drive.google.com/drive/folders/1RXFDiyIkQt4MyGRthy5XiZ5wDETmXLRW)). It does **not** replace `ieso_backend.py`, `northstar-clean.html`, or the abandoned nested vinext starter.

The Next.js connectivity board lives in `../outage-stitch` (Origin: [force-of-nature-genetics/outage-stitch](https://cursor.com/codebase/force-of-nature-genetics/outage-stitch)).

## What this overlay adds

| File | Role |
|---|---|
| `outages-workspace.js` | Drop-in replacement for Drive file `outages-workspace.js`. Adds **OPEN CONNECTIVITY BOARD** (http://127.0.0.1:43147) and a per-outage **CONNECTIVITY** button. CREATE PLAN / CLOSE are unchanged. |
| `northstar_outage_connectivity.py` | Same UWPC rules as `outage-stitch/lib/connectivity.ts`. Hold-off is not a work permit. Live UWPC blocks close. |
| `fixtures/seed-board.json` | Seed exported from the Next board (`OUT-24081` fully connected, `OUT-24092` blocking gaps). |
| `tests/test_outage_connectivity.py` | Mirrors `outage-stitch/lib/connectivity.test.ts`. |

## Dual-run (preserve current work)

1. Python dashboard on loopback **:4180** (existing operator gate, hostname split, session cookie rules — do not change).
2. Connectivity board: `cd outage-stitch && npm install && npm run dev` → [http://127.0.0.1:43147](http://127.0.0.1:43147).

Override the board URL from the dashboard with `window.NORTHSTAR_CONNECTIVITY_URL` if the Next app is not on 43147.

## Close-gate (optional, do not weaken existing tests)

In `ieso_backend.py` close handler, after loading the outage and before `store.close_outage`:

```python
reason = close_outage_blocked_reason(connectivity_board, outage_id)
if reason:
    self.send_error(409, reason)
    return
```

Build `connectivity_board` from store outages + UWPC links when that table exists. Until then the Next board remains the linking surface; the Python register stays the operator outage list.

## Tests

```bash
python3 -m unittest control-room-dashboard.tests.test_outage_connectivity
# from this directory:
python3 -m unittest tests.test_outage_connectivity
```

Apply `outages-workspace.js` back to Drive file id `1r2BWtPiMojhMhk4bzvpMYN0WB5y7uGEE` when promoting this overlay. Do not commit `.env.local` or live SQLite files.
