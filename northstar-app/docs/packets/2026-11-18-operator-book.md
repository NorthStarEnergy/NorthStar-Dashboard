# Operator Log Book

The main menu and the quick-entry control open the same workspace in the V1 and V3 dashboards. Operators can draft and record an entry while watching the event register, request wording assistance, review daily schedule prompts, comment on an alarm, and create its linked follow-up task.

General collects operating reports, operational updates and saved historical filters. Notes attaches an append-only observation to a station or an exact site and equipment tag. Active note counts appear in search and the equipment inventory. Historical searches the audit register and shows counts across the chosen period. Saved searches and adjustable pane widths are browser-local and keyed to the operator identity.

Existing schedules generate task occurrences. Recording a scheduled entry completes its occurrence and writes the chained log and audit event in one transaction. Client retries carry an idempotency key. Writing a comment uses the existing event annotation endpoint.

The sidebar places Log Book after Overview, puts Agent beside the wordmark, and moves Systems and version to the footer. Build history is accessible from the application menu. Tools opens the filtered directory and retains existing standalone role restrictions. Roster column dividers persist exact mouse and keyboard adjustments.

Run the Python suite and JavaScript contract tests plus the synthetic Edge fixtures in tests/operator-book.browser.cjs and tests/v1-wide-monitor.browser.cjs. Installation includes Python route changes and requires a backend restart. No database migration or external service configuration is required.
