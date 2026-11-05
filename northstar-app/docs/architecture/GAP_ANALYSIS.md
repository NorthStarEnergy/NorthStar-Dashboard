# NorthStar — Gap Analysis against Packet 00

Produced 2026-08-11. Work order task 2. Evidence is in `CURRENT_STATE_INVENTORY.md`.

Severity is **operational risk to a live, internet-published system**, not tidiness:

- **S1 — live exposure or safety impact.** Fix or formally accept, with a date.
- **S2 — will block a Packet 01–06 module, or defeats an existing control.** Fix during foundations.
- **S3 — divergence from the standard with no current operational consequence.** Schedule.

Two things this analysis will not do, per work order tasks 8, 9 and the stop conditions:
it proposes no change to the authentication trust boundary, the safety-escalation path, or OT
connectivity — those are surfaced as decisions for the owner and engineering. And it invents no
electrical or safety rule; where an authoritative requirement is missing, it says so.

---

## Scorecard — the ten architectural principles (`01_ARCHITECTURE_SPEC.md` §2)

| # | Principle | Verdict |
|---|---|---|
| 1 | Human-in-the-loop for safety-critical workflows | **Met.** Switching stops at REVIEW RECORDED – NOT RELEASE; voice triage never suppresses a safety term; no autonomous action exists |
| 2 | Authoritative systems remain authoritative | **Met.** SCADA is file-drop read-only; no write path to OT |
| 3 | UI does not directly access database tables | **Met at the process boundary.** Every client goes through `/api/*`; mapper functions keep table columns out of payloads |
| 4 | Business rules separated from presentation and persistence | **Not met — G-2.** Domain rules sit in the HTTP handler chain and inside the SQLite module; there is no application-service layer |
| 5 | Every operationally meaningful change is auditable | **Substantially met — G-4.** Per-domain append-only event tables with actor/action/before/after; missing correlation id, source, and a common envelope |
| 6 | Integrations are adapters, not hidden dependencies | **Partially met — G-5.** SCADA and voice are real adapters; IESO and weather clients are inlined in the HTTP module |
| 7 | Modules communicate through versioned service/API contracts | **Not met — G-3.** 37 unversioned routes, no schema document, private-attribute imports between modules |
| 8 | Training/simulation isolated from live control | **Not applicable yet.** No training module exists. The boundary is unbreached and must be preserved by Packet 06 |
| 9 | Start simple; preserve migration paths | **At risk — G-6.** Hand-rolled `ALTER TABLE` migrations with no version table and no down path |
| 10 | Deterministic rules for safety validation; AI assists, never decides | **Met in the backend, contradicted in the UI — G-7.** No AI in any safety path; but the dashboard ships a chat box POSTing to a `/api/ai` route that does not exist |

---

## G-1 — Worker device routes have no credential, and check-in ids are predictable · **S1**

**Standard:** `04_SECURITY_AND_SAFETY.md` — "Role/permission model with least privilege",
"Rate limiting/abuse controls on exposed APIs". `05_REPO_AND_API_STANDARDS.md` — "Authorization
occurs server-side."

**Current state.** `GET /api/checkins/<id>`, `DELETE /api/checkins/<id>`,
`POST /api/checkins/<id>/heartbeat` and `POST /api/checkins/<id>/help` are deliberately ungated so
a contractor's phone can use them, and `AGENTS.md` requires they stay open. Possession of the
check-in id is therefore the entire credential. But `northstar_store.py:458` mints that id as:

```python
record_id = f"checkin-{int(datetime.now(TZ).timestamp() * 1000)}"
```

A millisecond epoch. Given a rough arrival time — which a crew's shift pattern gives you — the
search space for one check-in is a few hundred thousand values, and there is **no rate limiting
anywhere in the codebase** (the only `429` in the tree is one NorthStar *sends to* ECCC). The
`checkin.` hostname's path regex explicitly admits `api/checkins(/.*)?`.

**Consequence, in order of seriousness:**

1. `DELETE /api/checkins/<id>` closes the record. A closed record is not evaluated for overdue —
   so an unauthenticated request removes a lone worker from safety monitoring, silently. The
   worker's phone would keep showing its own cached state.
2. `POST .../help` raises a distress call for a worker who did not raise one.
3. `GET /api/checkins/<id>` returns name, company, site, notes and live latitude/longitude.
   (Phone is masked by `_mask_phone` — that part is correct.)

