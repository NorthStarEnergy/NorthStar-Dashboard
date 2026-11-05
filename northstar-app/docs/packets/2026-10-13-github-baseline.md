# Verified GitHub baseline v0.203

Reconciles the completed workstation dashboard source with four newer GitHub commits, retaining Event Log category/row/resize behavior and the later roster, weather, chart, mobile, layout, Operations Console and station pop-out work. Existing READY packets were reconciled against later integration records before preparation; remaining gaps concerned release attribution and verification rather than unapplied patches.

Repairs release checks for current cache keys, two additional substations, dynamic site selectors, optional disconnected Outlook/readiness panels and the current schema. Node fixtures now use the committed layout seed, current lone-worker/resize behavior and mocked desktop lifecycle controls. No live database is used by the suite. The legacy static redirect returns to the operator host.

Rendered station verification found compact detail spacing and its duplicate inner heading overridden by the pop-out shell. A narrow CSS specificity fix makes the intended spacing and heading removal effective on the actual fixture surface. The fixed-bar fixture verifies Ontario demand and APIROQ reserve fields independently.

Adds fresh-clone setup, contribution/release/rollback guidance, repository-contained coordination instructions, a PR template, CODEOWNERS and eight rendered fixtures to GitHub Actions. Excludes local virtual environments, scratch tests, private snapshots and the obsolete root handoff; operational databases and credentials remain excluded.

Validation before publication: 463 Python tests, 53 Node tests and eight selected browser fixtures pass. The committed-source preflight and isolated HTTP verifier are required after committing. Browser results use synthetic records; authenticated production rendering and Cloudflare JWT authentication are separate verification boundaries. No external integrations are enabled.
## Late packet reconciliation
The initial ledger scan was supplemented by a complete inbox-name audit. Historical READY/WORKING filenames were matched to later verified records rather than treated as new requests. Encoding-20261011 and the fixed-strip V3 brightness addendum were still unapplied and were reconciled in isolation. A new Spill READY packet arrived during baseline preparation and was included before final publication. The five-line toolbar request is implemented and passes the current fixed-strip fixture.

Encoding replacements are applied only to current character sequences; nine remaining corrupt sequences were repaired, with rendered tree arrows, collapse/expand and theme-brush verification. Four owned brightness values were updated. Spill adds browser-local, per-account illustrative dams/gates and movement history; it does not operate equipment, read gate telemetry or append shared server audit records. Fifty-five Spill browser checks passed.

The first hosted CI run exposed timezone-dependent conversion of an explicitly supplied build timestamp. The version script now preserves a supplied offset; its regression test passes independently of the host timezone. The final workflow runs ten rendered fixtures, including Spill and encoding controls.
