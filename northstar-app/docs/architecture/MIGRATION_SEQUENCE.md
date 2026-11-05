# NorthStar — Migration Sequence

Produced 2026-08-11. Work order task 6. Target described in `PROPOSED_TARGET_ARCHITECTURE.md`;
gaps referenced as `G-n` from `GAP_ANALYSIS.md`; decisions as `D-n`.

## Rules this sequence obeys

1. **Every stage is independently shippable and independently revertible.** No stage depends on a
   later stage being finished.
2. **Every stage ends green**: `python -m pytest tests -q`, currently **87 passed, 0 failed**.
3. **Behaviour-preserving unless the stage says otherwise**, and the stages that do change
   behaviour say so in bold and name the decision that authorises them.
4. **Additive before subtractive.** New path lands beside the old one; the old one is removed only
   after nothing calls it. This matters more than usual here because a PWA installed on a
   contractor's phone updates on its own schedule.
5. **Nothing in Stages 0–4 touches** the OT boundary, switching release semantics, the voice rules,
   or the safety-escalation path.

---

## Stage 0 — Make the system revertible · **do this first, it gates everything**

Packet 17 establishes the first canonical committed and tagged release baseline. The remaining
Stage 0 item is backup-restore verification; every later stage must preserve the release gate.

| # | Action | Verify |
|---|---|---|
| 0.1 | Commit the safe canonical source baseline. Confirm `.gitignore` excludes `data/`, `.northstar-qr-secret`, cloudflared credentials, generated output, screenshots, ZIP staging, and frozen handoff copies | **Completed by Packet 17**; clean checkout and release metadata are required |
| 0.2 | Tag the exact Packet 17 source used for the deployed Sites version | **Completed by Packet 17**; `packet-17-2026-08-12` |
| 0.3 | **Verify a backup restores.** Take a `data/backups/*.db`, open it in a scratch copy, run the suite against it. Packet 06 requires this test layer and it has never been exercised (G-9) | **Completed 2026-08-12**; restore drill passed and the 87-test suite passed against the isolated copy |
| 0.4 | Reconcile `AGENTS.md`: baseline is 87, not 66 | **Completed by Packet 17; refreshed by Packet 18 consolidation** |

Cost: under an hour. **0.3 is the highest value-per-minute item in this entire document** — it is
the only thing standing between a disk failure and total loss of the operational record, and it
requires no architectural decision from anyone.

---

## Stage 1 — Close what is live · **perimeter decision closed; owner follow-ups remain**

| # | Action | State |
|---|---|---|
| 1.1 | Operator routes refused on the public check-in hostname regardless of headers | **Applied and live** — `ieso_backend.py:_operator_gate_blocks`, two regression tests (roster read, distress-call write) |
| 1.1b | Close the LAN path — a forged header with a LAN `Host` must not become operator access | **Applied by Packet 17** — production binds `127.0.0.1`; non-loopback plus public check-in origin is rejected at startup |
| 1.2 | Strip client-supplied `Cf-*` headers at the Cloudflare edge (Transform Rule on `checkin.`) | **Owner action.** Belt to 1.1's braces; the origin should not be the only thing that catches this |
| 1.3 | Re-run the external probe and confirm 403 | **Completed by Packet 17 external smoke record** |
| 1.4 | Decide **D-1** (worker-route credential, unguessable check-in ids) | **Owner + whoever owns worker safety** |
| 1.5 | Decide **D-2** (bind `127.0.0.1`; verify the Access JWT) | **Closed by Packet 17 with loopback bind**; JWT remains required before a non-loopback bind |
| 1.6 | Rate limiting on the public routes — Packet 04 requires it, the system has none (G-1) | after 1.4, since the shape depends on it |

Stage 1 is not architecture. It is on the critical path because everything below it is slower than
the exposure.

---

## Stage 2 — Foundations that unblock the packets · behaviour-preserving

Ordered by what unblocks the most downstream work per unit of risk.

### 2.1 Configuration object (G-8, environments)
Replace 24 scattered import-time `os.environ.get` calls with one `config.py` read once at startup,
plus `NORTHSTAR_ENV` ∈ {`dev`,`test`,`prod`}. Generalise the existing fail-closed check at
`ieso_backend.py:1429` into a startup invariant block that asserts the configuration is coherent
for its declared environment.

*Preserves:* every current default and variable name. *Test:* a startup-invariant test per refused
combination — including the one that already exists (public origin + gate off).
*Why first:* it is a precondition for environment separation and it is the lowest-risk change here.

### 2.2 Correlation ids (G-3, G-4)
Accept or generate `X-Correlation-Id` per request; echo it; thread it into every audit write.

*Preserves:* every payload — this only adds a header and a column. *Test:* a supplied id appears
in the response and in the resulting event rows; an absent one is generated.
*Why second:* the audit envelope (2.4) and any real incident reconstruction both need it, and it
is cheap while the router is still one file.

