# ADR-019 — Voice: never invent, never suppress a safety signal, filtered is not deleted

**Status:** Accepted · load-bearing, covered by `tests/test_voice_workflows.py`

## Context
The Voice tab ingests audio from an open operational channel and triages it into operational and
non-operational segments.

## Decision — three rules
1. **Nothing is invented.** With `NORTHSTAR_VOICE_ENGINE=none` (the default) audio is ingested,
   hashed, deduped and logged, and stays at "Awaiting transcription". Placeholder transcript text
   is never emitted, because a fabricated line could later be read as something a person said.
2. **Triage may demote chatter; it may never suppress a safety signal.** `SAFETY_TERMS` pins a
   segment operational and sets `safety_hold`, and the server *refuses* an operator request to
   filter such a segment. Widen that list freely; never narrow it for precision.
3. **Filtered is not deleted.** Non-operational segments stay queryable and reversible; every
   override is an append-only `voice_events` row. Retention purges the audio bytes only.

## Consequences
- Rule 1 generalises: it is the correct precedent for any AI surface in this product (ADR-020).
- `northstar_voice.py` is the cleanest module in the tree and is already the target module shape.
- Recorded speech is worker names, locations and whatever else was said, so every voice route is
  operator-only.
