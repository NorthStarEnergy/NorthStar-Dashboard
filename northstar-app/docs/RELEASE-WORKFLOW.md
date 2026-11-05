# Release workflow

## Prepare

Audit pending requests before declaring a baseline. Reconcile current GitHub history with completed local changes in isolation. Attribute and review the included source; do not package a dirty directory wholesale. Update build metadata with `scripts/bump-dashboard-version.py` after reconciliation.

## Verify and publish

Run the Python suite, Node suite and relevant browser fixtures. Commit reviewed source, then run `scripts/release_preflight.py` and `python -O scripts/verify-release.py` against that exact commit. Open a pull request and wait for the Dashboard regression workflow. Configure `main` protection to require a pull request and the `regression` check where the private repository's GitHub plan supports it. Keep branch visibility private.

Tag the successful commit. Record the commit, test counts, included request IDs and remaining production verification in the packet report and handoff. Upload derived deliverables separately; never treat Drive as replacement source.

## Deployment and rollback

Deployment is a distinct step from GitHub publication. Keep production on a known verified commit, use `DEPLOY-RUNBOOK.md`, preserve operator/check-in hostname boundaries and compare served asset hashes. Verify important changes in an authenticated browser. Restart the backend only when required and authorized.

For rollback, stop the affected deployment through its normal runbook and select the previous verified tag in a separate clean checkout. Restore the code/configuration path through the deployment procedure. Preserve the current operational database and backups; never overwrite it with an old Git archive. Database migrations require a separately reviewed recovery plan.
