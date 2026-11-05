# Operations → Research

Shared repository of reviewed research reports, source studies and data-collection references.

## Use

Open Operations → Research in NorthStar, or `/research.html` on the operator hostname. Search project titles, tags, file names and document text; filter by category. Select a project and file to read it, or download the exact archived original. The Research folder and Project folder links open the corresponding Google Drive storage.

Seven initial projects contain fourteen files: the revised inflow audit/evidence, West water automation and clarification, public water collection, West water API mapping, data workspace, database foundation and daily-report collection. Snapshot dates and limitations remain visible. The superseded first inflow report is excluded.

## Add or revise a project

1. Place reviewed files in `research/projects/<stable-project-id>/`. Preserve versioned reports when conclusions change. Exclude credentials, operational database dumps and raw private records.
2. Add/update the project in `research/catalog.json`: title, category, snapshot date, status, summary, limitation note, tags, Drive folder and file list. Preserve the original source path and SHA-256 for provenance.
3. Run `python scripts/build-research-catalog.py`. It produces `research/catalog.js`; do not edit generated content by hand.
4. Mirror the same files to Work Projects/NorthStar/Operations/Research/<project>, verify both locations, and bump catalogue asset versions in the two HTML entry points when publishing a revision.

This catalogue is shared through source-controlled files; it is not browser-local storage. Adding files in Drive alone does not automatically index them in NorthStar. Future research tasks should update the catalogue and Drive copy together.

Local delivery copies are in `outputs/operations-research-20261019/`. No collector settings, operational records, saved dashboard layouts or authentication allowlists were changed.
