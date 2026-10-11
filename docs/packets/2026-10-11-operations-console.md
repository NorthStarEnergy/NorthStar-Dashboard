# Operations Console / Event Log — v0.157

## Delivered implementation
The Event Log has five server-filtered categories: Alarms (SCADA, app alarms), Communications (Outlook, Telephone, Teams), Tasks (Recurring, Created on demand, Triggered), Events (Outages, Planned, Operator log), and Feed (IESO, Market, Weather, News). The existing register, report navigation, annotations and audit ledger remain available.

Events → Console renders an approximately 82/18 main-stream/priority-feed layout. The feed can collapse. A successful Field Tracker module or fixed-dashboard marker pop-out shows a compact projection in its former Overview slot; closing the popup restores the tracker. Both projections fetch the same records. Cross-window notifications and 30-second polling refresh changes; failed refreshes retain data and mark it stale. Paginated history requires explicit refresh after loading older pages. Browser visual acceptance was unavailable in this environment and remains required on the real dashboard.

Create manual records and tasks, convert a record to a linked task, link existing event IDs, and open existing event reports and task audit histories. Explicit record links also appear under Related in the existing event report. Manual records always retain source=console and manual=true; choosing Telephone or SCADA does not impersonate an upstream source. Alarm creation is refused on the manual API. Planned event time is optional and separate from record occurrence time.

Tasks persist in SQLite. Supported states: open, in_progress, pending_verification, completed, cancelled. Cancellation requires a reason. Verified tasks require evidence submission followed by operator decision notes. Transactions write task state and immutable ledger activity together. Version checks reject concurrent stale edits; request IDs make retries idempotent and reject key reuse with different content. Assignment is descriptive; existing operator authorization is retained rather than introducing an unverified employee directory or role model.

Daily templates use a named timezone and one occurrence key per template/local date. Ambiguous local times use the first occurrence; nonexistent times advance to the first valid minute. Catch-up is limited to 31 dates per template per scheduler tick. Pausing suspends generation; re-enabling catches up missed dates. The scheduler runs once per minute and after restart. Trigger templates match an exact existing ledger source and event type after template creation; each matching event creates one linked task. Task/console writes cannot trigger recursive rules. No template is enabled or seeded by the release itself.

The priority feed includes open tasks regardless of age, unresolved existing market/app alarms and recent ledger activity. It limits the sidebar display; task filters retain access to all open work. Alarm acknowledgement/clearance is not added to the console. Existing source alarm workflows remain authoritative.

## Runtime / persistence
Added `northstar_console.py`, `operations-console.js`, `operations-console.css`, and workflow regression tests. `northstar_store.init_db()` creates additive `console_tasks`, `console_templates`, and `console_links` tables. Existing data is retained. The existing database backup includes them. The existing operator gate, public check-in hostname containment and restricted viewer gate cover every new endpoint. Authenticated actors are chosen on the server; cross-origin console writes are refused.

API routes under `/api/console/`: records, tasks, transition, templates, template-state, links, feed, catalog. Task and record creation require requestId. Task transitions require id, integer version, target status and requestId. All timestamp inputs include a timezone. Lists are paginated server-side; event lists use the existing filter-bound snapshot cursors. Task lists use bounded offset pagination and should be refreshed when task states change.

## Source adapters and remaining boundaries
Existing ledger writers and current market alarm state are available. External SCADA alarm ingestion, Outlook/Teams collection, telephone intake, weather/news archiving and trusted automatic-completion evidence are **not connected by this release**. Source status distinguishes recorded history from connection state. Templates can only react to events actually written by a configured source. Automatic completion is explicitly rejected until a trusted evidence adapter exists. No equipment commands, message sending, upstream alarm acknowledgement or switching release was added.

Role/site-specific authorization remains the existing runtime model; this release does not resolve the identity decisions in Stage 3. Templates and records are available to authenticated operators, not public check-in visitors or restricted demo site viewers. All external integration work must follow the existing source-specific setup and audit conventions.

## Validation
See VALIDATION.txt in the delivery archive for exact test counts and baseline comparisons. New domain/HTTP tests cover retries, atomic rollback, concurrent retries, version conflicts, verified completion, persistent overdue work, category pagination, explicit related links, DST, schedule restart uniqueness, exact trigger rules, source integrity and public-host/origin refusal. Existing Event Register and Event Detail JavaScript tests pass. The canvas JavaScript test has the same pre-existing isolated-harness ReferenceError in the original checkout; the existing canvas harness omits its enclosing moduleNudges binding. The only geometry change in this packet adds slot identity for the temporary console projection.

The full suite has known failures reproduced against base commit `463998e107be2111c8ff3c71800b19a539b0c4bf`. They include hard-coded old asset URLs, old host expectations, existing AI error behavior, an outdated Teams detail() call and UWPC citation assertions. An extra timestamp assertion appears when tests run outside America/Toronto; setting TZ=America/Toronto resolves that environment mismatch. Do not claim a green full suite or production visual acceptance.

## Activation
The Sites project stores this source, but its hosted Worker is the existing landing/gate application. The actual operator dashboard is the separate Windows Python origin. Publishing the Sites release does not update or restart that origin.

1. Back up the actual Windows source and database using its existing runbook. Inspect current Git HEAD and local edits. The delivery patch targets the base commit above; use `git apply --check` before applying. Merge any later Windows changes rather than overwriting them from snapshots.
2. Apply the reviewed patch to the actual canonical checkout and run the included workflow tests and existing regression suite there. Commit/tag the implementation and push to its configured GitHub remote. This execution environment did not have a configured GitHub remote; source persistence used the selected Sites repository.
3. Restart the existing `NorthStar Control Room backend` scheduled task under the Windows account that owns it, preserving `-DemoLogin -NoBrowser -ServiceMode` or the existing Access configuration. Do not set the gate to off or change public-host bindings.
4. Sign in, open Events → Console, create a disposable test task, refresh, complete it, and check audit history. Pop out Field Tracker and verify the console occupies its slot; close it and verify the tracker restores. Verify mobile/narrow layout, keyboard focus, filter pagination and stale-service handling.
5. Check public-host refusal and restricted-viewer refusal of the new API. Configure real task templates only after validation. Do not mistake stored source or a Sites deployment for proof that the Windows origin is running this update.

## Rollback
Revert this packet's source commit and restart the backend. Keep additive console tables and records for audit/forward recovery; do not drop tables or delete task history. Back up before any manual database restoration. New task generation stops when the scheduler code is reverted; existing audit rows remain readable.
