# NorthStar recovery runbook — QR secret, database, and deployment configuration

Written 2026-08-12, Packet 18 §18.2. Pure documentation of what already exists in source — no new
mechanism, no owner decision required. Everything below was confirmed by reading the actual code,
not assumed.

If this disagrees with `AGENTS.md`, `AGENTS.md` wins — fix this document.

---

## 1. The QR-signing secret

### What it is

Every site QR placard is a signed token: `n1.<base64url-json-payload>.<base64url-HMAC-SHA256>`
(`northstar_phase1.py`, `_token_text`/`_parse_token`). The signature is what makes a scanned code
trustworthy — anyone who has the secret can mint a token that resolves to any site NorthStar knows
about.

### Where it lives today

`_qr_secret()` in `northstar_phase1.py`:

1. If the environment variable `NORTHSTAR_QR_SECRET` is set, that value is used directly.
2. **Otherwise** (the current state — `start-northstar.ps1` does not set it), the backend reads
   `data/.northstar-qr-secret`. If that file doesn't exist, it generates one
   (`secrets.token_urlsafe(32)`, i.e. 256 bits) and writes it, once, on first run.

So right now, **the only copy of the live signing secret is a single file on this machine's disk**,
at `data\.northstar-qr-secret`, alongside the database.

### What happens if it's lost

`data/` is entirely gitignored (`.gitignore` line 3: `data/`) — this is deliberate, the secret is
an operational credential, not source, and must never end up in a commit. But that also means nothing
about it is tracked or backed up by git.

Worse: **the existing daily backup routine does not cover it either.** `daily_backup()` in
`northstar_store.py` copies only `data/northstar.db` into `data/backups/`. It never touches
`.northstar-qr-secret`. If the disk fails, the machine is lost, or someone deletes `data/` by
mistake while `data/backups/*.db` happens to be preserved (e.g. a future off-host mirror per D-5),
**every QR placard printed and mounted at every site becomes invalid** the moment NorthStar starts
back up and silently generates a brand-new random secret. Old tokens fail their HMAC check and
`resolve_site_token()` returns `None` — a contractor scanning a placard gets a failure with no
indication that the placard itself is now stale.

**This is a real, previously undocumented gap.** It doesn't require an owner decision to fix at the
process level (see §4 recommendation) — it just hasn't been fixed yet, and this document exists so
it's visible instead of discovered during an actual incident.

### Recovery procedure if the secret is lost

There is no way to recover the *old* secret once its only copy is gone — HMAC secrets aren't
derivable from anything else in the system. Recovery means **re-issuing every placard**, not
restoring the old one:

1. Confirm the loss: check whether `data\.northstar-qr-secret` exists. If it doesn't and
   `NORTHSTAR_QR_SECRET` isn't set, the next backend start will silently mint a new one — do this
   check *before* starting the backend if you suspect the secret was lost, so you know for certain
   rather than assuming.
2. Start the backend normally (`.\start-northstar.ps1`). A new secret is generated automatically.
3. Re-issue every site token: each site in `DEFAULT_SITES` needs a fresh QR code. The dashboard's
   QR-generation flow (`contractor-qr.html`, backed by `issue_site_token(..., rotate=True)`) does
   this — rotating explicitly revokes the previous token for that site as well as minting the new
   one, so there's no ambiguity about which placard is current.
4. **Physically replace every printed placard at every site.** This is the actual cost of losing
   this secret — it's not a five-minute fix, it's a field visit to Iroquois Falls, Island Falls,
   Fort Frances, and Kenora (the four `DEFAULT_SITES`), or wherever placards are mounted.
5. Old placards will fail closed (`resolve_site_token` returns `None`, the check-in page shows an
   error) rather than silently succeeding with stale routing — confirmed by reading `_parse_token`,
   which requires the HMAC to verify. There is no scenario where an old placard is accepted after a
   secret rotation.

### Recovery procedure for a deliberate rotation (not a loss)

Same as steps 3–4 above, initiated on purpose via `issue_site_token(site, rotate=True)` — no need to
touch the secret itself; rotation is per-site-token, not per-secret. Rotating the underlying
`NORTHSTAR_QR_SECRET`/`.northstar-qr-secret` itself would invalidate *every* site's tokens at once,
which is the loss-recovery path above, not the normal rotation path.

### Recommendation (documentation only — not implemented here)