**Why this analysis stops here.** Changing it means giving the worker device a credential, which
is an authentication-trust-boundary change and touches the safety-escalation path — both explicit
stop conditions. **Decision required (D-1).** The options, for the owner and whoever owns worker
safety:

- **(a) Unguessable ids.** Replace the millisecond id with `secrets.token_urlsafe(16)`. Smallest
  change, no new user step, no protocol change. Turns the id into a real bearer capability instead
  of a nominal one. Does not fix the fact that a leaked link is a permanent credential.
- **(b) Bind the id to the signed QR token already in the system.** `site_tokens` and
  `resolve_site_token` exist; the check-in could carry a short-lived signed handle. Stronger,
  more work, and changes the PWA's stored state.
- **(c) Split the trust.** Keep `GET` and `heartbeat` open, require the site token for `DELETE`.
  Targets the worst consequence directly.
- **(d) Accept.** Small deployment, low attacker interest, OVERDUE already declared advisory
  (2026-08-11). If chosen, record it as an ADR with a date and a review trigger.

Note that (a) alone is a two-line change with no behaviour change for any existing caller, and
existing ids keep working. It is the smallest thing that makes the current design honest. **It is
still not applied here**, because "the id is the credential" is an authentication decision the
owner has to make knowingly.

**Also required regardless of the choice:** rate limiting on the public routes (Packet 04 requires
it and the system has none), and an audit event when a check-out arrives without an operator
identity.

---

## G-2 — No application-service layer; domain rules live in the HTTP handler · **S2**

**Standard:** `01` §2.4, §3 (Application services / Domain services as distinct layers);
`05` — "Domain/business rules must be testable without rendering the UI."

`Handler._do_POST` is a ~400-line `if/elif` chain. A single check-in POST performs validation,
calls three modules across three domains, writes an audit event, writes a logbook entry, and
formats the HTTP response — inline. There is no seam at which a Teams client, a scheduled job, or
a Packet 04 switching engine could invoke "create check-in" without speaking HTTP to itself.

The business rules *are* independently testable today (the test suite calls
`northstar_store`/`northstar_phase1` functions directly), so this is not a testability emergency.
It is a coupling ceiling: every new consumer in Packets 02–06 either duplicates the orchestration
or re-enters through the router.

**Second-order defect this produces now:** the check-in orchestration is not transactional. Each
of `create_checkin`, `attach_checkin_security`, `record_location` opens and commits its own
session. An exception between them leaves a `checkins` row with no `checkin_security` row — a
state `enrich_checkin` handles by returning the bare record, so it fails quietly.

## G-3 — APIs are unversioned, unschema'd, and errors are not machine-readable · **S2**

**Standard:** `05` — "Version externally consumed APIs", "Validate request/response schemas",
"Use explicit error codes and machine-readable errors", "Correlate requests across services",
"Use idempotency for retryable commands."

| Rule | State |
|---|---|
| Versioning | None. 37 routes at `/api/…`. A PWA on a phone updates on its own schedule, so a breaking change today breaks whatever is installed in the field |
| Schema validation | Ad hoc per handler: `str(...)[:80]`, `int(...)` in `try`. No declared request or response schema, no OpenAPI |
| Machine-readable errors | `{"error": "<free text>"}` only. A client cannot distinguish "token expired" from "site unknown" without string matching |
| Correlation | No request id is generated, logged, or returned |
| Idempotency | None. A retried `POST /api/checkins` on a flaky mobile link creates a duplicate worker |
| Optimistic concurrency | Present in exactly one place — `switching_drafts.record_version` |

`switching_drafts.record_version` is the pattern that should generalise; it is the only place a
lost update is currently impossible.

## G-4 — Audit records lack correlation, source, and a common envelope · **S2**

**Standard:** `03_DATA_AND_EVENT_STANDARDS.md` — audit fields and event envelope.

| Required field | State |
|---|---|
| actor / service | Present |
| action | Present |
| entity + entity id | Present |
| before/after or delta | Status transitions only (`prior_status`/`new_status`, `prior_help_state`/`new_help_state`); other field edits land in free-text `details` |
| timestamp | Present (but local-offset, see G-8) |
| source / client | `logbook.source` only; the event tables have none, so a check-out cannot be attributed to a device vs the console |
| correlation / request id | **Absent everywhere** |
| reason / comment | Optional free text; not required on any destructive action |

