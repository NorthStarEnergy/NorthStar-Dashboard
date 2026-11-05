# Compact Event Log rows

Reduced standard Event Log rows from 64px to 32px using tighter padding, compact line heights and single-line linked summaries. Source, severity, timestamp and record actions remain available; expanded actions may grow naturally. Full record text remains on the linked event page.

Changed event-log-modules.css and its cache key in northstar-clean.html. Authenticated live DOM measured all 100 displayed rows at 32px; screenshot inspected for readability. No operational data was changed.
