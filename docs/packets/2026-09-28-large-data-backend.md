# NorthStar large-data backend intake — 2026-09-28

## Delivered

- Added an operator-only, SQLite-backed row store for the extracted Water Management CSV review layer.
- CSV rows remain exact decoded string arrays with each original header list, source-relative path, byte count, source modification time, and SHA-256. Original source files are not modified.
- Ingestion reads one CSV at a time, stages rows to SQLite in bounded batches, and atomically publishes a complete file snapshot. Unchanged files are skipped by size/mtime; changed files are re-hashed before import. Failed imports leave the prior published snapshot intact.
- Added bounded, keyset-paginated file and row APIs. Catalog artifact paging now has a stable continuation cursor.
- Added focused coverage for idempotent imports, exact row preservation, pagination, and route registration/gating.

## Operator API

All routes are protected by the existing operator gate and unavailable from the public check-in hostname:

- `POST /api/water-management/ingest` with `{}` imports or refreshes extracted CSV files.
- `GET /api/water-management/files?limit=100&cursor=...&q=...` lists imported file metadata and returns `nextCursor`.
- `GET /api/water-management/rows?fileId=...&limit=100&cursor=0&q=...` returns source headers and rows; `nextCursor` is the last row number when another page exists.
- `GET /api/data-catalog?collectionId=water-management&limit=100&cursor=...` now pages catalog artifacts.

The `q` row filter is a literal substring search over preserved JSON cell arrays and is scoped to one file. Page size is capped at 500.

## Import run

A local import into the existing `data/northstar.db` was started after the implementation tests passed. At the latest check, two source files had committed, totaling 5,270,398 rows. The import was still running when this report was written. The source tree contains 127 CSVs. Verify final counts and importer process completion before treating the intake as complete.

The 4.02 GiB original archive remains unreadable by Python's ZIP reader per the prior catalog report; intake uses the extracted controlled review layer only. No source-value normalization or unit inference is performed.

## Verification

- `python -m pytest tests/test_operations_data_catalog.py -q` — 5 passed.
- `python -m py_compile northstar_data_catalog.py ieso_backend.py` — passed.
- `git diff --check` on changed code/tests — passed.
- An earlier combined run of `tests/test_operations_data_catalog.py tests/test_device_library.py` had 17 pass and one existing stale asset-version assertion failure in `tests/test_device_library.py::test_tools_module_is_wired_and_not_published_on_checkin` (`outages-workspace.js` expected version).

## Activation and limits

The backend already running on port 4180 does not reload Python changes automatically. Do not restart it without the normal NorthStar release/runtime check. New APIs will be available after the controlled backend restart. Existing dashboard UI has not been extended to browse/import rows; the API is ready for that follow-up. This row store preserves source data and provenance; it does not grant operational authority or generate permits, procedures, commands, or releases.
