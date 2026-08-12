# Packet 18 §18.1 — worker capability tokens & phone-verification throttling

**Status: written 2026-08-12, reviewed by its own author, NOT executed, NOT wired into anything live.**

This folder is deliberately outside `tests/` so it is never picked up by the
existing `python -m pytest tests -q` baseline (currently 87 tests) just by
existing here. It won't change that count, and it can't break that suite's
collection step, until someone deliberately moves or imports it.

## What's here

- `worker_safety.py` — short-lived, signed worker capability tokens bound to
  one check-in record, plus a token/phone/source sliding-window throttle for
  phone-verification requests. Both required by Packet 18 §18.1.
- `test_worker_safety.py` — unit tests, hand-traced against the
  implementation, not run.

## Before this goes live

1. **Run it.** `python -m pytest proposed/packet18_worker_safety -q`. Nobody
   has done this yet. If it fails, that's real information — fix it before
   trusting anything else here.
2. **Owner decision on the secret.** `NORTHSTAR_WORKER_TOKEN_SECRET` is a new
   environment variable, separate from `NORTHSTAR_QR_SECRET` on purpose (see
   `_secret()`'s docstring). Where it's provisioned in production is part of
   decision **D-1** in `docs/architecture/DECISION_LOG.md` — an owner
   decision, not resolved by this code existing.
3. **Wire it in**, if approved: issue a token in `ieso_backend.py` when
   `POST /api/checkins` creates a record; require it on the worker's own
   `GET`/heartbeat/checkout/help routes; leave every operator route exactly
   as gated as it is today. Add the wrong-record / expired-token regression
   tests Packet 18's acceptance criterion calls for into `tests/` at that
   point, next to the existing security regression tests.
4. **Tune the throttle limits** with whoever owns the SMS/notification
   budget. The defaults in `PhoneVerificationThrottle` (5 per token per 10
   minutes, 5 per phone per 10 minutes, 20 per source per 10 minutes) are
   conservative placeholders picked to be obviously-safe-but-not-validated,
   not a researched number.

## Why this shape

Same signed-token pattern already used for QR placards in
`northstar_phase1.py` — versioned JSON payload, HMAC-SHA256, base64url,
constant-time signature comparison — so adopting it is a small, familiar
diff instead of a new pattern to review from scratch. The throttle is
in-memory and per-process on purpose, matching this project's current
single-process architecture (`docs/adr/ADR-013-python-standard-library-single-process.md`);
if that architecture changes, the throttle needs a shared store instead, and
`SlidingWindowThrottle`'s docstring says so.
