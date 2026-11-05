# Simple popout monitor

## Request
A simplified always-open worker/status popout with the overview list occupying about 70% width and dispatch, market prices and events at right.

## Changes
Adds Simple monitor and Classic dashboard selections to the popout hamburger menu. Simple is the initial default. The worker list uses the existing overview renderer and grows with its content. Dispatch and IESO/APIROQ prices use existing feed modules. The event register retains server-side search, filters, pagination and report links. A plus button opens an inline operator log composer; failed writes retain text and successful writes refresh the ledger. Narrow windows stack the columns.

## Verification
Synthetic Edge fixtures passed at 1600, 1024 and 768 pixels: column geometry, top-left menu, overflow, failed/successful log submission, view switching and reload persistence. JavaScript syntax checks pass. Production writes were not used as tests.

## Runtime
Four static assets only; no backend restart required. Reload existing popouts. View choice is saved separately from the main dashboard.

## Recovery
Preimages are saved under private-preimages/20261030-simple-popout. Restore only the two toolbar assets and remove the two added status-simple assets after checking for subsequent changes. Saved classic layouts remain intact.

## Delivery
Source and synthetic verification script are in simple-popout-work. Installed hashes are recorded in the integration receipt.

## Limits
Authenticated production data rendering is not verified by synthetic tests. Existing backend activation requirements from earlier assistant work remain unchanged. Event pagination retains its snapshot and offers a new-events refresh when newer records arrive.

Regression run: isolated Python suite completed with 549 passed, 21 skipped, 311 passing subtests, 26 failed and 8 errors. This is not a clean full-suite result: the isolated copy lacks launcher/manifests, icons, desktop/research fixtures and the foundation schema; the legacy-source assertion also fails. No Python/backend files changed. UI-specific checks pass in both dashboard shells. Installed files were hash-verified; unauthenticated static requests return 404 under the existing demo sign-in gate, and backend health reports healthy.

Source publication: this workspace has only an origin remote, with no configured github remote. No Drive upload was performed. The source packet is retained locally; these release-delivery limits do not prevent the installed static view from loading after sign-in.
