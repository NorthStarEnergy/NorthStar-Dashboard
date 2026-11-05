# NorthStar Manager

Source snapshot of the Manager installed on this workstation, imported 2026-11-05. The dashboard application's source is in `../northstar-app/`; Games is in `../northstar-games/`.

`package.json` starts `desktop/manager-main.cjs`. The `desktop/` folder includes the Manager controls, dashboard window, preloads, HTML, styles, and icons. These files are copied unchanged from the installed Manager's `resources/app` folder; this preserves the actual installed Manager, which may differ from the `../northstar-app/desktop/` packaging sources.

`workstation-scripts/` preserves the PowerShell launch, stop/restart, backend, games, tunnel, and startup-task scripts used by this PC. They are source copies, not an installation procedure: in the installed layout they reside in `C:\Users\User\NorthStar`, beside `northstar-local`, `games`, and the Python runtime folders. Manager resolves `Manage-NorthStar.ps1` from the parent of its configured project root.

The existing `northstarProjectRoot` in package.json points to this PC's installed dashboard. `NORTHSTAR_PROJECT_ROOT` can override it. Running the Manager against this installation can control the real backend. Do not run the startup-task installer just to preview the source.

The Electron runtime and other installed dependencies are not committed. Neither are production readiness state, credentials, tunnel tokens, logs, databases, saved sessions, or private runtime data. A fresh clone needs its own dependencies and explicitly configured installation; this snapshot is not a standalone installer or a backup of operational records.

Verification: all 978 imported dashboard source/asset files match the installed dashboard byte for byte. All 18 installed Manager application files and six workstation scripts were copied with SHA-256 verification. Manager JavaScript and PowerShell syntax were checked without starting the Manager or changing running services.
