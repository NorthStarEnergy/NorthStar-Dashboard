# Deployment verification — 2026-09-14

## Delivered

Private environment files are now ignored by Git. Release builds can keep
`.env.local` in place without bypassing the clean-checkout requirement.

`scripts/verify-release.py` exports committed HEAD into temporary storage,
starts the backend with a fresh database and restricted environment, waits
for database readiness, checks 38 HTTP conditions, and terminates its own
process before removing temporary storage. The PowerShell smoke launcher
delegates startup to this verifier. It no longer starts a gate-off server
against the operational database or changes the caller's environment.

The checks cover 11 operator APIs, anonymous refusal, forged Access headers
on the public hostname, JSON responses, secret/source-file denial and the
operator HTML boundary. Synthetic headers exercise the origin contract;
they do not prove Cloudflare identity verification.

The runtime instructions now distinguish manual demo login, isolated checks,
and the public landing shell. Earlier messages describing runtime consolidation
as complete were too broad: the prior changes documented the existing split;
they did not implement the separate Cursor Next app routes in the operator app.

## Validation and scope

38 isolated HTTP checks passed against the merged source baseline.
The September 14 backup passed SQLite integrity, foreign-key, required-table
and audit-presence checks in a disposable restored copy. This verifies backup
structure, not complete application replay or disaster recovery.

## Next deployment gates, in order

1. Run the full Python regression suite, commit/tag this packet, then run clean
   preflight, isolated HTTP verification and the landing build against that commit.
2. Add CI to enforce these same checks on pull requests and protect the release
   branch. Verify the workflow on the repository before calling CI operational.
3. Verify current Cloudflare policies and real operator login in a staging
   environment, including public-host refusal and session expiry. Keep loopback
   binding; JWT verification remains required before exposing the origin elsewhere.
4. Rehearse service startup after reboot, monitoring/alert delivery and rollback
   on a staging host. The documented at-logon trigger is not proof of unattended
   reboot recovery. Establish service ownership and an incident contact.
5. Rehearse application reads and migration compatibility on an isolated restored
   database, include controlled-source and voice attachments in the backup plan,
   and agree recovery time and data-loss targets before production promotion.
6. Resolve company identity/role and approved-hosting decisions from the migration
   plan. Keep switching records as drafts/review evidence, never operational release.
7. Confirm whether the separate outage-stitch Next routes are required in this
   product. Existing Python API checks do not demonstrate parity with that app.

This packet prepares release verification. It does not promote a new live service,
configure external integrations, or certify the operational workflows for use.
