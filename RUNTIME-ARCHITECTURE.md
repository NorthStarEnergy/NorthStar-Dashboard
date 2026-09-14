# NorthStar runtime contract

NorthStar has two intentional layers:

- `vinext` builds the public authentication landing shell at `/`.
- `ieso_backend.py` serves the authenticated operator console at
  `/northstar-clean.html` and owns the operational `/api/*` routes.

Use `start-northstar.ps1 -LocalOnly -NoBrowser` for local operator testing.
The production operator URL is configured by `NORTHSTAR_OPERATOR_HOST`.

The Vinext server is not an operator API server. A successful `npm run build`
therefore verifies the landing shell only; the backend smoke check must also
pass before a release is considered ready.
