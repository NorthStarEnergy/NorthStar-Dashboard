# Outage Manager Inbox and field help

Inbox is always available below Reports. A red exclamation mark means the signed-in operator has unopened items. It updates on load, on return to the window, after an outage action, and every 45 seconds while visible. The mobile Menu carries the same indicator. Open an item to view its outage and mark that item read across workstations. Reading never signs a review, dismisses a final-copy alert or resolves a concern. Outstanding assignments stay in Inbox, and a reissued review has its own unread state.

To tag an operator, open the outage overview, expand **Advanced settings**, choose a person and enter a note. This creates a personal Inbox link to the outage event log. The note and sender are recorded in the outage history and report. Tags request attention; they do not change assignments or confer editing rights.

The register starts with search and period tabs. Advanced settings contains its detailed filters; a count shows when those filters are active. On New outage, the review trigger stays explicit. Optional priority, additional sites and coordinator selections start collapsed; choosing multi-site opens the site field.

Hover over a field or focus it with the keyboard for a short explanation. Escape dismisses the popup. Field help is part of both the dashboard and package pages, including newly rendered switching rows, and does not add permanent instructions above the form.

The managed backend requires a restart. Inbox read state and tags are stored in additive SQLite tables; existing outage and approval records need no migration.

Equipment fields on New outage and supporting guarantee forms, and the Device column on every switching step, suggest registered assets and station-tagged symbols from current NorthStar one-line drawings. The list uses the primary and additional outage sites, matches station aliases and location boundaries, and filters as you type. A selection records the site and equipment identifier. Manual entries remain valid, and changing site selections never rewrites a saved or unsaved step. A station without a matched source offers manual entry.

Forms place the green checkout action and its owner/status at the left, followed by the red PDF link and the green Download Excel link. File links remain available while another person holds the checkout.
