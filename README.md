# NorthStar Control Room

NorthStar is a Python HTTP server with SQLite and a static HTML/JavaScript operator dashboard. The canonical entrypoint is `northstar-clean.html`, served by `ieso_backend.py`. Contractor check-in and operator access have separate hostname and authentication boundaries.

## Local setup

Use Python 3.12+, Node.js 24 and Git on Windows. From a fresh clone:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt pytest
.\start-northstar.ps1 -LocalOnly -DemoLogin
```

The launcher manages local configuration and opens the dashboard. Keep local-only mode isolated from public tunnels. Normal production startup defaults to the operator access gate and loopback binding; see [DEPLOY-RUNBOOK.md](DEPLOY-RUNBOOK.md) before operating a published instance.

## Verification

```powershell
python -m pytest tests -q
node --test tests/*.test.cjs
python scripts/release_preflight.py
python -O scripts/verify-release.py
```

Release preflight requires a clean committed checkout. The isolated HTTP verifier starts a temporary backend against disposable storage; it does not use operational records. GitHub Actions also runs selected rendered browser fixtures with synthetic data. Fixture checks and HTTP routing checks do not prove authenticated production rendering or Cloudflare edge authentication.

## Source and releases

Git is the source of truth for committed releases. `data/`, credentials, local environments, generated screenshots, outputs and private coordination snapshots are excluded. Archive deliveries and Drive copies are derived artifacts.

Use focused branches and pull requests, pass the regression workflow, and tag the exact verified commit. Development on a running workstation may contain newer uncommitted source; reconcile it before creating a release. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and [release guidance](docs/RELEASE-WORKFLOW.md).

Desktop packaging uses `desktop/` and the packaging scripts. The retired static Sites pipeline redirects to the operator host; do not use the nested abandoned starter as the dashboard runtime.