`daily_backup()` should include `data/.northstar-qr-secret` alongside the database, or the secret
should be set explicitly via `NORTHSTAR_QR_SECRET` from a location that's already covered by
whatever off-host backup gets configured under D-5. Either is a small, low-risk change once someone
picks one — not made in this pass, since it touches the live backup code path and this session's
rule was documentation for §18.2, not backend edits.

---

## 2. Deployment configuration reference

Every `NORTHSTAR_*` environment variable found in the current source, what it controls, and its
default if unset. Confirmed by reading each file directly (`ieso_backend.py`, `northstar_store.py`,
`northstar_phase1.py`, `northstar_voice.py`) — this list is not copied from any other document.

### Core service

| Variable | Default if unset | Controls |
|---|---|---|
| `NORTHSTAR_BIND_HOST` | `127.0.0.1` | Listen address. `start-northstar.ps1` also hardcodes this to `127.0.0.1` unconditionally — see §3. |
| `NORTHSTAR_PORT` | `4180` | Listen port. |
| `NORTHSTAR_DB` | `data/northstar.db` (relative to project root) | SQLite database path. |
| `NORTHSTAR_ALLOWED_ORIGIN` | `*` in the backend's own default, but `start-northstar.ps1` sets it to `https://northstarenergy.ca,https://checkin.northstarenergy.ca` if not already set | CORS allow-list. **Never deploy with the bare `*` default** — see the F-06 finding in the original audit. |
| `NORTHSTAR_CHECKIN_ORIGIN` | unset (backend behaves as local-only) / `https://checkin.northstarenergy.ca` via the launcher | The public hostname printed into QR codes, and the value the operator-gate's Host check compares against. |
| `NORTHSTAR_OPERATOR_GATE` | unset (`off`-equivalent) in the backend / forced to `access` by `start-northstar.ps1` if not already set | Whether `Cf-Access-Jwt-Assertion` is required on operator routes. **This is the single most safety-critical variable in the system** — see `AGENTS.md` §1. |

### Backups

| Variable | Default if unset | Controls |
|---|---|---|
| `NORTHSTAR_BACKUP_REFRESH` | (see `northstar_store.py` line 28) | Minimum interval between daily-backup refreshes. |
| `NORTHSTAR_BACKUP_MIRROR` | unset — **no off-host mirror configured today** | Optional second directory `daily_backup()` also copies into. This is the D-5-blocked item from Packet 18 §18.2. |

### QR / worker safety

| Variable | Default if unset | Controls |
|---|---|---|
| `NORTHSTAR_QR_SECRET` | file-based fallback, see §1 | HMAC signing key for site QR tokens. |
| `NORTHSTAR_QR_KEY_ID` | `local-1` | Key identifier embedded in issued tokens, for future rotation support. |
| `NORTHSTAR_QR_TOKEN_DAYS` | `365` | Site-token lifetime. |
| `NORTHSTAR_PHONE_VERIFICATION_MODE` | see `northstar_phase1.py` line 509 | Shadow vs. real phone-verification delivery. |
| `NORTHSTAR_COORDINATE_RETENTION_DAYS` | see `northstar_phase1.py` line 688 | GPS/location-event retention — this is the mechanism behind the "no cited privacy or labour requirement" gap flagged in `docs/architecture/DECISION_LOG.md`. |
| `NORTHSTAR_OVERDUE_ALONE` / `NORTHSTAR_OVERDUE_CREW` | 60 / 240 minutes (per the original handoff doc) | Overdue thresholds. |
| `NORTHSTAR_ALERT_RECOVERY_MARGIN` | see `northstar_store.py` line 71 | Alert hysteresis. |
| `NORTHSTAR_WORKER_TOKEN_SECRET` | per-process random fallback | **Not live yet** — this is the signing secret for the proposed (unwired) worker capability tokens in `proposed/packet18_worker_safety/`. Listed here for when it is wired in, so this reference doesn't need rewriting twice. |

### Voice

