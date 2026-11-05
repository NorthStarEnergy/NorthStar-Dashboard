# V2 concept theme and density — v0.214

The implemented v2 was flatter, less colorful and less dense than the selected concepts. Restored their dark instrument surfaces, cyan headwater, blue flow, coral output, green generation, stronger borders, blue weather panels and filled charts. Metric colors identify readings; they do not assert alarms or equipment state.

At 1600px, all 18 plants occupy three rows of six cards (~92px high). Workers, Markets and Events share the next row; fleet generation, Weather and Outages share the following row. Smaller screens reduce columns without removing modules. Plant list retains HW, Flow and Output. Chart footers show latest/minimum/maximum of the available series.

The detailed popout adds current plant metrics, generation history and recent activity beside the saved single-line drawing. Its initial height fits the content. Device geometry, exact SCADA bindings and manual-name revision editing are unchanged. No inferred topology, invented alert state or new operational readings were added. Existing station-profile fallback remains explicitly labeled.

One-row headers and native top-layer More controls remain. Corrected an inherited 22px worker-panel inset locally to match the other modules. V1 and the protected user layout are untouched. Updated the station-display browser fixture menu expectation to include the already implemented Build View option.

## Verification

- 483 Python passed; 12 PostgreSQL integration checks skipped locally. 59 Node passed. JavaScript syntax and diff checks passed.
- Disposable browser fixture: 1600px overview has 18 cards, 6 columns, 92.09px card height and all lower modules within the 1000px viewport. Desktop/tablet header remains 36px. 1024px root has no horizontal overflow. More leaves idle data at y=174.996px and popout metrics at y=177.716px. Saved drawing selection persists after reload. No browser console errors observed.
- Screenshots use disposable API fixtures and the existing configured station profiles, not authenticated operational proof. Authenticated production and packaged-native visuals remain unverified.
- Prior hosted run 39025394004 passed overview chart checks but failed the stale station-display menu expectation corrected here. Final hosted CI must validate the full fixture suite.
- Release HTTP/preflight results and publication reference are recorded in outputs/HANDOFF.md.

## Delivery

Local: outputs/dashboard-v2-concept-match-20261017. Drive: https://drive.google.com/drive/folders/1wd0lns5fzuY5lgvH56T1YrMO6D8Gbb1i . Source package contains allowlisted committed files; no operational records or protected layout. Drive readback verifies file names, byte sizes and destination parent, not remote checksums.
