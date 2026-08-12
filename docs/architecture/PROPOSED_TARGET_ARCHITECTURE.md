# NorthStar — Proposed Target Architecture

Produced 2026-08-11. Work order task 6 (target half; the sequencing is in `MIGRATION_SEQUENCE.md`).

## The constraint this document is written under

Packet 00's suggested repository shape (`/apps`, `/services`, `/domains`, `/integrations`, …)
describes a multi-team platform. NorthStar is ~5,200 lines of standard-library Python, one process,
one maintainer, published from a workstation, with one production dependency (`tzdata`). Adopting
the full shape as a rewrite would cost the entire budget of this project and — per the inventory
§11 — there is no commit to roll back to.

So the target below keeps every property Packet 00 actually requires (layer separation, versioned
contracts, auditability, environment separation, storage independence) and drops the parts that are
only organisational scaffolding for a larger team. Packet 00 §"Suggested repository shape" itself
says: *"This is a target organization, not a requirement to rewrite existing code immediately."*

**Design rule for everything below: additive.** New structure is introduced beside the running
code and adopted route by route. At no point is there a big-bang cutover, because a big-bang
cutover of a lone-worker safety system that is live on the internet is not a defensible plan.

---

## 1. Target layering

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │ PRESENTATION   northstar-clean.html · contractor-checkin.html        │
  │                contractor-qr.html · (future) Teams / mobile          │
  └───────────────────────────────┬──────────────────────────────────────┘
                                  │ HTTP  /api/v1/*   versioned, schema'd
  ┌───────────────────────────────▼──────────────────────────────────────┐
  │ TRANSPORT      services/http/   router · gate · error envelope       │
  │                                 correlation id · rate limiting       │
  │   Knows: HTTP. Knows nothing about SQL, IESO CSV, or QR signing.     │
  └───────────────────────────────┬──────────────────────────────────────┘
  ┌───────────────────────────────▼──────────────────────────────────────┐
  │ APPLICATION    services/app/    use-case orchestration               │
  │                                 one transaction per use case         │
  │                                 emits audit + domain events          │
  │   "check a worker in" lives here, callable without an HTTP request.  │
  └───────────────────────────────┬──────────────────────────────────────┘
  ┌───────────────────────────────▼──────────────────────────────────────┐
  │ DOMAIN         domains/workforce · operations · market · switching   │
  │                        · voice · (future) electrical-model, training │
  │   Pure rules. No HTTP, no os.environ, no direct connection handling. │
  └───────────────────────────────┬──────────────────────────────────────┘
  ┌───────────────────────────────▼──────────────────────────────────────┐
  │ DATA           platform/db/     session · migrations · repositories  │
  │                platform/audit/  one event envelope, all domains      │
  └──────────────────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────────────────┐
  │ INTEGRATION    integrations/ieso · weather · scada · voice-engine    │
  │                              · access (identity)                     │
  │   Each: an interface, one live implementation, one recorded fixture. │
  └──────────────────────────────────────────────────────────────────────┘
```

The layer that does not exist today is **application**, and it is the one that unblocks Packets
02–06 (see `GAP_ANALYSIS.md` G-2). It is the highest-value single addition in this document.

## 2. Target module ownership

| Module | Owns (tables) | Consumed by | Status |
|---|---|---|---|
| `platform/db` | schema version, session, migrations, backup/restore | everything | extract from `northstar_store` |
| `platform/audit` | `audit_events` (new, unified envelope) | every domain | new |
| `identity` | `principals`, `roles`, `grants` | transport + application | **new — Packet 02, the critical blocker** |
| `workforce` | `checkins`, `checkin_events`, `checkin_security`, `checkin_location_events`, `site_tokens`, `phone_verifications`, `retention_policies`, `site_policies` | dashboard, PWA, Teams | split from `store` + `phase1` |
| `operations` | `logbook`, `outages`, `outage_events` | dashboard | split from `store` |
| `market` | `alert_settings`, `alerts`, `alert_events` | dashboard | split from `store` |
| `switching` | `switching_drafts`, `switching_draft_events` | dashboard | split from `store` |
| `voice` | `voice_recordings`, `voice_segments`, `voice_events` | dashboard | **already correct** |
| `scada` | `scada_*` (6 tables) | dashboard, future twin | split from `phase1` |
| `electrical-model` | assets, terminals, connectivity, versions, effective dates | switching, editor, training | Packet 03 |
| `training` | scenarios, simulation state (**separate context**) | Packet 06 | Packet 06 |

The four-file layout is not itself the problem — `northstar_voice.py` is a single file and is the
cleanest module in the tree. The problem is that `northstar_store.py` owns four unrelated domains
plus the database platform, and `northstar_phase1.py` owns workforce security plus SCADA. **Split
by ownership, not by size.**

## 3. Cross-module rule

Today `northstar_phase1` and `northstar_voice` reach into `northstar_store._LOCK` and
`northstar_store._session()` — private attributes of a sibling domain module (inventory §3).

Target: domains depend **downward on `platform/db` only**, never sideways on each other. Where a
use case genuinely spans domains — check-in creation spans workforce + workforce-security +
operations log — the span lives in the application layer, in one transaction, not in a chain of
independently-committing calls.

```
   NOW                                    TARGET
   phase1 ──private──> store             workforce ──> platform/db
   voice  ──private──> store             voice     ──> platform/db
   store  ──imports──> phase1, voice     app/checkin ──> workforce, operations
        (circular, deferred)                    (one direction, one transaction)
```

## 4. API contract target

| Rule | Target | Notes |
|---|---|---|
| Versioning | `/api/v1/*`, with `/api/*` kept as a permanent alias | A PWA in the field updates on its own schedule; **the unversioned paths can never be removed**, only frozen |
| Errors | `{"error": {"code": "checkin.not_found", "message": "...", "correlationId": "..."}}` | Additive: keep the current top-level `error` string alongside until every client is migrated |
| Correlation | `X-Correlation-Id` accepted or generated per request; echoed in the response and written to every audit row | Prerequisite for G-4 |
| Schemas | One declarative request/response schema per route, validated at the transport boundary | Stdlib-implementable; no dependency needed |
| Idempotency | `Idempotency-Key` on `POST /api/v1/checkins` at minimum | A retried check-in on a flaky mobile link currently creates a duplicate worker |
| Concurrency | Generalise `switching_drafts.record_version` to every mutable record | The one place a lost update is already impossible |
| Authorization | Server-side, per route, expressed against `identity` roles rather than one operator bit | Packet 02 |

## 5. Audit envelope target

One `audit_events` table replacing five per-domain shapes, carrying the Packet 03 envelope:

```
event_id · event_type · schema_version · occurred_at · recorded_at · actor_id ·
aggregate_type · aggregate_id · correlation_id · causation_id · source · payload(json)
```

The existing per-domain event tables stay — they are the operational history of a live system and
several are load-bearing for the UI. New writes go to both during migration; reads move to
`audit_events` last. Nothing is deleted.

## 6. Identity target (Packet 02 — the critical path)

Today authorization is one bit and identity is an unverified header (`GAP_ANALYSIS.md` G-10, G-11).

```
  Cloudflare Access ──JWT──> integrations/access ──verified principal──> identity
                              │                                            │
                              │ verifies signature, aud, iss, exp          │ roles → grants
                              └── this verification does not exist yet ────┘
```

Minimum role set the *existing* features already imply — this is not speculative design, each row
is a distinction the current code cannot express but the workflow requires:

| Role | Needs | Currently |
|---|---|---|
| `worker` | own check-in record, heartbeat, raise help | no credential at all (G-1) |
| `operator` | roster, logbook, outages, alerts, QR tokens, acknowledge/resolve help | the single existing bit |
| `qualified_person` | record a switching review | **any operator can do this today** |
| `admin` | retention policies, site policies, token rotation | any operator |

`_operator_actor()` already captures *who* from the Access email header, so attribution exists and
only entitlement is missing. That makes this a smaller job than it looks.

## 7. Storage target

Stay on SQLite until a requirement forces otherwise (ADR-003 remains open — see `docs/adr/`).
What matters for Packet 00 compliance is not the engine but that **the choice is reversible**:

- All SQL behind repository functions in the owning domain — no SQL in transport or application.
- A real migration ledger (`schema_migrations`) with ordered, numbered, forward migrations and a
  documented forward-fix path, replacing `_migrate_schema`'s `PRAGMA table_info` conditionals.
- No SQLite-specific behaviour in domain logic. The two current dependencies to retire are the
  single global `threading.Lock` (a single-writer workaround) and `sqlite3.Row` leaking into
  mapper signatures (`_row_to_record(row: sqlite3.Row)`).
- Timestamps stored UTC, local timezone retained as context (G-8).
- Ids `secrets.token_urlsafe`-based, opaque and globally unique (G-1, G-8).

Telemetry volume is the trigger to revisit: `scada_readings` is the only table with unbounded
growth, and it is the natural first candidate if a time-series store is ever justified.

## 8. Environments target

Packet 00 §4 requires three; there is one. The minimum honest version:

| Environment | Target | Cost |
|---|---|---|
| Development | `NORTHSTAR_ENV=dev`, gate off, synthetic data, `127.0.0.1` | already effectively exists |
| Test | the pytest suite + a seeded throwaway DB | already exists, needs naming |
| Production | `NORTHSTAR_ENV=prod`, gate on, tunnel, **approved by company IT/OT/security** | ADR-004, open |

Introducing a single `NORTHSTAR_ENV` variable that the process asserts against its own
configuration at startup is cheap and would have caught the 2026-08-11 incident class directly —
the existing fail-closed check at `ieso_backend.py:1429` is exactly this idea, applied once. It
should be generalised into a startup invariant block rather than a single special case.

## 9. What deliberately does not change

- **The four background loops.** They work, they are observable through `/api/health`, and
  threading them differently buys nothing.
- **Python standard library only.** `tzdata` stays the only dependency. Every proposal above is
  implementable without a package — including JWT verification, which is the one place a
  dependency would be defensible and should be an explicit ADR if taken.
- **SCADA stays file-drop and read-only.** Packet 00's OT boundary is already satisfied; the
  target must not "improve" it into a connection.
- **Switching stops at REVIEW RECORDED – NOT RELEASE.** No target state adds an equipment-command
  or operational-release surface.
- **The voice rules**: never invent a transcript, never suppress a safety segment, filtered is not
  deleted.
- **Method-aware gating** and the `OPERATOR_ROUTE_PATTERNS` sub-route coverage. Any router rewrite
  that loses method-awareness reintroduces a live exposure.
- **`AGENTS.md` stays the operative brief.** These documents are the architecture record;
  `AGENTS.md` is what an agent reads first, and it must keep winning on conflicts.