Five event tables (`checkin_events`, `outage_events`, `alert_events`, `switching_draft_events`,
`voice_events`) each have a different column set. There is no `event_id`, `schema_version`,
`occurred_at` vs `recorded_at` split, `aggregate_type`, or `causation_id`. Reconstructing "what
happened during this incident" today means joining five shapes on timestamp proximity.

## G-5 — Feed clients are inlined in the HTTP module rather than adapters · **S3**

**Standard:** `01` §2.6 — "Integrations are adapters, not hidden dependencies."

SCADA (`northstar_phase1.import_scada_content`) and voice (`northstar_voice`, engine-agnostic via
`NORTHSTAR_VOICE_COMMAND`) are genuine adapters with validation, rejects and watermarks — these
are the good pattern already in the repo.

IESO and weather are not. `download_text`, `parse_report`, `MarketStore.refresh`,
`eccc_weather_snapshot`, `weather_snapshot` and their retry/backoff/cache logic are ~330 lines
inside `ieso_backend.py`, interleaved with the router and the background loops. There is no
recorded-fixture test for either, so an upstream CSV format change is discovered in production.

## G-6 — Schema evolution has no migration record and no down path · **S2**

**Standard:** `05` — "Schema changes require migrations and rollback/forward-fix planning."
`06_TEST_AND_ACCEPTANCE.md` — "Database migration tests."

`_migrate_schema()` reads `PRAGMA table_info` and conditionally `ALTER TABLE ADD COLUMN`. It works,
and it is honest about why each column exists. But: no version table, so the database cannot state
what it is; no ordering, so two agents adding columns concurrently produce two different databases
that both "pass"; no down migration; no test that exercises an old database file forward. Combined
with §11 of the inventory — two commits, everything else uncommitted — **there is currently no
rollback point for either code or schema.**

## G-7 — The dashboard ships an AI chat surface with no server contract · **S2**

**Standard:** `01` §2.10 — "AI may assist but must not be the sole authority."
`04` — "AI-generated switching content must be reviewed by qualified personnel."

`northstar-clean.html:422` POSTs to `/api/ai`, which does not exist in `ieso_backend.py`. Today
that is a dead button. The gap is what happens next: there is no declared contract stating what an
AI surface in this product may see, what it may assert, or how its output is labelled — so the
first implementation of `/api/ai` will define that policy by accident, in an operator-facing
control room, with the roster and the switching drafts one function call away.

Either remove the control or write the contract before implementing it. The backend rule that
matters is already established elsewhere in this codebase and should be reused verbatim:
`NORTHSTAR_VOICE_ENGINE=none` never emits placeholder transcript text, because "a fabricated line
could later be read as something a person said." The same reasoning applies to any AI answer
rendered next to live operational data.

## G-8 — Timestamps are local-offset, and entity ids are not globally unique · **S3**

**Standard:** `03` — "Store timestamps with timezone-aware UTC representation; retain source/local
timezone context where operationally relevant." "Use immutable globally unique IDs for durable
entities."

Timestamps are `datetime.now(ZoneInfo("America/Toronto")).isoformat()` — tz-aware, so unambiguous
and correctly ordered across the DST boundary, but stored as local-with-offset rather than UTC
with local context retained. Low urgency; real friction the moment a second site, a second
timezone, or an external system consumes this data.

Ids are `<prefix>-<epoch_ms>` with a collision loop. Unique within a table, not globally, and
predictable — which is G-1's root cause and the reason this item is not purely cosmetic.

## G-9 — Deployment: development topology is serving production · **S1 (accepted, undated)**

**Standard:** `01` §4 — "No packet may assume that the current development tunnel is an approved
production architecture." `04` — environment separation, backup/restore procedures.
`06` — backup/restore verification.

The developer PC is the production host. There is no test or staging environment, no CI, no
deployment automation beyond `start-northstar.ps1`, no process monitoring, and — importantly —
`daily_backup()` writes backups that **no procedure or test has ever restored**. Packet 00 does
not require this to be fixed now; it requires that it not be mistaken for an approved
architecture. It is recorded here so that no later packet inherits it as a decision.

Two specific items inside this, both worth naming:

- **`0.0.0.0` bind.** The tunnel is outbound-only, but the listener also answers directly on the
  LAN, where neither Cloudflare Access nor the edge path rule exists. The 2026-08-11 static-file
  fix closed the file-serving half of this. The API half remains: see G-10.
- **Backup restore is unverified.** Packet 06 lists it as a required test layer. It is the
  cheapest S1-adjacent gap to close and needs no architectural decision — see
  `MIGRATION_SEQUENCE.md` Stage 1.

