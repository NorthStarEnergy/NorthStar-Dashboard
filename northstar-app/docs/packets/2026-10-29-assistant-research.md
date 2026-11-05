# NorthStar assistant research upgrade — 2026-10-29

The existing assistant made one model request after keyword retrieval. This packet adds bounded multi-step research through read-only, server-scoped tools, using the existing provider and credentials.

## Changes

Document search, adjacent clause reads, source status inspection, follow-up operational lookup, typed dataset samples, saved inflow overview/target inspection, and deterministic engineering calculations. Public research runs in a separate request with a fixed public topic and official-domain filter, never the private question/history/records. Main inference still receives authorized internal evidence.

The Responses loop preserves call IDs and encrypted reasoning items, disables remote storage, caps rounds/calls/topic searches, uses an overall timeout, and rejects incomplete responses. Pending/expired/withdrawn/legacy source exclusion and site access remain enforced. Source withdrawal is observed on repeated reads. No write/control tools are added. Original operator/hostname gates are unchanged.

Answers retain the concise lead and expandable detail, gain numbered safe source links, and no longer claim human review or derive confidence from source count. Empty/stale market snapshots no longer count as current evidence. Guidance distinguishes UWPC authority, IESO participation/dispatch/settlement, Hydro One connection requirements, NERC applicability, IEEE editions, electrical assumptions, SCADA indication quality, and hydrological validation.

## Verification

- Full isolated baseline: 523 passed, six failures, eight errors, 21 skips, 347 passed subtests.
- Full upgraded copy: 546 passed, the identical six failures and eight errors, 21 skips, 347 passed subtests. No added failure/error identities.
- Final focused assistant/knowledge tests: 61 passed.
- Both assistant UI variants pass numbered-source, safe-link, expansion and honest-label checks; existing three menu/citation checks pass.
- Authorized provider tests using synthetic/public context: hydro calculation about 17.65 MW; current IESO official-source research with applicability limits; unavailable inflow/data explicitly reported without fabricated values.
- Read-only local inspection of the actual saved inflow archive verifies the bounded overview and individual-target projections, including source timestamps and missing values. This is not a live model answer evaluation against internal records.

The unchanged baseline failures concern dashboard-build/client-release staging requirements, missing database-foundation schema, legacy server source, and research-page expectations. The suite is not fully green.

## Knowledge readiness and limits

The actual UWPC 2024 source is indexed (196 passages across 145 pages), but it and the changes overview remain PENDING_REVIEW. No source approval was invented. The requested reference-only study classification remains a user decision. Legacy metadata is not ingested as operating authority. No UWPC expertise examination or professional qualification is claimed.

Automatic approval review rejected a proposed live answer test using real internal inflow forecasts/validation because it would export that operational payload to the external provider. The test was not run; explicit user approval is pending. Local inspection and synthetic/provider tests are separate evidence.

This packet does not fine-tune provider model weights, refresh/resume the paused inflow service, or claim that historical fit establishes prospective forecast accuracy. Site-restricted inflow access remains unavailable pending a verified target-to-site mapping. Dataset reads are samples, not full historical analytics. IEEE licensed clauses must be supplied/reviewed before clause-level expertise can be evaluated.

See docs/assistant-expertise.md for the competency evaluation and document-maintenance contract. Runtime activation, source commit, archive receipt and recovery paths are recorded separately in the installed handoff.
