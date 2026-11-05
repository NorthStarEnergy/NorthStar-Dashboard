# Station schematic builder

## Purpose
Provide reusable station electrical drawings for display and reference, with equipment identity and read-only SCADA feedback. This is a simple one-line drawing workspace, not an equipment command surface or operational release workflow.

## Workflow
1. Start a blank drawing or load a server drawing. Common station symbols are shown first; search or All symbols opens the wider existing catalogue.
2. Add equipment, drag to the grid, and connect terminals. Connections use right-angle paths. Select a connection to delete it.
3. Enter equipment tag, description, site code, voltage/rating, and label. Symbol settings retain device designation, drawn position, winding and rotation.
4. Load imported tags or enter the exact feed code and tag. Configure the two raw values meaning open and closed, plus a freshness threshold. The site code, when entered, must match the SCADA source site code.
5. Add up to six dynamic measurements per symbol, each with its own label, feed, tag, optional unit and freshness threshold.
6. Check the drawing, then Save server for a durable numbered revision. Save local keeps a browser copy. Save server copy creates another drawing. Reusable template exports geometry and measurement labels with asset tags, site codes and source bindings cleared.
7. Display hides editing controls and refreshes feedback every five seconds. Hover equipment/readings for observation time and quality. SVG snapshot exports the current display with a timestamp; it is static. JSON preserves editable configuration; SVG/PNG/PDF are reference exports.

## Editing
- Undo/redo covers geometry, symbols, connections and equipment/binding edits (up to 80 changes).
- Ctrl+Z / Ctrl+Y, Ctrl+D, Delete, Escape and arrow keys work outside form fields.
- Duplicate clears the new equipment's asset tag and source bindings.
- X/Y controls and connected-row/column alignment provide exact positioning.
- Zoom supports fit, 125%, 150% and 200%, with canvas scrolling.
- Drawing checks identify missing/duplicate equipment tags, incomplete feedback bindings, invalid position mappings and disconnected equipment. They do not validate actual electrical topology.

## Feedback contract
- Only the existing operator-gated SCADA readings endpoint is read; no equipment write API is added.
- Bindings are exact feed/tag matches, with optional site-code matching. Explicit tag filters are applied in SQL before the response limit so later-alphabetic bound tags are not silently omitted.
- Good/Valid/OK quality, a valid non-future observation time and a fresh reading are required. Unqualified, bad, stale, missing, ambiguous, unmapped and unavailable states remain unknown; manual drawn positions never substitute for SCADA feedback.
- Open is amber, closed is green, unknown is a grey question mark. These are position indications, not proof of energization, isolation or clearance.
- Source polling is only as current as the scheduled SCADA reports imported by NorthStar. This does not create a direct real-time SCADA connection.
- Server normalization bounds and preserves equipment and binding metadata. Telemetry values are not stored in the drawing record. Existing version-3 drawings remain loadable.

## Files
`one-line-editor-ui.js`, `one-line-live.js`, `station-builder.css`, `northstar-clean.html`, `northstar_store.py`, `northstar_phase1.py`, `ieso_backend.py`; targeted browser/JS/Python tests and build metadata.

## Verification and limits
Targeted Python suite: 45 passed before the final editing additions; subsequent binding/catalogue/SCADA tests: 17 passed. Pure feedback tests: 4 passed. Chromium fixture exercises tagging, local/server save/reload, live state transitions, loss of quality/freshness/transport, immutable Display mode, connectors, undo/redo, duplication, zoom and snapshot export. Fixture screenshots are explicitly synthetic and are not evidence of a live plant connection.

The served localhost assets match the canonical checkout. Authenticated production visual verification remains blocked by sign-in/public-route availability. Real station tags, mapping conventions and freshness requirements must be configured from the actual source. Existing unrelated checkout changes are preserved.

## Final verification
- Browser workflow passed again after the final controls, templates, alignment, export, and save-handling changes. No browser page errors in the fixture.
- Feedback unit tests: 4 passed. Targeted Python verification: 45 passed; binding/catalogue/SCADA subset rerun: 17 passed.
- Full repository suite: 376 passed, 10 failed. The worker-help operator-gate test timed out in that run and passed individually (1 passed). The remaining nine tests failed again on a focused rerun: device library wiring, AI event registration, retired static pipeline, desktop/mobile sync, Outlook wiring, site markup, Teams ingestion, and two UWPC contracts. These are outside the schematic changes; no broad repairs were made.
- JavaScript syntax, Python compilation and changed-file whitespace checks passed.
- Local HTTP health was 200 and the three schematic assets matched the canonical files. The browser reached the operator sign-in page showing v0.142; authenticated live rendering and real SCADA source feedback were not verified.
- No Git commit/tag/publication or release source archive was created because the full-suite gate remains red and the checkout contains extensive concurrent work. Source edits remain in the canonical checkout. This report and fixture previews are delivery evidence, not a release package.

## Delivery
Local copies are in `outputs/station-builder/`. Drive upload is pending. The original Work Projects / NorthStar / Station Schematic Builder folder was verified in Chrome, but the connector now returns 404 for it and the browser file chooser rejected upload because file URL access is disabled. No Drive file copy was created. Destination:
https://drive.google.com/drive/folders/19sHuCGR11L_DZRij14kKjK6nIJxh0-gL