| Variable | Default if unset | Controls |
|---|---|---|
| `NORTHSTAR_VOICE_INBOX` / `NORTHSTAR_VOICE_STORE` | see `northstar_voice.py` lines 161, 165 | Audio intake/storage paths. |
| `NORTHSTAR_VOICE_RETENTION_DAYS` | see line 169 | Audio retention (bytes only — events are append-only per `AGENTS.md`). |
| `NORTHSTAR_VOICE_ENGINE` | `none` | Transcription engine selector. `none` means audio is logged but never transcribed — "nothing is invented" is load-bearing, see `AGENTS.md`. |
| `NORTHSTAR_VOICE_COMMAND` | unset | External command template when `NORTHSTAR_VOICE_ENGINE=command`. |
| `NORTHSTAR_VOICE_TIMEOUT_SECONDS` | see line 262 | Timeout for that external command. |

### Feed polling

| Variable | Default if unset | Controls |
|---|---|---|
| `NORTHSTAR_SCADA_PATH` | see `northstar_phase1.py` line 221 | Read-only SCADA file-drop location. |
| `NORTHSTAR_SCADA_POLL_SECONDS` / `NORTHSTAR_VOICE_POLL_SECONDS` | see `ieso_backend.py` lines 36–37 | Background feed poll intervals. |

---

## 3. Redeploying from scratch

If this machine is lost entirely and NorthStar needs to stand up somewhere new, here is everything
that's needed, gathered in one place instead of scattered across `DEPLOY-RUNBOOK.md`,
`AGENTS.md`, and source comments:

1. **Source.** A clean checkout of the canonical git repository (tag `packet-17-2026-08-12` or
   later). `scripts/prepare-sites.mjs` already refuses to build from a dirty tree or a mismatched
   `NORTHSTAR_RELEASE_SHA`, which is the right instinct — extend that discipline to a full-machine
   rebuild too.
2. **Python** (stdlib-only backend; `tzdata` is the one stated dependency per `AGENTS.md`).
3. **The database.** Restore the newest `data/backups/northstar-*.db` — see
   `scripts/restore_drill.py` (written 2026-08-12, **not yet run by anyone as of this document** —
   run it before trusting a restored file operationally).
4. **The QR secret.** See §1. If the old file is gone, this is a full placard reprint, not a config
   copy — plan for that lead time separately from "the backend is running again."
5. **Cloudflare Tunnel.** The tunnel (`c40ae859-c686-46b8-a3af-3a67e7b81c5a`) is **remotely
   managed** — its Windows service runs `tunnel run --token-file C:\ProgramData\cloudflared\token`,
   and the actual ingress rules live in the Cloudflare Zero Trust dashboard, not in any file in this
   repository (`cloudflared-config.yml` is explicitly reference-only, per its own header comment).
   Recovery means: someone with access to the Cloudflare account (1) issues a new tunnel token from
   Zero Trust → Networks → Tunnels, (2) installs the `Cloudflared` Windows service with that token,
   and (3) re-creates the two public-hostname rules exactly as documented in `DEPLOY-RUNBOOK.md`
   §2 (`checkin.northstarenergy.ca` with its path allowlist, `ops.northstarenergy.ca` with none).
   **This document cannot restore Cloudflare account access by itself** — whoever owns that account
   login is a prerequisite this document can't substitute for.
6. **Cloudflare Access policy.** Re-create the self-hosted application for `ops.northstarenergy.ca`
   per `DEPLOY-RUNBOOK.md` §3, listing each operator's email. Verify the challenge works **before**
   turning the operator gate on, exactly as that document already says.
7. **Environment variables.** Everything in §2 above. Most have safe defaults via
   `start-northstar.ps1`; the ones that don't (`NORTHSTAR_BACKUP_MIRROR`,
   `NORTHSTAR_QR_SECRET` if choosing not to use the file fallback) are the D-5/§18.2 owner
   decisions, not something this document resolves.
8. **Verify.** Run the external smoke checklist already in `DEPLOY-RUNBOOK.md` §5, then
   `python -m pytest tests -q` and confirm it matches the `AGENTS.md` baseline.

---

## 4. What this document deliberately does not do

- It does not implement including the QR secret in `daily_backup()` — that's a live code change to
  `northstar_store.py`, out of scope for a documentation task, flagged in §1 as a recommendation for
  whoever picks it up next.
- It does not configure `NORTHSTAR_BACKUP_MIRROR` or choose a value for it — that's decision D-5,
  the owner's to make, not this document's.
- It does not claim the Cloudflare Tunnel or Access policy were re-tested this session — §3 restates
  what `DEPLOY-RUNBOOK.md` already specifies, verified by reading that file, not by performing a
  live redeploy.