## G-10 — The operator gate trusts an unverified header · **S1 (design constraint, flag only)**

**Standard:** `04` — "Company-approved identity provider where available";
`05` — "Authorization occurs server-side."

`_operator_gate_blocks()` ends at:

```python
return not self.headers.get("Cf-Access-Jwt-Assertion")
```

Presence, not validity. The JWT is never decoded or verified against the Access team's public keys.
This is a reasonable simplification *if and only if* nothing but Cloudflare can put that header in
front of the listener — and the listener binds `0.0.0.0`.

**Both halves of that assumption were probed on 2026-08-11, and both failed.**

- *Internet:* Cloudflare does **not** strip a client-supplied `Cf-Access-Jwt-Assertion`. A forged
  header returned the roster (read) and could clear a distress call (write). Mitigated by ADR-012;
  see G-13.
- *LAN:* verified, still open. With the gate on and ADR-012 applied, a request carrying
  `Host: 192.168.1.50:4180` and a forged header still returns **200** on `GET /api/checkins`.
  Anything on the local network is an operator: full roster with live GPS, every site QR token,
  the operational log, and the switching drafts.

This is an authentication trust boundary, so it is flagged rather than changed. **Decision
required (D-2).** Cheapest mitigations, in order of cost:

1. **Probe the assumption.** Send `Cf-Access-Jwt-Assertion: x` to `https://checkin.northstarenergy.ca/api/checkins`
   from outside and confirm 403. One command, no code change, and it either closes the internet
   half of this or turns it into an emergency. This should happen before anything else in this
   document.
2. **Bind to `127.0.0.1`.** cloudflared connects to localhost, so the tunnel is unaffected; this
   removes the LAN path entirely. It would break any current LAN use of `:4180` — the owner needs
   to confirm nobody relies on it.
3. **Verify the JWT** against the Access certs endpoint (`aud`, `iss`, expiry). Correct, and the
   right long-term answer, but it is a real change to the authentication path and wants its own
   review and tests.

## G-11 — No identity model, so least privilege cannot be expressed · **S2 (blocks Packet 02)**

Authorization is one bit: operator or not. Packet 04 requires least privilege; Packet 00's
dependency map puts Identity/Permissions/Audit at position 02, before the electrical twin and the
switching engine. The switching workflow already needs a distinction the system cannot represent —
`record_switching_review` is the qualified-person review, and today any operator-gated caller can
record one. `_operator_actor()` captures *who* from the Access email header, so attribution
exists; entitlement does not.

This is the single largest blocker to Packets 03–06 and should be the first module built.

## G-12 — Repository hygiene · **S3**

Against `05`'s suggested shape, the tree is flat: ~60 screenshot PNGs, three superseded dashboards,
an abandoned Next/Drizzle starter, an 18 MB handoff ZIP, and `tmp/`, `output/`, `dist/`,
`handoff/*/source/` snapshots all committed alongside the runtime. `AGENTS.md` navigates this
well, which is why it has not hurt — but every grep, every audit, and every new agent pays for it,
and three of the ten `CREATE TABLE` hits in a schema search are stale copies.

No restructuring is proposed as part of this work order (task 7 forbids gratuitous rewrites). What
is proposed is that new code lands in `domains/` and `services/` from the start, so the tree
converges rather than being moved wholesale — see `PROPOSED_TARGET_ARCHITECTURE.md`.

## G-13 — Confirmed live exposure via a forged edge header · **S1 (mitigated 2026-08-11)**

The probe called for in G-10 was run and found a working bypass of the operator gate from the open
internet. Recorded here as the finding; the decision and its consequences are ADR-012.

| Request to `checkin.northstarenergy.ca` | Before the fix | After |
|---|---|---|
| `GET /api/checkins`, no header | 403 | 403 |
| `GET /api/checkins`, forged header | **200 — 3,505 B roster** | 403 |
| `GET /api/checkins?include=all`, forged | **200 — 10,782 B** | 403 |
| `GET /api/checkins/history`, forged | **200 — 17,876 B** | 403 |
| `POST /api/checkins/<id>/help/resolve`, forged | **200 — clears a distress call** | 403 |
| `/api/checkin-tokens`, `/api/logbook`, `/api/switching/drafts`, `/api/voice/recordings` | 404 at edge | 404 at edge |

