# The logbook as compliance evidence — assessment, 2026-08-14

Not a compliance audit. Written by reading the code, to give the owner an honest picture before
anyone external asks. It should not substitute for a qualified assessor.

## Read this first: does NERC apply to you at all?

NERC Reliability Standards bind **registered functional entities** — TO, TOP, GO, GOP, DP, BA, RC —
for facilities forming part of the Bulk Electric System. In Ontario they reach you through NPCC and
the IESO market rules rather than directly.

If NorthStar is a contractor performing field work rather than a registered entity operating BES
facilities, **these obligations may not attach to you at all**, and what actually governs this
logbook is your contract with the entity that is registered. That distinction changes every priority
below, and it is worth settling before spending effort on any of it.

The rest of this document assumes the log may one day have to stand up as evidence, whether that
obligation arrives through NERC, a client contract, an insurer, or an incident investigation. That
assumption is worth satisfying regardless of registration status.

## What the log already gets right

These are the hard parts, and they are done.

| Property | Where |
|---|---|
| **Append-only, enforced in code** | `add_logbook_entry` only INSERTs. No `UPDATE logbook` or `DELETE FROM logbook` exists anywhere in the codebase. |
| **Timestamps are server-generated** | `now_iso()` → `datetime.now(TZ)`, `TZ = ZoneInfo("America/Toronto")`. Offset-aware ISO-8601, traceable to UTC, correct zone for IESO. A client cannot assert its own time. |
| **The actor is server-decided** | `_audit_actor` overrides any client-supplied `actor`/`source` in demo mode. A caller cannot claim to be someone else. |
| **Broad automatic capture** | 29 `log_event` call sites — outages opened and closed, alert threshold changes, check-ins, switching draft transitions. The log reflects system events, not only what someone chose to type. |
| **Authentication events are recorded** | Sign-in, sign-out and failed-login throttle trips all write entries. Individual failed guesses are deliberately not logged, and the reason is stated in the code: a line per guess would let anyone outside flood the operational log. That is a reasoned trade-off, not an omission. |
| **State transitions retained separately** | `outage_events`, `checkin_events`, `switching_draft_events`, `alert_events` keep history rather than only current state. |
| **Access-controlled** | Operator-gated, and Packet 20 refuses the route on the public check-in hostname — verified against production. |
| **Tamper-evident** | Added 2026-08-14. See below. |

## Gaps, in the order they matter

### 1. Shared account — the ceiling on everything else

Every entry is attributed to one demo credential. Packet 02 (Identity and Permissions) is `NOT DONE`,
blocked on decision D-3, and the project's own documents state that Packet 19 does not satisfy it.
The code is already honest about this — the sign-in entry it writes says so in as many words:

> "This is the single shared demo credential, not an employee identity."

An operating log that cannot attribute an action to an individual cannot answer *who did this*, which
is the question evidence exists to answer. Shared operator accounts are a routine audit finding in
their own right under CIP-004/CIP-007.

**This caps the evidentiary value of every other property in this document.** A perfect,
tamper-evident, fully retained log of actions taken by "the shared account" is still a log that
cannot identify a person. It is one owner decision away, not one build away.

### 2. Tamper evidence — addressed 2026-08-14

Append-only *in the application* only proved the application does not edit. The database is a SQLite
file on a Windows PC; anyone with file access could edit it with any database browser and nothing
would show.

Each row now carries a SHA-256 over its predecessor's digest and its own stored fields, so editing,
deleting, or out-of-band insertion breaks every digest after it. Verify with:

    python scripts/verify-logbook.py

Covered by `tests/test_logbook_integrity.py`, which tampers with the database directly — edit,
delete, forged insert, and an attempt to repair one row's digest — and asserts each is detected.

**Two honest limits.** The chain was backfilled across the 170 pre-existing rows, so it establishes
a baseline from 2026-08-14 and proves nothing about the record before then. And it is
tamper-*evident*, not tamper-*proof*: someone with write access and knowledge of the scheme can
recompute the whole chain. Detecting that requires an off-host copy to compare against — which is
gap 3.

### 3. Retention and durability

Nothing purges the logbook, which is correct. But the only copies are the live database plus
`BACKUP_KEEP = 14` daily files **on the same disk**, under `data/backups/`. Decision D-5, an off-host
backup mirror, is still open.

A disk failure loses the record and the evidence of the record together. Typical NERC evidence
retention is three calendar years, or since the last audit — well beyond 14 days of same-disk copies.
The 2026-08-14 unclean shutdown is a live demonstration that this machine does fail.

An off-host copy also closes the residual hole in gap 2: a chain that only exists in one place can be
recomputed wholesale, but one that must match an independent copy cannot.

### 4. Silent truncation

`add_logbook_entry` truncates without telling anyone: `type[:60]`, `subject[:160]`, `details[:4000]`,
`source[:40]`. An operator writing a long account of a decision loses the tail and receives no
indication. For a record of operational decisions that is a data-integrity problem, and the fix is
small — reject or warn rather than silently cut. The hash covers the stored, truncated value, so a
verified chain attests to what was kept, not to what was typed.

### 5. Gaps in the record

The 2026-08-14 outage produced 5h08m with no entries, and nothing alerted. Gaps invite the question
of what happened during them. Nothing currently records that the system was unavailable, so a gap is
indistinguishable from a quiet shift.

### 6. Lower priority

- **Time sync.** Timestamps come from the host clock with no NTP attestation or drift monitoring.
  Adequate for correlation; nowhere near PRC-002 sequence-of-events accuracy, which this system does
  not claim to provide.
- **Evidence export.** The shift-handoff and incident generators concatenate plain text. There is no
  signed, timestamped export suitable for producing to an assessor.
- **Schema change control.** ADR-016 knowingly accepts schema evolution without a migration ledger,
  which sits awkwardly against CIP-010 configuration change management.

## What changed on 2026-08-14

- Logbook hash chain (`prev_hash`, `entry_hash`), backfilled over 170 existing rows.
- `verify_logbook_chain()` and `scripts/verify-logbook.py`.
- `tests/test_logbook_integrity.py` — 8 tests that tamper with the database directly.

## Suggested order

1. **Settle registration status.** It may remove most of this document, or sharpen it.
2. **Decide D-3 and land Packet 02.** Per-person identity is the ceiling on everything else.
3. **Decide D-5 and mirror backups off-host.** Closes retention and completes tamper evidence.
4. **Fix silent truncation.** Hours of work.
5. **Record availability gaps**, so a gap is distinguishable from a quiet shift.
