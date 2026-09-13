# Device library — 2026-09-13

Tools now has a Library module: a company device repository broken down by operating area, then site, then the folders that make up a generating station.

## Available behavior

- The left pane is a Windows-style folder tree. Areas nest inside the company, sites nest inside areas, and station folders nest inside sites. Folder glyphs are sunflowers, so nested folders read as sunflowers inside sunflowers. Devices are file rows under their folder.
- Station folders are Powerhouse, Switchyard, Protection & Control, Waterways, and Station Service.
- Selecting a folder or device loads the recorded fields on the right. Contents of a folder or site stay navigable.
- Search is server-side and keeps matching devices with their ancestor folders.
- Operator notes are append-only, idempotent by request ID, and attributed by the server. A note never acknowledges, clears, or otherwise changes an alarm.
- This is a reference repository. It does not command equipment, change SCADA state, or release switching.

## Inputs

The catalog is West (Fort Frances, Calm Lake, Sturgeon Falls, Kenora, Norman), East (Twin Falls, Iroquois Falls, Island Falls, Old Woman Falls, White Otter Rapids, Camp Three Rapids, Big Beaver Falls, Okikendawt GS), and Quebec (McDougal, Bird GS, Cogent, Aiyers 1, Aiyers 2). Device rows are reference templates for each generating station, not live SCADA points.

Notes write through the operator-gated `/api/library/notes` route into `device_library_notes` and the shared audit ledger (`library.note.added`). The authenticated actor is decided by the server. A client-supplied `actor` is ignored.

## Validation

Full Python suite: 218 passed. Coverage includes catalog shape, search pruning, item lookup, idempotent notes that leave an open alarm unchanged, server actor attribution, and public-host refusal (403, including a forged Access header). Node check covers Tools markup, script compile, sunflower folder glyphs, and escaped site names. Library JS/CSS stay off the check-in hostname allowlist.

## Activation required

Python route and schema changes need a backend restart. Static Tools HTML/JS/CSS are served from disk on the next operator refresh. Preserve `DemoLogin`, `NoBrowser`, `ServiceMode`, and the published check-in origin. Do not add library assets to the worker allowlist.

After restart: sign in, open Tools, use OPEN LIBRARY, expand an area → site → sunflower folder → device, and add a note. Confirm the public check-in host still answers 403 for `/api/library`.