### 2.3 Migration ledger (G-6)
Add `schema_migrations`, convert the four existing `_migrate_schema` conditionals into numbered
forward migrations, keep `CREATE TABLE IF NOT EXISTS` for fresh installs.

*Preserves:* the resulting schema exactly. *Test:* **the migration test layer Packet 06 requires
and the repo lacks** — start from a pre-migration database fixture, migrate, assert the schema and
that data survived.
*Why third:* every later stage that touches the schema needs it, and it is far cheaper to add
before the domain split than after.

### 2.4 Unified audit envelope (G-4)
Add `audit_events` with the Packet 03 envelope. Dual-write from the existing five event tables.
Do not migrate reads yet; do not delete anything.

*Preserves:* every existing event table and every UI that reads them.
*Test:* each domain action writes both its legacy row and an envelope row with matching actor,
aggregate and correlation id.

### 2.5 API v1 alias (G-3)
Serve every existing route at `/api/v1/*` as well as `/api/*`. Identical handlers, identical
payloads. Add the structured error object *alongside* the existing `{"error": "..."}` string.

*Preserves:* every current client, including PWAs already installed in the field.
*Test:* both prefixes return byte-identical bodies; the error object carries a code and the
correlation id.
*Note:* the unversioned paths are now permanent. That is the price of a field-installed PWA and
should be recorded, not fought.

**Stage 2 requires no owner decision and changes no observable behaviour.** It is the "low-risk
foundation changes" the work order authorises (task 10).

---

## Stage 3 — Identity and permissions · **Packet 02, needs D-3**

The single largest blocker to Packets 03–06 (G-11). Not startable until the identity provider
question is answered.

| # | Action | Depends on |
|---|---|---|
| 3.1 | Verify the Access JWT properly — signature, `aud`, `iss`, `exp` — in `integrations/access` | D-2, D-3 |
| 3.2 | `principals` / `roles` / `grants`; seed `worker`, `operator`, `qualified_person`, `admin` | 3.1 |
| 3.3 | Move route authorization from the one operator bit to role checks, route by route | 3.2, 2.5 |
| 3.4 | **Behaviour change:** recording a switching review requires `qualified_person`. Today any operator-gated caller can record one | 3.3 + owner sign-off |

3.4 is the first stage in this document that changes what a user can do. It needs the safety review
gate in Packet 04 §"Safety review gate", not just an engineering review.

---

## Stage 4 — Domain extraction · behaviour-preserving, one domain at a time

Only after Stage 2. Extract in this order, easiest and least coupled first, each its own commit:

1. **`market`** — `alert_settings`, `alerts`, `alert_events`. Self-contained, well tested, no
   safety surface. The rehearsal.
2. **`operations`** — `logbook`, `outages`, `outage_events`. Note `log_event` is called from many
   places; it becomes an application-layer concern.
3. **`scada`** — the six `scada_*` tables, out of `northstar_phase1`. Already adapter-shaped.
4. **`switching`** — already cohesive; mostly a file move. **Must not change release semantics.**
5. **`workforce`** — last and hardest: `store` and `phase1` both own parts of it, and it is the
   safety-critical path. This is where the application layer earns its keep — check-in creation
   becomes one use case in one transaction, closing the partial-write defect in G-2.

For each: move code, keep the public function names as re-exports so callers are untouched, run the
suite, commit. `northstar_store.py` shrinks to `platform/db` and `voice` stays as it is — it is
already the target shape.

Retire the sideways `store._LOCK` / `store._session()` reach-through as part of 3 and 5.

---

## Stage 5 — Deferred, decision-gated

Not scheduled. Listed so no later packet assumes they were forgotten.

| Item | Gate |
|---|---|
| PostgreSQL | D-4 / ADR-003. No current requirement forces it |
| Approved production hosting | D-5 / ADR-004. Company IT/OT/security |
| Electrical digital twin | Packet 03, needs D-7 (calculation engine, ADR-007) |
| Training simulator | Packet 06. Must clone a versioned model and stay isolated |
| Teams / M365 | ADR-008 — privacy, labour, IT review |
| `/api/ai` | D-6. Either delete the dashboard control or write the contract first (G-7) |
| Repository restructure, dead-file removal | Any time; deliberately excluded from this sequence as gratuitous under work order task 7 |

---

## Sequencing summary

```
  Stage 0  revertible ──┬─> Stage 2  foundations ──┬─> Stage 4  domain extraction
   (no decisions)       │    (no decisions)        │
                        │                          └─> Stage 3  identity ──> Packets 03-06
  Stage 1  live fixes ──┘                                (needs D-3)
   (needs D-1, D-2)
```

Stage 0 and Stage 2 need nobody's permission and can start immediately. Stage 1 is already half
applied and waits on a restart plus two owner decisions. Stage 3 is the gate to every remaining
packet, and it is blocked on D-3, which is why D-3 is the decision worth chasing first among the
non-urgent ones.
