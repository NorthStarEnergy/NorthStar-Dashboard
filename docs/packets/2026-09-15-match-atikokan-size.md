# Match all weather cards to Atikokan — 2026-09-15

The user's saved Atikokan rectangle measured 88 x 165 CSS pixels in data/dashboard-layout-default.json. Copied only width and height to the eight saved Overview weather rectangles; every x/y coordinate and non-weather setting remains intact. Updated the generated layout bootstrap consistently, without staging unrelated user-authored saved layout data.

A one-time per-profile browser migration applies the same dimensions to existing weather cards. Automatic responsive arrangements retain 88 x 165; future manual resizing remains possible. This changes the Overview weather cards, not full section windows. Regression checks verify all eight card dimensions at six viewport sizes and exercise subsequent saved layout behavior. Static changes require reload only. Package contains source and non-sensitive size settings, not the user's complete saved layout.
