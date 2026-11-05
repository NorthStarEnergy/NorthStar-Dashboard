# Shared dashboard canvas

The supplied screenshot showed a market group occupying a large invisible box and preventing independent movement. Overview now has one shared coordinate system across the main dashboard area. Each weather station, IESO/APIROQ card, dispatch card, Events panel, field-staff station card, staff heading and other Overview module has its own move grip and resize handle in Edit Layout.

Group containers remain in the DOM for existing feed updates and click handlers but no longer establish layout boxes. No feed renderer or operational action was replaced. The existing module-layout.js remains the only layout system; other workspaces retain their previous layouts.

Movement is unrestricted by former groups. The canvas extends right/down as needed and scrolls at the viewport edges. Manual overlaps are allowed; the actively moved card is raised. Resize has small content-specific minimums, and oversized content scrolls rather than changing the saved geometry. Arrow keys move the focused move grip or resize the focused resize grip (5 pixels; Shift 20). Pointer cancellation restores the starting geometry.

Saved positions survive Done, feed replacement, tab switching and reload, using stable identities. A dedicated canvas browser key protects this geometry from earlier generated layout defaults; Save also mirrors positions into the existing Overview default endpoint. Reset restores the saved canvas with the existing confirmation. This remains browser-local preference storage plus the existing shared-default publishing behavior, not a new account synchronization system.

Validation: 178 Python regressions passed. The Node canvas harness covers movement across former group and viewport boundaries, independent resize, Done, replacement feed nodes, Events identity after header relocation, pointer cancellation and tab restoration. Existing layout migration/script-compilation checks pass. The user's screenshot was inspected; no new browser interaction or visual test was performed.

The initial canvas packs new modules into available space once. Future new cards receive a free location without shifting manually positioned cards. At narrow viewports a saved wide canvas scrolls rather than silently reflowing and overwriting positions. This is intentional for the requested free-positioning behavior.

Delivery includes the updated layout engine, styles, HTML, regression harness and report. Static changes take effect on refresh; no backend restart is required. Existing unrelated backend/editor changes are preserved.
