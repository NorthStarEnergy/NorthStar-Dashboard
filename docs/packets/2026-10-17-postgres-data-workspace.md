# PostgreSQL data workspace â€” 2026-10-17

NorthStar v0.210 adds a PostgreSQL-backed operator workspace at `/data-workspace.html`, linked from Tools. Eight typed operational datasets start empty: runtime, power/energy, water/flows, weather, operations, generators, equipment and fish/environment. Existing SQLite stores and layout work are preserved.

The UI provides server-side filters and bounded pagination, column selection, personal saved views, typed editing with revision conflicts/history, shared calculated columns, previewed calculation scripts with cancellable batch jobs, and saved line/bar aggregate charts. Operator authentication, public-hostname denial and same-origin writes remain enforced. See [the user and administrator guide](../DATA-WORKSPACE.md) for supported syntax and limits.

Windows setup provisions loopback-only PostgreSQL 18.6 on port 5433 using the official pinned EDB archive, a nonsuperuser application role and private SCRAM credentials. The existing launcher starts configured PostgreSQL before a new backend. Manual custom-format backups and a disposable restore/scale verifier are included. No source files or operational records are imported.

## Verification

- Actual PostgreSQL tests cover empty/idempotent schema, typed edits, revision conflicts/history, typed filters and cursor binding, formula dependencies, domain constraints, saved-item privacy and script preview/ownership/cancellation/audit.
- Authenticated browser integration covers desktop/mobile empty states, record edits/restoration, calculated values, filtering, saved views/scripts/charts, execution and persistence/activity. Browser fixtures use a separate database and temporary authentication; these are not proof of a user's existing production browser session.
- One million synthetic power records (14 stored columns, about 14 million field positions) in a disposable database: filtered 100-row page 237.62 ms; filtered daily aggregation of 20,000 matching records 4,451.71 ms. Twelve groups. Local measurements during regression activity; no general performance guarantee.
- Production empty backup restored into a separate database; eight restored domain tables matched zero production rows. All verifier databases were dropped.
- Existing dashboard geometry fixture passed at 1440/1024 widths. Node suite: 53 passed. Isolated release HTTP boundary: 38 passed.
- Final full Python suite: 495 passed, including actual PostgreSQL and authenticated browser integration. Clean-checkout preflight, deployed-runtime and hosted-CI results are recorded in the delivery handoff.

## Limits and follow-up

The language supports numeric expressions and restricted SET workflows, not Excel cell references/VBA or arbitrary Python/SQL. The browser is paged, not a million-cell spreadsheet. Calculated fields are filterable; sorting uses stored fields. Script batches commit independently and cancellation retains prior batches. Queries time out after eight seconds; charts cap at 500 groups. Job threads are bounded, not separate arbitrary-code sandbox processes.

No import wizard, station/equipment reference normalization, partition tuning, Windows service/reboot proof, automatic backups or high availability is claimed. These are future scoped work. No business data has been imported.
