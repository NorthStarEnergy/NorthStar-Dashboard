# Operations data catalog — 2026-09-17

## Objective

Provide the first reusable NorthStar intake/catalog layer for the operational data already located in the project, without exposing, copying, modifying, or recalculating the original files.

## Delivered

- SQLite-backed metadata catalog for Water Management, Maximo equipment, operating directives, and legacy SOP references.
- Trusted local intake command: `python scripts/catalog_operations_data.py`.
- Operator-only API: `GET /api/data-catalog` and `POST /api/data-catalog/refresh`.
- Company Library entry: **Operations Data Catalog**. Operators can review collection status, source-item metadata, hashes, file sizes, and refresh the metadata catalog.
- Audit event for every catalog refresh. The API contains no local source paths and serves no raw source bytes.

## Initial catalog result

- 4 collections and 232 catalog artifacts: 133 Water Management items, 2 Maximo items, 3 operating-directive sources, and 94 legacy SOP references.
- The Water Management project catalog identifies 5,352 source entries and 127 extracted CSV files. Its original 4.02 GiB ZIP archive is present and hash-verified, but Python's ZIP reader cannot read its central directory; the catalog marks archive listing as unavailable and retains the extracted-layer metadata instead.

## Verification

- `python -m pytest tests/test_operations_data_catalog.py tests/test_device_library.py -q` — 16 passed.
- `python -m pytest tests/test_ai_assistant.py tests/test_alerts.py -q` — 52 passed.
- `python -m pytest tests/test_api_workflows.py -q` — 26 passed.
- `python -m pytest tests -q` — 302 passed.
- `node --check device-library.js` and Python byte-compilation passed.

## Operational use

After the backend is restarted, open **Tools → Open Library → Operations Data Catalog**. Use **Refresh catalog** to register current metadata. This is the immutable-source intake stage; automated extraction, validation/approval workflows, normalized operational tables, and report calculations remain separate future stages.

## Constraints

- Original source files remain authoritative and private.
- Legacy SOPs are reference material, not approved current procedures.
- No public check-in route can access the catalog APIs.
