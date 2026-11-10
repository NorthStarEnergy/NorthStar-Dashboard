# Public Outage Manager and switching-plan reuse

Open https://northstarenergy.ca/outage-manager and enter the shared passcode `demo`. Each new browser session receives a numbered tester identity and can create, check out, edit and review records in the shared visitor workspace. Signing out revokes that session. Sessions expire after seven days.

The public Site forwards a visitor bearer token to a dedicated, allowlisted API. A separate SQLite database holds visitor sessions, outages, documents and history. Operator identities, outages, asset imports, controlled source PDFs and generation credentials stay on the workstation. The visitor library includes the form index and practice questions. Visitor equipment suggestions come from tester records.

On a switching form, **Similar** shows saved plans from overlapping sites. **Open** searches plans across sites. Pick a saved version and use **Merge** on a checked-out destination to append or replace its steps. The latest and distinct historical saved sequences are available. Merge only edits the local form until the user saves it.

Matching site selections retain the referenced devices. A different site selection clears the device column and marks recognized source identifiers in the instructions for replacement. All imported steps clear tag numbers, locks and execution personnel. Check free-text references against the destination before saving. The normal review process applies to the saved revision.

The main domain is an existing Sites project. Its Worker handles the Outage Manager path and delegates other paths to the existing site. The visitor API runs on the operator origin. Deploy the backend before publishing the Site. Preserve the visitor database across upgrades.
