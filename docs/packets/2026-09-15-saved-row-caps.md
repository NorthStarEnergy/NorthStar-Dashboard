# Apply the saved Overview row and uppercase menus — 2026-09-15

The previous compact-row packet changed new/default arrangements but preserved manual browser profiles. This left the user's existing cards in their old positions. Profiles without the new `indicatorRow` marker now receive the requested arrangement once on their next Overview visit; the complete prior profile is retained under `beforeIndicatorRow`. Subsequent manual changes remain persistent and are not rearranged again.

The five 96 px indicators fit together at a 1371 px viewport as well as 1440 and 1920 px, accommodating the narrower CSS viewport visible in the supplied screenshot. The legacy Events card and inactive section roots are explicitly hidden while Overview is active, preventing the old full Events panel from appearing behind the compact modules.

Platform menu labels, section-tree labels and module tabs display in uppercase while retaining the bold monospace typeface. The prior section moves remain in place: Flows/Modules/Training under Tools, SCADA under Engineering.

Regression checks seed an old manual profile, verify its backup and automatic migration, confirm uppercase labels and absence of the legacy Events card, and exercise subsequent manual resize/save/reload. Screenshots use isolated fixtures. Full Python, browser, Node and clean-checkout release results accompany the delivered package.

Reload the dashboard; no Arrange default click is required. No backend restart or operational writes are included. Unrelated backend and demo-auth edits remain excluded.