The write case is the serious one, and it is the same class as the audit finding of 2026-08-11 —
an unauthenticated caller clearing a lone worker's alarm — reopened through a different door.
`OPERATOR_ROUTE_PATTERNS` correctly classified those routes as operator-only; the gate then let a
forged header satisfy the operator check.

**The lesson worth carrying:** the two live exposures this system has had were both *the operator
classification being right and the authentication behind it being weaker than assumed*. The route
table is not the risk. What counts as proof of an operator is.

Mitigated by ADR-012 and two regression tests. **Requires a backend restart to take effect**, and
does not close the LAN path (G-10).

---

## What is genuinely good, and must survive any restructuring

Recording this deliberately: a migration that loses these has made the system worse, and several
were bought with a live incident.

1. **The method-aware operator gate.** `GET /api/checkins` is the roster, `POST` is a worker
   checking in — same path, opposite trust. Any router rewrite must preserve method-awareness.
2. **`OPERATOR_ROUTE_PATTERNS`.** Sub-route coverage for `/help/acknowledge` and `/help/resolve`,
   bought by the 2026-08-11 audit finding that they were reachable unauthenticated.
3. **Fail-closed startup.** Refusing to boot with a public `CHECKIN_ORIGIN` and the gate off.
   Rare, correct, and worth generalising into a startup invariant check.
4. **`_static_forbidden` + 404 directory listing.** Allowlist by suffix, not denylist by name.
5. **The voice rules.** Never invent a transcript; triage may demote chatter but the server
   *refuses* to filter a safety segment; filtered is queryable and reversible.
6. **Switching stops at REVIEW RECORDED – NOT RELEASE**, and source-file bytes never leave the
   browser without an approved retention design.
7. **SCADA is file-drop, one-directional, validating, with rejects and watermarks.** This is the
   OT boundary Packet 00 §"OT boundary" asks for, already correct.
8. **`_session()` closes its handle** — the comment explains that `with sqlite3.connect(...)`
   commits without closing and leaks one handle per HTTP request.
9. **`AGENTS.md` itself.** It is the reason the invariants above are still true.

---

## Decisions required from the owner / engineering

| ID | Question | Blocked work | Raised by |
|---|---|---|---|
| **D-1** | Do worker device routes get a real credential, and do check-in ids become unguessable? | Nothing — but it is live now | G-1 |
| **D-2** | Probe whether Cloudflare strips client-supplied `Cf-*` headers; then decide on `127.0.0.1` bind and/or JWT verification | Nothing — probe is free | G-10 |
| **D-3** | ADR-005: identity provider. Stay on Cloudflare Access, or move to the company IdP? | Packet 02, and G-11 with it | G-11 |
| **D-4** | ADR-003: production database. Stay on SQLite, or plan PostgreSQL? | Packet 01 shape, G-6 migration tooling | G-6 |
| **D-5** | ADR-004: production hosting. Who approves the tunnel-from-a-workstation topology, and by when? | Everything downstream of "approved production" | G-9 |
| **D-6** | Is there an AI surface in this product? If yes, what may it see and how is its output labelled? | `/api/ai`; any AI in switching | G-7 |
| **D-7** | ADR-007: electrical calculation engine — fidelity, library, and validation benchmarks | Packets 03, 04, 06 | Packet 00 open |

D-1 and D-2 are live-system questions and should not wait for the others.

## Authoritative requirements that are missing (work order task 9)

Flagged, not invented:

- **Lone-worker check-in cadence.** `contractor-checkin.html` states "I am working alone and
  require hourly safety check-ins", while the heartbeat is a browser `setInterval` that a locked
  phone kills, and the owner decided on 2026-08-11 that OVERDUE is advisory. The wording promises
  a cadence the system does not keep. Whatever the applicable Ontario lone-worker requirement is,
  this repository does not cite it, and no agent should decide it.
- **Switching procedural rules.** `_switching_validation_errors` enforces completeness of a form.
  Nothing in the tree cites the UWPC/EUSR procedure it is meant to reflect, so "valid" currently
  means "the fields are filled in."
- **Retention periods.** `retention_policies` and `NORTHSTAR_COORDINATE_RETENTION_DAYS` are
  configurable with a default; no privacy or labour requirement is cited as the source of the
  number. Packet 04 puts worker device data under privacy/labour/IT review (ADR-008).
- **Escalation policy per site.** `site_policies` / `escalation_mode()` encode a mechanism; the
  authoritative escalation procedure it implements is not referenced.
