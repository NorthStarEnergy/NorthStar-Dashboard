# Cursor workspace copy on Google Drive

Snapshot date: 2026-09-14  
Git branch: `cursor/merge-outage-stitch-694d`  
PR: https://github.com/footmenfrenzyremaster/cannaboard/pull/1

The live Python dashboard was **not** overwritten. `.env.local` and SQLite files were **not** copied.

## Where the Cursor data landed

| What | Drive folder |
|---|---|
| Full source tree (Next.js + overlay) | [cursor-from-git](https://drive.google.com/drive/folders/1TuuYfi33gjBqp4eBsvdR4wm9aEmU-yfD) |
| Reconstructable archive (base64 parts + `RECONSTRUCT.sh`) | [archive](https://drive.google.com/drive/folders/1gqnlYrEuBgSXG_EBjmluD98snknKR5jR) |
| Overlay beside the live dashboard (does not replace live JS) | [cursor-overlay](https://drive.google.com/drive/folders/1jlBSxfr_8oFCU_wR89OIACzLpOlu2F6I) |
| Cursor Platform / outage-stitch (parent) | [outage-stitch](https://drive.google.com/drive/folders/1AgBNR9cqU5vENV5SiX4T8BUKwIxwcguV) |
| NorthStar / Cursor / outage-stitch | [outage-stitch](https://drive.google.com/drive/folders/1zmtlWIypzy_yqzmNi02Zmh4bHMIU8Qv3) |
| Live control-room dashboard (canonical, unchanged) | [control-room-dashboard](https://drive.google.com/drive/folders/1RXFDiyIkQt4MyGRthy5XiZ5wDETmXLRW) |

## Apply the overlay (optional)

Live `outages-workspace.js` id `1r2BWtPiMojhMhk4bzvpMYN0WB5y7uGEE` is still the operator file.

To add **OPEN CONNECTIVITY BOARD** / **CONNECTIVITY**:

1. Download [outages-workspace.overlay-from-git.js](https://drive.google.com/file/d/1Qp7jAktw8IyIeCEHKHVAZhqYBHrZCwXH/view?usp=drivesdk) from `cursor-overlay`.
2. Keep a copy of the live file.
3. Replace the live file contents only when you are ready.

Connectivity Python port: [northstar_outage_connectivity.py](https://drive.google.com/file/d/1CGxEkUyZ2pi9bCcoXTEgIojZX1mNenIu/view?usp=drivesdk) in the same overlay folder.

## Rebuild the tarball

Download every `cannaboard-cursor-workspace.tgz.b64.partNN` (28 files, skip any duplicate that is not 7000 bytes except part28 which is 1768 bytes) and `RECONSTRUCT.sh` from the archive folder, then:

```bash
bash RECONSTRUCT.sh
```

Expected SHA-256:

`1db47fe0cb122272ea85c188cdabaef99ce3594be4f4f345a9cde8d3a5b0bc1f`

The tarball includes `package-lock.json` and `favicon.ico` (those two were too large/binary for per-file Drive upload).

## Dual-run

| Board | Port |
|---|---|
| Python dashboard (Drive tree) | `:4180` loopback |
| Connectivity Next app | `:43147` |

Hold-off is not a work permit. CREATE PLAN / CLOSE stay as they are.
