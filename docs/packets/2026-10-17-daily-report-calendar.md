# Daily-report forecast calendar correction

The next-day forecast check now advances the calendar date instead of adding 24 hours. This accepts the 25-hour Eastern daylight-saving transition while continuing to reject stale, skipped and distant days. Six Node regressions cover fall/spring transitions, year rollover, invalid/incomplete labels and the capture URL allowlist; all 71 Node tests pass. Python behavior and the activated 06:30/07:00 Eastern settings are unchanged. The capture worker reads this correction on its next invocation; no backend restart is needed.
