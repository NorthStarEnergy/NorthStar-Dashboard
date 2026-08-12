# ADR-020 — There is an AI surface in the dashboard with no server contract

**Status:** Open — decision required (D-6)
**Relates to:** ADR-019

## Context
`northstar-clean.html:422` POSTs to `/api/ai`. **That route does not exist** in `ieso_backend.py`,
so the dashboard's chat box fails on every send.

Packet 00 §2.10: "Prefer deterministic rules for safety-related validation. AI may assist but must
not be the sole authority." Packet 04: "AI-generated switching content must be reviewed by
qualified personnel."

## The problem
Today it is a dead button. The risk is what happens next: no contract states what an AI surface in
this product may see, what it may assert, or how its output is labelled — so the first
implementation of `/api/ai` will set that policy by accident, in an operator-facing control room,
with the roster and the switching drafts one function call away.

## Decision required
Either delete the control, or write the contract before implementing it. If implemented, the rule
from ADR-019 should be reused verbatim: **never emit text that could later be read as something a
person or an authoritative system said.** Output must be visibly labelled, must never be the sole
authority for a safety-related conclusion, and must not be able to read the roster or switching
drafts without an explicit, audited entitlement.
