# Dashboard loading guard scope — 2026-09-15

The previous guard counted every script resource failure, including optional scripts injected by hosting or analytics. This could hide an otherwise complete dashboard. Only authored dashboard dependencies marked data-ns-required now participate in readiness. Required-file failures still preserve layout and now identify the failed filename.

All 27 script URLs responded with HTTP 200 from the local running server. This does not identify the exact failure in the user's authenticated browser. An isolated browser regression injects blocked external analytics on every load and confirms startup, event return and stylesheet recovery still work. An injected module-workspace.js failure still blocks partial initialization, names the file, preserves layout and recovers on retry. Five Node suites passed; full Python and clean release results are included in the package. No backend/auth changes.
