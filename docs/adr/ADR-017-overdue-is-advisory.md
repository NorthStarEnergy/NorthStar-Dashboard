# ADR-017 — OVERDUE is advisory; the PWA is the finished shape

**Status:** Accepted by the owner · 2026-08-11
**Relates to:** ADR-015

## Context
The worker heartbeat is a browser `setInterval(…, 300000)`. Mobile browsers throttle or kill it
when the phone locks, so a missed heartbeat does not reliably mean a worker is in trouble, and a
present one does not reliably mean they are fine.

## Decision
OVERDUE does not need to be trustworthy. The PWA is the finished shape; a Capacitor or native
wrapper is explicitly out of scope. **Do not re-propose it.**

## Consequences
- No feature may be built that implies the heartbeat is a reliable safety control.
- The service worker must never intercept `/api/`: a queued NEED HELP NOW would show success while
  nothing was sent. Safety calls fail loudly and tell the worker to phone the control room.
  Offline check-*in* could be queued safely; offline help cannot.
- **Open and unresolved:** `contractor-checkin.html` tells the worker "I am working alone and
  require hourly safety check-ins" — a cadence this system does not keep. A wording change was
  offered; the owner has not chosen one. See `GAP_ANALYSIS.md` "Authoritative requirements that
  are missing".
