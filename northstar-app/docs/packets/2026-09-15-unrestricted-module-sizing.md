# Unrestricted module sizing and Overview graphics — 2026-09-15

Removed content-based resize minimums from Overview, floating section windows and legacy module zones. A one-pixel geometric floor prevents inverted/zero-area rectangles. Padding and borders shrink with the frame so they cannot impose a hidden minimum. Small frames clip content; default card dimensions remain unchanged. Custom saved placements are preserved, including intentional overlap.

The Overview projection hid original chart nodes and rendered only numeric summaries. Larger market modules now show an inline SVG price-history trace from the existing market feed; larger weather modules show their hourly temperature forecast. Small indicators retain the short numeric view. Missing data is labelled unavailable rather than fabricated. Logo and weather icons were visible in the user's screenshots; the exact missing image was not identified, so these changes address the discovered missing charts.

Regression coverage exercises one-pixel resize and save/reload persistence plus a visible history path after expanding a market module. Existing viewport, event-return, asset recovery and section-window tests remain applicable. Evidence uses isolated fixtures. Static changes require a page reload, not a backend restart. Validation counts and release checks accompany the package.
