# Workstation source import — 2026-11-05

This repository contains a source snapshot from the active workstation installation at `C:\Users\User\NorthStar\northstar-local`. It includes the current Python backend, dashboard variants, desktop shell, static assets, documentation, scripts, and tests. The existing application was not modified or restarted during the import.

978 existing files were copied with SHA-256 verification. `.gitignore` and this import note were added for the repository. Local credentials, operational data and databases, environment files, tunnel configuration, generated screenshots, caches, logs, and delivery archives were excluded. Configure credentials and local data separately using the setup documentation.

This is a source preservation import, not a verified release. Python regression execution was attempted but the workstation Python environment does not contain `pytest`. The Node test run reported failures in `canvas-layout.test.cjs`, `crew-strip.test.cjs`, and `device-library-ui.test.cjs`; these files and the application source are preserved unchanged. The canvas fixture lacks `document.body.matches`. Passing the complete regression suite remains necessary before a future release.

Older documents retain references to the previous workstation and earlier deployment history. For this import, the source location above and this repository's Git history identify the preserved snapshot. See `README.md` for application setup.
