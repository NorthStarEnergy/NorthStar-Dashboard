# ADR-013 — Python standard library, one process, one file per domain

**Status:** Accepted (retroactive record) · reaffirmed 2026-08-11

## Context
The runtime is `ThreadingHTTPServer` + `SimpleHTTPRequestHandler` + `sqlite3`, ~5,200 lines across
four modules, four background daemon threads. `requirements.txt` is one line: `tzdata`.

## Decision
Keep it. No web framework, no ORM, no vendor SDKs. Transcription is engine-agnostic through
`NORTHSTAR_VOICE_COMMAND`.

## Consequences
- Deployment is "copy the folder and run python". No build, no lockfile drift, no supply chain.
- No dependency vulnerability surface — a genuine security property for a system a single
  maintainer keeps alive, and one that makes most of Packet 04's dependency-management requirement
  moot rather than unmet.
- Costs paid deliberately: hand-rolled routing (a ~400-line `if/elif` chain), hand-rolled schema
  migration, no request/response schema validation, no async.
- An abandoned second stack exists at `control-room-dashboard/` (Next 16 / React 19 / Drizzle /
  Cloudflare). It is not the runtime and must not be revived by accident.
- The one place a dependency may be justified is JWT verification — see ADR-011.
