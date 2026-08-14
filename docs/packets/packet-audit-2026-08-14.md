# Packet audit, 2026-08-14 — is the current build missing completed work?

**Question:** audit every packet and its goals; confirm the current build has not lost work that was
already completed.

> **CORRECTED 2026-08-14, second pass.** The first version of this document claimed two features
> were lost and that the Overview chat box silently failed. All three claims were wrong, and the
> corrections are in §1. The error and its cause are recorded in §6 rather than deleted, because the
> cause — diffing only `northstar-clean.html` — will produce the same false positives for the next
> person who audits this way.

**Bottom line: nothing that worked was lost.** One feature did disappear — the logbook rich-text
editor — but it never functioned end-to-end in the single build that contained it, and re-landing it
as written would corrupt operational log records. Everything else that looked missing turned out to
have moved into a sibling module, been deliberately superseded, or never been built. No backend
capability, API route, security control or data field was lost.

The one genuine code defect found is unrelated to any loss: three competing definitions of
`openNode` (§1.3).

Method: the 48 build ZIPs produced on 2026-08-13 were extracted (only 14 had ever been unpacked),
giving a 40-build corpus. Identifier sets — function names, element ids, `data-module-id`, CSS
classes, `/api/` paths, text labels — were diffed between each historical build and the current one.
Packet goals were extracted from `docs/architecture/`, `AGENTS.md`, the ADRs, the packet reports and
git history.

---

## 1. Findings

### 1.1 Ontario Market dog-ear — NOT LOST (first-pass error)

**Verdict: the capability is present and working.** `.ontario-market` in the current build is the
IESO tile — the class name is legacy:

    <div class="ontario-market ieso-tile" data-module-id="IESO">
      <button class="market-dogear" data-expand="IESO" …>

The dog-ear is there. `market-workspace.js` registers IESO as a real node and renders a dedicated
detail panel:

    data.nodes.IESO = buildIesoNode(data);
    nodeLabels.IESO = 'IESO';
    …`<label>${isIeso ? 'IESO MARKET DETAIL' : 'IESO NODE DETAIL'}</label>`

That is the successor to `openOntarioMarketTab`: the bespoke Ontario aggregate panel was
reimplemented through the generic node mechanism, which is what `AGENTS.md` asks for — one system,
not a bespoke second one. `market-workspace.js?v=7` loads at offset 342133, after every inline
definition, so it wins.

`.ontario-detail-grid` is therefore legacy styling, not evidence of an orphaned feature.

The original detail below is kept because the identifier-level facts are accurate — the *inference*
from them was wrong.

### 1.2 Ontario Market dog-ear — the original (incorrect) finding

| | |
|---|---|
| Lost identifiers | `openOntarioMarketTab`, `openOntarioMarketTabSafe`, `ontario-market-link`, `safeOntarioMarketLink`, `?market=ontario` |
| Present in | **31 of 40 builds**, from the 2026-08-05 handoff through `Wider-Bold-Navigation` (07:48) |
| Lost at | `Logbook-Rich-Editor`, 07:49 — never restored |
| In current build | absent from every runtime file |

At 07:48 the Ontario card got a dog-ear built imperatively:

    const ontarioMarketLink = document.createElement('button');
    ontarioMarketLink.className = 'market-dogear ontario-market-link';
    ontarioMarketLink.title = 'Open Ontario Market';
    ontarioMarketLink.onclick = openOntarioMarketTab;
    document.querySelector('.ontario-market')?.append(ontarioMarketLink);

Dog-ears were later refactored to a declarative `data-expand` scheme. IESO and the four node cards
carried over; Ontario did not, because it is not a node — `nodeLabels` is
`{APIROQ, M1S, F2B, 'K2M CCTS'}`, and `.ontario-market` is a separate element with its own grid span.

**Effect:** Ontario is now the only market surface on Overview with no dog-ear and no way to open its
detail view. Its CSS still renders the card, and `.ontario-detail-grid` survives as orphaned dead
CSS — the styling for a detail view nothing can now open. That orphan is corroborating evidence
rather than a second defect.

