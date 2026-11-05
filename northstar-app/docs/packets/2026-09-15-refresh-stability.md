# Overview refresh stability — 2026-09-15

Live roster groups were registered as independent Overview cards, and feed DOM updates reran automatic arrangement. Native roster groups now remain hidden source data on Overview; the linked compact staff modules continue to display their counts. Automatic geometry changes only on initial placement, viewport changes or an explicit arrangement request. Saved profile width is restored before deciding whether to reflow.

Startup now detects failed external scripts as well as stylesheets. A partial dashboard stays hidden behind a retry message, preserving saved layout. Script retry reloads dependencies in document order.

Validation: 260 Python tests, 5 Node suites, and all three browser suites passed. Five consecutive reloads with alternating two/eight fixture crew records preserved every visible module rectangle. Six viewport sizes, four-corner resizing, profile persistence, event return, injected stylesheet/script failure and recovery passed. The reload screenshot was visually reviewed. Browser evidence uses isolated fixtures, not the authenticated production session.

Static files only; no backend restart required. Existing unrelated backend/auth edits excluded. Clean committed-checkout release results accompany the package.
