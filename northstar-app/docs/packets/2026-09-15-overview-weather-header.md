# Overview weather header

The retired Overview title, source-attention badge, and alarm counter no longer
occupy a second header row. The native weather cards now use that space directly
below the persistent operations bar.

Each Overview weather card is rendered at 75% of its former footprint through a
whole-card scale. Its existing type, icon, controls, and hover forecast scale
together, preserving the original Atikokan-style presentation. The full Weather
section remains unchanged.

Saved layouts receive a versioned weather-header migration. Automatic layouts
reflow into the new row, manual layouts retain their non-weather geometry, and
the canvas waits for the persistent status bar before saving so an event return
or asset retry cannot save transient duplicate status modules.

Validation: `node tests/canvas-layout.test.cjs`, `node tests/overview-layout.test.cjs`,
the Overview, status-bar, event-return, and module-workspace browser suites, and
the complete Python suite: 265 passed.
