# `/api/ai` contract — draft, Packet 18 §18.3

**Status: documentation only. Nothing implements this. Nothing is wired to any model or retrieval source. This is a starting point for owner decision D-6, not a resolution of it.**

Existing reference: `ADR-020-ai-surface-has-no-contract.md` records that the
AI surface currently has no contract at all — this document is the first
draft of one, written so that whoever answers D-6 has something concrete to
react to rather than a blank page.

## 1. What this is not

- Not a decision that an AI surface should exist in this product. That's D-6.
- Not a model/vendor choice.
- Not a connection to the current dashboard placeholder
  (`<section id="assistant">` in `northstar-clean.html`, still an inert
  `<div class="panel placeholder">AI ASSISTANT</div>` — untouched this
  session, on purpose, since wiring it to anything is explicitly out of
  scope until D-6 is answered).

## 2. Authorization boundary

- **Route:** `POST /api/ai/query` (proposed name; not implemented).
- **Reachability:** operator-gated only, same mechanism as every other
  `/api/*` operator route in `ieso_backend.py`'s `OPERATOR_ROUTES` /
  `OPERATOR_ROUTE_PATTERNS`. It must never be reachable from the
  `checkin.` origin — add it to `OPERATOR_ROUTES` at implementation time,
  the same way `/api/voice` was added when voice content became
  operator-only.
- **Identity requirement:** stricter than today's operator gate. Today's
  gate (per `AGENTS.md`, verified in source this session) checks header
  *presence* and request origin, not a verified signature — that's
  acceptable for the existing routes under the current loopback-bind
  topology, but an AI surface that can retrieve and surface operational
  data should not go live before **Stage 3.1** (`MIGRATION_SEQUENCE.md`:
  "Verify the Access JWT properly — signature, `aud`, `iss`, `exp`") is
  done. That stage is blocked on **D-3** (identity provider decision).
  **This route should not exist in a deployed build before D-3 is answered
  and Stage 3.1 is implemented — not just before D-6 is answered.**
- **Role, once roles exist (Stage 3.2):** default to the narrowest role that
  can use it meaningfully, not automatically every `operator`. Whether that's
  a distinct `ai_user` grant or a subset of `operator` is itself part of D-6
  ("what may it see, how is output labelled").

## 3. Request / response contract

```
POST /api/ai/query
{
  "question": string,
  "context_scope": "site" | "market" | "worker-status" | "general"
}

200 OK
{
  "answer": string,
  "citations": Citation[],
  "uncertainty": "high" | "medium" | "low" | "unknown",
  "model_version": string,
  "input_snapshot_id": string,
  "persisted": boolean
}

501 Not Implemented
{
  "error": "ai surface not configured",
  "detail": string
}
```

```
Citation {
  "source": string,       // e.g. "checkins:row:1234", "market:node:APIROQ:2026-08-11T14:00Z"
  "source_kind": "database" | "document" | "live-feed" | "static-reference",
  "retrieved_at": ISO8601,
  "id": string             // stable identifier a human can look up independently
}
```

## 4. Citation requirements (non-negotiable)

- Every factual claim in `answer` must be traceable to at least one
  `Citation`, or the response must say plainly that it has none — never a
  bare, uncited assertion presented as fact.
- A citation must point at something a human operator can independently
  retrieve and check — a database row id, a document reference, a feed
  timestamp. Not "the model recalled this."
- If the underlying source has itself changed or gone stale since
  `retrieved_at`, that must be visible in the response, not silently
  papered over.

## 5. Uncertainty labeling

`uncertainty` is a required field on every response — there is no
"confident" default:

| Value | Meaning |
|---|---|
| `high` | Multiple independent, current, directly-relevant sources agree |
| `medium` | A single source, or sources that require interpretation/inference |
| `low` | Sources are indirect, stale, or partially contradictory |
| `unknown` | The system cannot assess its own confidence — treat as equivalent to `low` for any downstream decision |

A response with no citations must never carry `uncertainty: "high"`.

## 6. Data-access classification (informs D-6, does not resolve it)

Whoever answers D-6 needs to decide access per category, not as an
all-or-nothing switch. Categories, using this project's existing data model
as the reference:

| Category | Example | Default posture until D-6 says otherwise |
|---|---|---|
| Aggregate/public market data | Ontario market panel prices, node commitments | Plausible to allow — already shown on the public-facing overview |
| Live worker location/status | `checkins` rows, GPS, help state | **Do not grant by default.** This is exactly the safety-relevant data category ADR-008's "no cited privacy or labour requirement" gap already flags as unresolved for other purposes (see `docs/architecture/DECISION_LOG.md`, "Authoritative requirements that are missing" #3) |
| Voice transcripts | `northstar_voice.py` content | **Do not grant.** `AGENTS.md` treats this as operator-only, recorded speech containing "worker names, locations, and whatever else was said on an open channel" — an AI surface reading this needs its own explicit review, not an inherited default |
| Switching drafts | UWPC/EUSR review records | **Do not grant** until the controlled-document-retention gap in the original audit's F-08 is closed |
| SCADA readings | file-drop feed | Plausible to allow read access, consistent with SCADA already being read-only and file-drop by design (`ADR-018`) |

## 7. Fail-closed behavior

- No approved model/retrieval adapter configured → `501 Not Implemented`
  with a clear operator-facing message. Never a fabricated answer, never a
  silent empty response, never a fallback to an ungoverned general-purpose
  model reachable from the operator console — this is the exact failure
  mode Packet 18's own non-goals list rules out ("Do not connect the
  current placeholder directly to an ungoverned model").
- If a citation's source cannot be re-verified at response time (e.g. the
  underlying row was deleted), the response must say so rather than cite a
  source that no longer resolves.

## 8. Explicitly deferred to D-6

- Model/vendor selection.
- Retention policy for queries and answers (does asking a question about a
  worker's status create its own auditable record? Almost certainly yes,
  given this project's existing append-only audit-trail pattern — but the
  retention period and access-log requirements are D-6's to set, not
  assumed here).
- Whether output is same-role-as-operator or a narrower grant.
- Whether this is available on the mobile/Android surface at all.
