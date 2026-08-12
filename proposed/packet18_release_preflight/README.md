# Packet 18 §18.4 — release pre-flight check (Packet 15: release evaluator)

**Status: written 2026-08-12, NOT executed, NOT wired into `start-northstar.ps1`, NOT
wired into any build or CI step. Nothing about the live deployment changes by this
file existing.**

## What this answers

Packet 18 §18.4 asked whether Packet 15's release evaluator could be "wired into the
release/startup path" as something that "explicitly needs to actually gate
deployment," but written so a human verifies and enables it rather than an agent
flipping it on live.

Investigation found `scripts/prepare-sites.mjs` already does a narrow version of this
for the **Sites build only**: refuses a dirty checkout, refuses a `HEAD` /
`NORTHSTAR_RELEASE_SHA` mismatch, and stamps a `dist/.openai/release.json` manifest.
There was no equivalent for the **primary path** — the Python backend that
`start-northstar.ps1` launches and that the Cloudflare Tunnel actually serves.
`release_preflight.py` covers that gap, plus a handful of NorthStar-specific safety
invariants (operator gate defaults to on, the loopback-bind startup guard is present,
`data/` stays gitignored, the four named security regression tests still exist) so a
human running it before a deploy gets one consolidated go/no-go read instead of
having to re-derive all of it from memory each time.

## What it checks

1. Git checkout is clean (no uncommitted/untracked changes) — read-only `git status`.
2. If `NORTHSTAR_RELEASE_SHA` is set, `HEAD` matches it — same idea as
   `prepare-sites.mjs`, applied to the primary path.
3. `start-northstar.ps1` still forces `NORTHSTAR_OPERATOR_GATE=access` when unset.
4. `ieso_backend.py` still contains the startup refusal guard for a non-loopback bind
   combined with a public checkin origin.
5. `data/` is still verbatim-listed in `.gitignore`.
6. The four named security regression tests
   (`test_operator_gate_covers_help_subroutes_but_not_the_workers_alarm`,
   `test_static_tree_does_not_serve_secrets_or_the_database`,
   `test_forged_access_header_cannot_open_the_roster_on_the_public_host`,
   `test_forged_access_header_cannot_clear_a_distress_call`) are still present in
   `tests/test_api_workflows.py`.

Checks 3–6 were hand-verified against the actual current file contents while writing
this (line numbers and exact text confirmed by direct read, not assumed) — but text
presence is not the same guarantee as running the suite. Check 6 explicitly only
confirms the tests exist, not that they pass — `python -m pytest tests -q` is still
required and is not something this script runs.

## What it deliberately does not do

- It does not run `pytest`. Presence of the four named tests is checked; execution is
  not, because this script has no way to run them (and doing so is a separate,
  already-documented step).
- It does not check the Cloudflare Tunnel, Access policy, or anything about the live
  `northstarenergy.ca` deployment — no network calls, no live-site verification.
- It does not modify anything. Read-only `git status`/`git rev-parse` plus file reads.
- It is not called from anywhere. `start-northstar.ps1` does not invoke it. Deciding
  whether to add `python proposed\packet18_release_preflight\release_preflight.py`
  (or its final location, once someone signs off on where it belongs) as a required
  step before starting the service — and whether a failure should actually block
  startup or just warn — is a decision for whoever owns the deploy process, not
  something this pass makes unilaterally.

## Before relying on this

1. Read it top to bottom — it's short and stdlib-only, no new dependency.
2. Run it manually: `python proposed\packet18_release_preflight\release_preflight.py`
   (optionally with `$env:NORTHSTAR_RELEASE_SHA` set) and confirm the output matches
   what you'd expect by hand.
3. Decide where it should live permanently (`scripts/` alongside `restore_drill.py`
   seems the natural fit) and whether it should be a required gate or an advisory
   check before promoting it out of `proposed/`.
