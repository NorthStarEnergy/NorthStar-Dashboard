# Collapsible module menu

Each section toolbar now has Hide modules / Show modules. Collapsing removes the secondary navigation rail and expands the usable content area; the toggle stays visible outside the hidden rail. The preference is saved per section in the existing browser workspace profile and survives refresh. The toggle exposes aria-controls and aria-expanded, supports keyboard activation, and retains focus.

Floating windows read their existing CSS padding offsets, so collapsing does not rewrite saved window positions or dimensions. Main platform navigation and the persistent status bar remain available.

Validation: module-workspace browser scenarios verify keyboard collapse, reclaimed width, reload persistence, independent section preferences and reopening, alongside existing window/edit/navigation checks. The test now waits for the visible module after navigation instead of asserting before the canvas visibility update. Inspected the collapsed Tools screenshot. Persistent status-bar browser suite and full Python suite run; counts are recorded in the commit. Clean checkout release preflight and isolated HTTP checks run before delivery.
