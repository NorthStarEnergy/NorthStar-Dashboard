# Research daily-report capture button

Research now offers **Pull screenshots now** for the existing ten weather screenshots and three flow graphs. It posts to the existing authenticated daily-report refresh endpoint, prevents repeat clicks while running, polls progress, reports capture counts and errors, and links to the screenshot/download page. The same controls appear in dashboard Research and standalone Research.

The existing workflow also prepares public-input and image-only workbook drafts. Schedule settings, workbook preservation, operator authentication and provider cooldowns are unchanged. Static assets are cache-versioned; no backend restart is required.

Validation: 12 daily-report tests passed; desktop (1440px) and mobile (390px) browser fixtures passed for submission, busy/completion/error states, results navigation and horizontal fit. Full regression was attempted, then stopped after more than 11 minutes with the last output at 40% and no reported failures; full-suite completion remains unverified. Authenticated production interaction and a new live provider capture were not exercised.
