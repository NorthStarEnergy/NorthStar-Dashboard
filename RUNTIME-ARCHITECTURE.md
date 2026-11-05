# NorthStar runtime contract

NorthStar has two intentional layers:

- `vinext` builds the public authentication landing shell at `/`.
- `ieso_backend.py` serves the authenticated operator console at
  `/northstar-clean.html` and owns the operational `/api/*` routes.

Use `python scripts/verify-release.py` for isolated release testing. It tests
committed HEAD in a temporary source tree and database with the Access gate
enabled. It also checks anonymous requests and forged headers on the public
hostname are refused. Synthetic local headers do not verify Cloudflare JWTs.

Use `start-northstar.ps1 -DemoLogin -LocalOnly -NoBrowser` for manual local
operator testing after configuring a local demo credential. `-LocalOnly`
alone does not disable authentication or create an operator session.
The production operator URL is configured by `NORTHSTAR_OPERATOR_HOST`.

The Vinext server is not an operator API server. A successful `npm run build`
therefore verifies the landing shell only; the backend smoke check must also
pass before a release is considered ready.

Release sequence: run the Python suite; commit and tag source; run
`python scripts/release_preflight.py`, `python scripts/verify-release.py`,
`python scripts/restore_drill.py`, and `npm run build`. Keep `.env.local`
in place: it is ignored by Git and must never enter the release archive.
Before production promotion, validate the actual edge login, public-host
isolation, restart/reboot recovery and rollback using the deployment runbook.
