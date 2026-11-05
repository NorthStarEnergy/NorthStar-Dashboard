# Section consolidation and bold titles — 2026-09-15

Tools now contains Flows, Modules and Training. Engineering contains SCADA alongside the existing UWPC tooling; UWPC remains accessible under Outages as well. The four absorbed entries no longer appear in the platform sidebar.

Navigation ownership changes without moving live source elements or changing module IDs. Old section links and programmatic navigation still open the corresponding module in its new parent section. Existing source tabs, landing modules and window boxes merge into the destination's preferences, while module notes/customizations and the original section records remain intact. The Modules editor is a normal Tools module and retains creation and full/Overview editing.

Section navigation, tree headings/items, tab titles and section headings use bold Consolas with local monospace fallbacks, matching the existing APIROQ heading style without an external font request.

## Verification

The module-workspace browser scenarios check hidden legacy navigation entries, Tools → Flows/Training/Modules, Engineering → SCADA/UWPC, old SCADA/Modules fragments, 700-weight titles, preserved SCADA notes/landing/window geometry, and existing module creation/editing/resizing. Overview and event-return browser scenarios also run. Screenshots use isolated fixtures and deliberately unavailable APIs; they do not represent production readings. Final Python, Node and clean-checkout release results are recorded in the delivered validation file.

Reload the dashboard to receive the updated navigation. No layout reset or backend restart is required. Existing Flows and Training content is retained. Operational controls and backend/authentication behavior are unchanged; unrelated pending backend and demo-auth edits are excluded.