This was not a recorded decision: no mention in `AGENTS.md`, `docs/`, any ADR, or any commit message.

**Recovery:** lift the builder and `openOntarioMarketTab` from
`NorthStar-Wider-Bold-Navigation-2026-08-13.zip`, or give `.ontario-market` a
`data-expand` dog-ear so it uses the current mechanism rather than reviving the imperative one. The
second is preferable — `AGENTS.md` is explicit that there must be one layout/interaction system, not
a bespoke second one.

### 1.3 Logbook rich-text editor — genuinely absent, but it never worked

**Verdict: do not re-land as written.** The identifiers really are gone, but the feature was a
half-wired draft that would corrupt operational records. Verified inside the 07:49 build itself:

- It stored **raw HTML**: `sync = () => source.value = body.innerHTML + …`, POSTed to `/api/logbook`
  as `details`.
- But that same build's `eventMarkup` still strips markup on render:
  `String(e.details||'').replace(/[<>&]/g,'')`. So `<b>fault</b>` displays as `bfault/b`. The editor
  and the renderer were never reconciled.
- `FormData` count is **0** — attachments were never uploaded anywhere. Only `files.map(f=>f.name)`
  appended filenames as text, so the chips implied a capability that did not exist.
- `readAsDataURL` inlined images into the contenteditable, which flows into `details` — a base64
  blob written into an operational audit column of a database that is backed up daily, and then
  stripped to garbage on render.

Losing it was accidentally the correct outcome.

**If you do want rich logbook entries**, it is a design task, not a restore: decide whether the
operational record may contain markup at all (it changes the record format, the shift-handoff and
incident exports which concatenate `e.details` as plain text, and retention), then implement an
allowlist sanitiser on render rather than removing the `[<>&]` strip, and route attachments through
real upload instead of data URIs. The existing `logAttachments` / `logAttachmentList` elements are
the place to start.

### 1.4 Three competing definitions of `openNode` — real defect, currently harmless

`northstar-clean.html` defines `function openNode` twice (offsets 135889 and 176895) and
`renderNodeDetail` once (170966). `market-workspace.js` defines both again and loads last, so the
module version wins and runtime behaviour is correct.

The risk is not runtime, it is maintenance: an agent that edits the inline copy will see no effect
and conclude the code is not running. That trap cost this audit real time — it is why §1.1 was
initially mis-diagnosed. Removing the dead inline copies is safe (they are shadowed before any user
interaction can occur) but is surgery on a 344 KB file serving a live console, so it is left as a
separate reviewed change rather than folded into an audit.

### 1.5 The original (incorrect) rich-editor loss detail

| | |
|---|---|
| Lost identifiers | `logDetailsEditor`, `logImageButton` / `logImageInput`, `logAttachmentButton` / `logAttachmentInput`, `rich-editor` / `rich-toolbar` / `rich-content` / `rich-attachments` / `rich-help` / `toolbar-separator`, `data-command`, `execCommand` |
| Present in | **exactly 1 of 40 builds** — `Logbook-Rich-Editor`, 07:49 |
| In current build | absent |

A contenteditable WYSIWYG logbook body with a formatting toolbar (`insertUnorderedList`,
`insertOrderedList`, `removeFormat`, `insertHTML` via `data-command`), inline image embedding through
`FileReader.readAsDataURL`, and attachment capture.

It exists in one build and one build only. That build is also the smallest in its window — 325,352
bytes against 340,836 immediately before it — because it was assembled on a stale base that lacked
about 15 KB of concurrent work. The next build, `Field-Staff-Two-Station-Columns` (07:52), went back
to the good base and recovered that 15 KB, and the rich editor went with it. A parallel-thread
collision, which is what the `Three-Thread-Dashboard-Recovery` build earlier that morning was already
about.

The current logbook is a plain textarea:

    <textarea class="logbook-body" id="logDetails" placeholder="Compose the operational messa…">

