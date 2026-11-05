# ADR-015 — Worker device routes have no credential; check-in ids are predictable

**Status:** Open — decision required (D-1). **Live issue.**
**Relates to:** ADR-009, ADR-017

## Context
`GET /api/checkins/<id>`, `DELETE /api/checkins/<id>`, `POST .../heartbeat` and `POST .../help`
are ungated by design so a contractor's phone can use them without logging in. Possession of the
check-in id is therefore the entire credential.

`northstar_store.py:458` mints that id as `f"checkin-{int(now.timestamp() * 1000)}"` — a
millisecond epoch, predictable from an approximate arrival time. There is **no rate limiting
anywhere in the codebase**, and the `checkin.` path rule admits `api/checkins(/.*)?`.

Consequences if an id is guessed, worst first:
1. `DELETE` closes the record; a closed record is not evaluated for overdue, so an unauthenticated
   request silently removes a lone worker from safety monitoring.
2. `POST .../help` raises a distress call the worker did not raise.
3. `GET` returns name, company, site, notes and live coordinates. (Phone is masked — correct.)

## Options
- **(a)** `secrets.token_urlsafe(16)` ids. Two lines, no protocol change, existing ids keep
  working. Makes the id a real bearer capability instead of a nominal one.
- **(b)** Bind the check-in to the signed site token already in `site_tokens`. Stronger; changes
  the PWA's stored state.
- **(c)** Split the trust: keep `GET`/heartbeat open, require the site token for `DELETE`.
- **(d)** Accept, with a date and a review trigger.

Rate limiting on the public routes is required by Packet 04 regardless of which is chosen.

## Why this is open rather than decided
Giving the worker device a credential is an authentication-trust-boundary change that touches the
safety-escalation path — both explicit stop conditions in the Packet 00 work order. It needs the
owner and whoever owns worker safety, not an implementation agent.
