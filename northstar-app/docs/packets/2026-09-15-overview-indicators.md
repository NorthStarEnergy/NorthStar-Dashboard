# Short Overview indicator row — 2026-09-15

Events, APIROQ dispatch, crew/field tracking, IESO prices and APIROQ prices now occupy one 96 px row in the default desktop Overview arrangement. This is about half the previous 174 px dispatch height. All five fit at 1440 px and wider; smaller viewports wrap them while retaining the same height. Weather follows the indicators, with field staff, generating stations and chat below.

The short presentation uses smaller labels, tighter spacing, a single recent event and a readable source-status footer. Full modules still show their complete content. Resizing a card taller restores the roomier presentation. Indicator minimum sizes are now 200 × 88 px, preventing a first resize from jumping up to the previous larger minimum.

Manual browser layouts remain available. Reload to receive the assets; use **Edit layout → Arrange default** to apply the new row to a saved custom arrangement. Previous arrangement and Cancel remain supported.

The existing Overview browser scenarios verify five viewport widths, containment, resizing and profile preservation. The event-return scenarios verify that the recent navigation/recovery fix remains intact. Final Python, Node and committed-source release results accompany the delivered screenshots in `release-validation.json`. Screenshots use isolated fixtures rather than operational readings.

No backend changes or operational writes are included. Existing unrelated backend and demo-auth edits remain excluded from the packet.