**Partially survived:** `logAttachments` and `logAttachmentList` DO exist in the current build, so
attachments are not wholly gone — what is missing is the rich-text editing surface, the formatting
toolbar and inline image embedding.

**Recovery:** `NorthStar-Logbook-Rich-Editor-2026-08-13.zip`. Note this feature was never reviewed or
tested — it existed for three minutes of build history — so treat it as an unreviewed draft to
re-land deliberately, not as a regression to restore blindly. `execCommand` is also deprecated;
re-landing is a good moment to reconsider the approach.

---

## 2. Checked and fine — do not re-chase these

| Suspected | Verdict |
|---|---|
| `northstarOverviewLayout` (localStorage) | **Superseded.** Packet 21's single layout system uses `STORE = 'northstarModuleLayout'` and `'northstarModuleLayoutSaved'`. Deliberate. |
| `northstarModuleLayoutBackup` | **Not a feature.** Appears in 3 recovery-era builds only (06:37–06:53) — a temporary safety key during the restore. |
| `.ontario-detail-grid` | **Still present** — but orphaned by 1.1 above. |
| `"IESO demand and market summary from the IESO public reports."` | **Edited, not lost.** Replaced by `<p class="graph-note" id="graphNote">IESO real-time history and day-ahead forward pricing.` |
| `data-module-id="overview-market"` | **Superseded** by the Packet 21 layout rework; `data-overview-module` is present (11 occurrences). |
| Markets dog-ears generally | **Intact.** 19 occurrences in the current build, identical to the 07:48 peak, plus more in `market-workspace.js`. |
| Packet 12 canonical asset ID / topology revision | **Present.** `topologyRevision`, `topologySnapshotId`, `AssetId` — camelCase, not snake_case. |

---

## 3. Packet status

Consolidated from four independent document sweeps. "Claimed" is what the documents assert;
"In build" is what was verified against current runtime source.

| # | Goal | Claimed | In build |
|---|---|---|---|
| 00 | System-architecture alignment: inventory, gap analysis, target architecture, migration sequence, decision log | COMPLETE | ✅ `docs/architecture/` present |
| 01 | Core data platform; relational system of record | NOT DONE | — blocked on D-4 |
| 02 | Identity and permissions; replace the single operator bit | NOT DONE | — blocked on D-3. **Packet 19 does not satisfy this** |
| 03 | Electrical digital twin / model acceptance | NOT DONE | — |
| 04 | Switching and topology service | PARTIAL | ✅ drafting only; `switching_drafts` present |
| 05 | Graphical one-line editor | PARTIAL | ✅ `one-line-editor-ui.js` present |
| 06 | Physics and training simulator | NOT DONE | — |
| 07 | Integration and release gates | PARTIAL | ✅ partial via P15/P17 |
| 08 | Operational evidence intake | COMPLETE | ✅ |
| 09 | Authorization and audit enforcement | COMPLETE | ✅ `_operator_gate_denial`, append-only audit |
| 10 | Knowledge access gateway | UNKNOWN | ❌ no gateway routes exist |
| 11 | AI knowledge engine | PARTIAL | ⚠️ no `/api/ai` handler by design (ADR-020, gap G-7); the chat box reports itself unconfigured rather than failing silently |
| 12 | Engineering assets and circuit sandbox | COMPLETE | ✅ `topologyRevision`, `AssetId` |
| 13 | UWPC/EUSR review evidence | COMPLETE | ✅ `/review-evidence` route present |
| 14 | Training and competency sandbox | NOT DONE | — does not exist anywhere; owner decision |
| 15 | Control-room integration gates | PARTIAL | ✅ `proposed/packet18_release_preflight/`, unwired |
| 16 | Repository / retention metadata fixture | COMPLETE | ✅ `repository_policies`, `artifact_repository_refs`, `/api/retention` |
| 17 | First canonical tagged release baseline | COMPLETE | ✅ tag `packet-17-2026-08-12`, `NORTHSTAR_RELEASE_SHA` |
| 18 | Consolidation pass; §18.1–18.5 | PARTIAL / mostly UNWIRED | ✅ present in `proposed/`, deliberately not wired |
| 19 | Demo operator authentication | COMPLETE | ✅ `SessionStore`, `LoginThrottle`, live |
| 20 | Hostname separation and worker safety | COMPLETE | ✅ `CHECKIN_PUBLIC_ROUTES`; **verified live: operator console returns 404 on the check-in host** |
| 21 | Dashboard UI, layout zones, workspaces | COMPLETE | ✅ present; the Ontario→IESO consolidation happened here and is correct |
| 22 | Acceptance / release validation | PARTIAL | ⚠️ logout, session expiry and live worker check-in still NOT VERIFIED — and the code is now released |

