# Significant outage package review

Open **Outages → UWPC Builder**, create or open a switching plan or UWPC form, and enter the outage ID, work window, drawing revision, review trigger and affected sites. Multiple sites select full review automatically. For a single site, select crew dependency, non-routine switching or lockout, or manager designation when applicable. The manager confirms the assignments against the outage schedule.

Save the form and attach the outage plan, switching order, applicable UWPC forms and drawings under **Sources and proposal generation**. Human-prepared packages can go directly to planning review. If the package contains a generated proposal, its existing controlled-evidence checks also apply.

## Reviewer eligibility

The workstation administrator maintains `outage-review-directory.json` beside the NorthStar SQLite database, or sets `NORTHSTAR_OUTAGE_REVIEW_DIRECTORY` to an explicit path. The file is read on each request. Use individually assigned accounts already authorized for the UWPC desk. The directory grants eligibility for a review role within that desk. Dashboard access is managed separately.

The following example uses fictional account names. The operation owns the eligibility and competence determinations.

```json
{
  "manager": ["cr-manager"],
  "operator": ["day-operator", "relief-operator"],
  "checker": ["day-operator"],
  "area": ["area-manager"],
  "field": ["north-crew-lead", "south-crew-lead"]
}
```

In session-based sign-in, only enabled operator accounts appear. In Access mode, use the operator email identities configured in `NORTHSTAR_UWPC_OPERATORS`. Gate-off mode cannot sign packages. Site-viewer and platform-demo accounts retain their existing access limits. Missing directory entries leave assignments unavailable.

## Routing and corrections

The manager selects the actual preparer, each scheduled operator, an independent competent checker, the area manager and one on-site representative for each affected site. The manager sets the deadline at or before outage start and signs the package into review. A scheduled operator can also hold the independent checker task when eligible. The package preparer, recorded content editors and approving manager are ineligible for that independent task.

Named tasks appear in the **UWPC sign-off** badge and **Waiting for your review** inbox. The visible dashboard refreshes every 30 seconds, flags tasks due within 24 hours, and shows overdue assignments to the control room manager. The area manager sees overdue site coverage. This delivery channel requires an open, signed-in dashboard.

Opening a package records a view. Each reviewer signs their role or returns a specific correction. A correction holds the review until the manager responds and its originator confirms resolution. Package edits and crew changes require a newly issued revision, a change summary and fresh signatures. Prior covers, evidence and decisions remain in the event history.

The final signer completes planning review. Download the ZIP from the cover for the signed PDF, source files and machine-readable review history. NorthStar preserves the controlling authority's operational release and permit process.

## Verification

The browser regression uses six synthetic signed-in accounts, two scheduled operators and two sites. It exercises classification, assignments, the personal inbox, seven role-specific sign-offs and download of the completed package. Store tests exercise incomplete coverage, unauthorized signing, corrections, replacement staff, stale exports and the lifecycle gate. In-app alert tests cover due reminders and site-specific escalation.

Release verification passed 634 Python tests, 347 Python subtests and 76 JavaScript tests. The Python suite skipped 21 optional integrations.
