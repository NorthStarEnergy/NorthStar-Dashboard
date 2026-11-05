# Legacy SOP reference library — 2026-09-15

## Objective

File the supplied FirstLight SOP archive in NorthStar without representing any
of its potentially outdated material as an approved current procedure.

## Delivered

- Imported 94 PDFs (84 English, 10 French) into the ignored private runtime
  path `data/controlled-sources/firstlight-legacy-sops/`.
- Preserved the source directory layout, generated an integrity manifest with
  file SHA-256 values, and retain the original archive in the delivery folder.
- Added an operator-only `Legacy SOP Library (review required)` at the company
  root and relevant station documents under `Operating Instructions`.
- Added an operator-only PDF endpoint. Direct static access under `data/`
  remains blocked.
- Did not ingest the documents into AI answering or mark them CURRENT; they
  remain `LEGACY_REFERENCE` until an owner reviews their revision and scope.

## Verification

- ZIP preflight: 94 PDF entries, no traversal paths, no non-PDF entries.
- Imported every manifest entry and checked the PDF signature.
- Exercised the catalog and a private PDF response through a temporary local
  server.
- Targeted Python and UI tests passed, including operator-route protection.

## Delivery

The local delivery archive, manifest, and README are in
`outputs/firstlight-legacy-sop-library/`. A matching private Google Drive copy
is in the NorthStar Operations / Control Room Dashboard hierarchy.
