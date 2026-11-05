# NorthStar data workspace

Open **Tools → Data workspace → Open data workspace** while signed in as an operator, or visit `/data-workspace.html` on the operator hostname.

## Storage and layout

The new workspace uses PostgreSQL, database `northstar_data`, schema `ns_data`. Its eight typed datasets cover unit runtime, power/energy, water/flows, weather, operations, generators, equipment, and fish/environment. All operational tables start empty. Each record carries an ID, revision, timestamps and operator identity.

The existing SQLite control-room store and earlier data-foundation layout remain separate and unchanged. This release does not import Excel/CSV files, synchronize existing sources, or seed operating records. The schema source is `northstar_data_model.py`; `northstar_data_workspace.initialize` installs it idempotently.

## Work with records

- Choose a dataset. Filters start closed; add up to twelve conditions and click **Apply filters**. Only applied filters control the grid, charts and script scope. Text search, numeric comparisons and date comparisons run in PostgreSQL.
- Choose visible columns and stored-column sorting. The grid loads 100 records per page; the API caps requests at 200. Save a personal view to retain filters, sorting and columns.
- Click a row or **New record** for typed editing. Dates entered in the editor use the browser's local timezone and are stored in UTC. Date filters require explicit timezone-aware ISO timestamps.
- Edits require the current revision. Conflicting changes are rejected. History retains before/after values and operator identity. **Restore values** loads an older revision into the editor; saving creates a new revision.
- **Export page** downloads the visible page and columns, not the entire dataset. Spreadsheet formula prefixes in text are escaped.

## Formulas, scripts and charts

Calculated columns are shared, versioned numeric expressions, evaluated on the server. They support field names, arithmetic, comparisons, lowercase `and/or`, `ABS`, `ROUND`, `SQRT`, `FLOOR`, `CEIL`, `MIN`, `MAX`, `COALESCE` and `IFELSE`. Example: `ROUND(power_mw * interval_hours, 3)`. Division by zero returns missing. Formula dependencies are checked for cycles. Twenty calculated columns per dataset; expressions are limited to 800 characters and 150 syntax nodes. Calculated fields can be filtered, but sorting currently uses stored columns.

Scripts are reusable, private calculation workflows: one `SET numeric_field = expression` statement per line, at most eight assignments. Every assignment uses original row values. Preview freezes source, applied filters and formula definitions, shows the affected count and ten sample rows, expires in ten minutes, and can run once. Records changed after preview are excluded.

Two background worker threads execute jobs, with an eight-job queue and a ten-minute job limit. Jobs commit batches of 250 records, retain row history, show progress and support cancellation between batches. Completed batches remain committed if cancelled, interrupted or failed. They are not an all-or-nothing transaction. After a restart, abandoned jobs are marked interrupted once their last update is fifteen minutes old.

This is a deliberately bounded calculation language: **Excel cell formulas, VBA macros, arbitrary Python, SQL, file access and network scripts are not supported**. No arbitrary code is executed.

Charts aggregate numeric fields or formulas by date/category, with average, sum, min or max; line/bar views and a plotted-value table. Time buckets use UTC. Missing numeric values are excluded and valid/source counts are shown. Charts cap at 500 groups and disclose truncation. Chart definitions and scripts are saved per operator.

## Windows installation and operation

Run `powershell -ExecutionPolicy Bypass -File scripts/install-data-postgres.ps1`. The installer uses the official EDB PostgreSQL 18.6 Windows binaries with a pinned SHA-256, installs psycopg, creates a SCRAM-authenticated cluster on loopback port 5433, and installs the empty schema. An existing unknown cluster is never overwritten.

Private files are under ignored `data/postgres-runtime/` and `data/.northstar-data-postgres.json`, protected for the current Windows user and SYSTEM. Do not copy them into source packages or Drive. The application role has no superuser, role-creation or database-creation privilege.

`python scripts/setup-data-postgres.py --start-only` starts the configured cluster if needed. `start-northstar.ps1` also starts configured PostgreSQL before launching a new backend. Its existing early return when a healthy backend already runs is preserved; use the explicit start command if only PostgreSQL needs recovery.

`python scripts/backup-data-postgres.py` creates a custom-format backup under private `data/postgres-runtime/backups/`. Protect backups like the database. Use PostgreSQL `pg_restore` into a separate empty database first and verify tables/counts before planning any production restore. Credentials must never be put in command arguments or logs. Backups are manual in this release; no unattended schedule or off-machine recovery is configured.

PostgreSQL startup is tied to the existing launcher. A new Windows service, reboot recovery, high availability and unattended maintenance are not configured or claimed by this release.

## Capacity and access boundaries

PostgreSQL stores records, rather than spreadsheet cells. Bounded page retrieval keeps the browser from loading millions of cells. Server indexes cover station, equipment, dates and update time. Query/lock timeouts protect interactive requests. Performance depends on hardware, indexes, filters and expression complexity; no unrestricted multi-million-cell spreadsheet recalculation claim is made.

The existing operator hostname/session gate remains in force. The public check-in hostname cannot access the APIs. Site-viewer/platform-demo accounts cannot use the workspace; authenticated operators share datasets/formulas, while saved views/scripts/charts are personal. Record and configuration revisions are audited.

Future work, when authorized: mapped import staging with validation/provenance/deduplication, data-owner retention rules, normalized station/equipment references, workload-specific indexes/partitioning, scheduled backups and service monitoring. Existing records are never inferred or imported by this setup.

## Verification

Actual PostgreSQL tests create and drop uniquely named `ns_test_*` databases. Set `NORTHSTAR_PG_TEST_ADMIN` to a protected administrator-config JSON path, or `NORTHSTAR_PG_TEST_DSN` to an explicit disposable-server DSN. Add `NORTHSTAR_DATA_BROWSER=1` and provide Playwright via `NODE_PATH` for authenticated rendered integration. The GitHub PostgreSQL job provisions its own PostgreSQL service and Chromium. Test fixtures must never target the operating database.
