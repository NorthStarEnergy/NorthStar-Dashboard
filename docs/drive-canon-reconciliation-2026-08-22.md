# Drive CANON vs this repository — reconciliation, 2026-08-22

Drive tree: `00_CANONICAL_SOURCE_TREE`
<https://drive.google.com/drive/folders/1IYn-1AwI9jp4YotjoSb5Vcg2oxclSHYl>

## Verdict

**These are two different codebases, not two copies of one.** Neither is a stale duplicate of the
other, and neither should be copied wholesale over the other.

| | Authoritative for |
|---|---|
| **This git repository** | the system actually running on `ops.` / `checkin.northstarenergy.ca` |
| **Drive CANON** | the `NorthStar Dashboard v2` / v0.4–v0.6 product line: mobile apps, Docker, TimescaleDB, OPC-UA, market models |

Do **not** overlay Drive CANON onto this repo. Do **not** overlay this repo onto Drive CANON.

## Copying Drive → here would reopen fixed security holes

`start-northstar.ps1`, Drive copy, 4,482 bytes — the entire environment block is:

    $env:NORTHSTAR_PORT = [string]$port

That is the **pre-2026-08-11-audit** launcher. It sets none of the four defaults this repo's
10,657-byte version sets, each of which exists because the old behaviour was exploited:

| Missing on Drive | What its absence caused |
|---|---|
| `NORTHSTAR_OPERATOR_GATE` | gate defaulted `off` — a plain run served the operator roster on the public check-in hostname |
| `NORTHSTAR_ALLOWED_ORIGIN` | defaulted `*` — any website could call worker routes from a visitor's browser, including `DELETE /api/checkins/<id>`, checking a worker out |
| `NORTHSTAR_BIND_HOST=127.0.0.1` | the LAN bypass, closed per ADR-011 / ADR-022 |
| `NORTHSTAR_CHECKIN_ORIGIN` | QR placards generated against whichever origin the operator happened to open |

It also lacks `-DemoLogin` (Packet 19), `-LocalOnly`, and `-ServiceMode` — without which the
scheduled task cannot keep the backend alive; see `AGENTS.md`.

Every other overlapping runtime file is older on Drive:

| File | Drive | Here | |
|---|---|---|---|
| `northstar-clean.html` | 344,649 | 344,649 | identical — Aug 13 Field Staff Auto Height |
| `module-layout.js` | 19,584 | 19,584 | identical |
| `ieso_backend.py` | 91,019 | 90,988 | Drive is the 07:36 "current-saved-ui-default" build; **here is 08:14 and newer despite being smaller** |
| `northstar_store.py` | 54,686 | 79,845 | Drive predates Packets 17–21 **and the logbook hash chain** |
| `start-northstar.ps1` | 4,482 | 10,657 | see above |
| `contractor-checkin.html` | 11,489 | 12,846 | Drive older |
| `tests/test_api_workflows.py` | 8,660 | 22,534 | Drive lacks every security regression test |

This repo also holds **9 test files Drive has none of**: `test_demo_auth`, `test_logbook_integrity`,
`test_packet20_hostname_separation`, `test_packet16_repository_metadata`, `test_switching_workflow`,
`test_voice_workflows`, `test_engineering_workspace`, `test_market_summary_tiles`,
`test_legacy_sites_pipeline`.

## What Drive has that exists nowhere here — and is worth reading

This is the half worth protecting. None of it is wired into the running system, and none of it fits
the runtime's constraints as written (`AGENTS.md`: standard library only, `tzdata` the sole
dependency; these use PyJWT, asyncpg, asyncua). But two of them implement gaps this project has
recorded as open.

| Drive path | Size | Drive file ID | Why it matters |
|---|---|---|---|
| `core/identity.py` | 5,399 | `1Zr5XzD3lidgUD8OJ0172uBRmT6ZqMqEi` | **Packet 02.** `Actor` with real roles and `audit_entry()`. Its own docstring: "Replaces the literal string 'operator console' … the audit trail answered *when* but not really *who*." That is the exact gap `docs/compliance-assessment.md` calls the ceiling on everything else. |
| `core/jwks.py` | 10,037 | `1BEoVE5vfHHiR7RZt8Q84EzT2HfRSyjVs` | **ADR-011.** JWKS verifier with an asymmetric-only allowlist (blocks `alg=none` and RS256→HS256 confusion), kid-rotation DoS cooldown, TTL cache. `AGENTS.md` still says the Access JWT is not cryptographically verified. |
| `core/provenance.py` | 4,081 | `1c88b2LaNPcVnrFsyzt4dK4lf-_-Wj1un` | `Reading`/`Quality` types that make a non-live value impossible to render as operational. Same instinct as the voice rule "nothing is invented". |
| `daemons/opcua_collector.py` | 3,873 | `1v7QmwvJVtfUu5rgONoKUeATd9dYmH5jj` | Read-only OPC-UA → TimescaleDB mirror, disabled unless explicitly enabled, never writes to plant controls. Compare ADR-018 (SCADA is file-drop, read-only). |
| `core/` others | — | `notify.py` `backup.py` `banner.py` `server.py` `ingest.py` `config.py` | in folder `1rhwyrobDD0gi49EgNIrp6Ka9nip4PUsY` |
| `market/` | — | `1NA9OsBf6HpXeIJN-GYOL6w9X4Q5-EU_b` | `water_value.py`, `mpm.py`, `settlement.py`, `emi.py` |
| `database/migrations/V1__market_telemetry.sql` | 1,602 | `14tZl-BRNNI2HDN2XzE9AGjM-6AGWy2_T` | a real migration ledger — the thing ADR-016 says this project does without |
| `docs/` | — | `1Wn7u0n62BfLCsxyrEDpQx1E1RmTbi7Vc` | `MERGE-MAP.md`, `RELEASE-MANIFEST` and `PRODUCTION-GATES` for v0.4/0.5/0.6, `COMMISSIONING-CHECKLIST-v0.6` |
| `mobile-v0.4` / `v0.5` / `v0.6`, `Dockerfile`, `docker-compose.yml`, `NorthStar-Worker-Android-v0.1.zip` | — | — | no counterpart here at all |

**Nothing above was copied in.** They target a different architecture; importing them is a design
decision, not a sync. `core/identity.py` and `core/jwks.py` are the two worth an actual evaluation,
because this project has open, documented gaps that they address.

## If you want them synchronised

The only safe direction is **this repo → Drive**, replacing the runtime files in CANON with the
versions that are actually running and tested. Publishing the reverse would take the site backwards
by nine days and reopen three security holes.

Better still: stop treating Drive as a source tree. `git log` is the state of this project
(`AGENTS.md`, "How work is handed off"). Drive is delivery and archive. A second tree calling itself
canonical is how 2026-08-13 produced twelve builds and zero commits.

The single highest-value durability action is not a Drive copy: **push. 13 commits exist only on
this disk.** A disk failure loses the hash chain, the Packet 19–22 work, the audits, and the
auto-start fix — none of which is in Drive CANON.
