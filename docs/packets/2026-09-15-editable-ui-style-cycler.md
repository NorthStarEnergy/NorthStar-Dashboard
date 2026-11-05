# Editable UI style cycler

The Edit dock now exposes nine persisted dashboard appearances: NorthStar Default, Shopify Dark, Arctic Blue, Signal Orange, Midnight Steel, Forest Ops, Violet Night, Graphite, and High Contrast. Each option has a palette swatch and radio state; Next Style cycles through the same declared order without closing the picker.

The selected style is stored under the existing browser-local `northstarUiStyle` preference. Invalid legacy values safely fall back to Shopify Dark. Arctic Blue and Signal Orange now have complete runtime palettes rather than menu entries without dashboard styling. The High Contrast option adds stronger borders and visible keyboard focus.

Browser coverage verifies the menu count, selected accessibility state, and one-step cycle order. Local dashboard verification confirmed selection, cycling, and reload persistence. `node tests/overview-modules.browser.cjs` could not run in this checkout because the Playwright package is absent. Full Python regression suite: `261 passed in 133.57s`.
