# Packet 18 §18.5 — browser smoke test definitions

**Status: written 2026-08-12, NOT executed, NOT installed, NOT wired into any build or CI step.**

## What's here

`dashboard.smoke.spec.ts` — Playwright-syntax smoke tests covering the four
things Packet 18 §18.5 asks for: operator navigation, module-unavailable
states (Flows, Field Staff, Weather), and public-host denial.

## Why Playwright, and the honest caveat about that choice

Playwright is the most standard convention for this kind of test, and this
file is written against its API. **It is not confirmed to match whatever the
project's existing TypeScript suite actually uses.** Packet 18's own baseline
mentions "Packet/TypeScript suite: 45 tests across 12 suites," but no such
suite was found anywhere under `C:\Users\Ryan1\Documents\Work Projects\control-room-dashboard`
during this session — no `vitest.config.*`, no `*.test.ts` outside
`node_modules`, nothing under a `packets/` directory. It may live in a
location this session didn't have access to, or under different tooling
entirely. If so, treat this file as a spec to port into that suite's actual
conventions, not as a ready-to-merge addition.

`@playwright/test` has deliberately **not** been added to `package.json` or
`pnpm-lock.yaml` — adding a dependency without being able to run
`pnpm install` and confirm the lockfile stays consistent is exactly the kind
of unverified change this work avoided elsewhere.

## Before running this

1. Decide where it actually belongs (see caveat above).
2. `pnpm add -D @playwright/test` (or add it wherever the real suite's
   dependencies live) and run `npx playwright install` for the browser
   binaries.
3. Start a local instance: `.\start-northstar.ps1` (default
   `http://localhost:4180`).
4. **Do not point `NORTHSTAR_SMOKE_BASE_URL` at the live
   northstarenergy.ca deployment.** One test creates a real check-in record
   via `POST /api/checkins`. Local/test server only.
5. `npx playwright test proposed/packet18_browser_smoke`.

## One specific thing to check first if it fails

The public-denial tests rely on being able to set a custom `Host` header
through Playwright's request client (this is normally blocked in a real
browser's `fetch`, but generally allowed in Node-based HTTP clients like
Playwright's). That specific behavior was not verified in this session. If
those two tests fail in a way that suggests the `Host` override didn't take
effect, check that first before treating it as a regression in
`ieso_backend.py`'s gate logic.
