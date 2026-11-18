# Outage reports, event log and checkout

Open **Reports** below **UWPC** and select an outage from the active, upcoming or past group. The report reads all linked documents in one database snapshot. It shows decisions and pending signatures for the current reviews, open corrections and concerns, switching activity, closure summaries and follow-up notes. Refresh reads a new snapshot.

Each outage folder includes an **Event log**. It combines the register and document histories, including edits, review actions, switching, closeout and checkout handoffs. The same timeline is available within the report.

Open **Forms** or **Drawings & documents** and select **Check out to edit**. The checkout covers all documents in that outage. Save edits before selecting **Check in**. Reading, signing a review and recording switching activity remain available to their authorized participants. The original UWPC desk links to the Outage Manager editor for existing outage documents.

The backend checks the signed-in account, editing-session token and document version before accepting a change. A checkout expires after 30 minutes without renewal. An actively edited, visible page renews the checkout. Closing the tab leaves the last checkout valid until expiry. Existing outages and reviews need no conversion.

Deployment requires restarting the managed backend to load the report and checkout routes.