## 4. Open by design — not missing work

Packets 01, 02, 03, 06, 10, 11 and 14 were never built. They are upstream specification packets
blocked on owner decisions D-1 through D-7 (identity provider, production database, AI assistant
contract, calculation engine). `MIGRATION_SEQUENCE.md` sequences them. Do not confuse these with the
two genuine losses in §1.

**Corrected:** the first pass called the Overview chat box "a user-visible control that silently does
nothing." That was wrong. `/api/ai` genuinely has no server-side handler, but the client handles the
failure explicitly:

    catch { …insertAdjacentHTML('beforeend',
      '<div class="chat-msg">The home-PC AI connection is not configured yet.</div>') }

It states its own unconfigured status, which is the honest behaviour for a surface that ADR-020 says
has no contract. Not a defect. Packet 20 also contains it by default: an unrouted path is refused on
the check-in hostname without anyone having to remember to add it.

## 5. Limits of this audit

- **Source presence only.** Nothing here was verified by driving the running dashboard. A feature can
  be present in source and still broken at runtime.
- **Per-packet deliverable verification was shallow.** The multi-agent stage that would have checked
  each packet's deliverables individually failed on a session limit; claimed-COMPLETE packets were
  instead verified by signature-artifact search. A deliverable could be present in name but
  incomplete in substance.
- **The regression diff is thorough for 07:42→current and lighter before that.** Two of four diff
  agents failed. The 07:48→current comparison — the highest-signal one, spanning the incident — was
  done directly and is complete for ids, functions, module ids and API paths.
- **Only `northstar-clean.html` was diffed across builds.** The ZIPs also contain `.js` and `.css`
  that were not compared build-to-build; a loss confined to a sibling module would not appear here.
- **Packets 00–16 predate the build corpus**, so their work could not be checked for silent loss the
  same way — only for presence.

## 6. Why the first pass was wrong — read this before auditing the same way

The first pass reported two losses and one defect. All three were false positives, from one root
cause: **it diffed `northstar-clean.html` between builds and treated "absent from the current HTML"
as "lost".**

This project moves capability *out of* the inline HTML and *into* sibling modules as it matures —
that is the direction Packet 21 pushed. So the signature of healthy refactoring and the signature of
lost work are identical when you only look at one file:

| Looked like | Actually was |
|---|---|
| `openOntarioMarketTab` deleted | reimplemented in `market-workspace.js` as a registered IESO node |
| `.ontario-detail-grid` orphaned | legacy styling for a panel that still exists |
| chat box silently broken | explicit "not configured yet" message in its own `catch` |

Two habits would have caught all three:

1. **Search every runtime file, not the HTML.** `grep -r` across `*.html *.js *.py` — the capability,
   not the identifier. A renamed or relocated function is not a loss.
2. **Check load order before concluding anything about a duplicated function.** Three `openNode`
   definitions exist; the one that wins is in the file that loads last. Reading only the HTML gives
   the wrong answer twice over.

The multi-agent verification stage was designed to do exactly this refutation and was explicitly
instructed to default to "not missing" when a capability was found moved. It never ran — every
verifier died on a session limit — and the first pass shipped the unrefuted candidates as findings.
**Unverified candidates are not findings.** They were labelled as confirmed anyway, which is the real
process failure here.
