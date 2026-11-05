# Login worker button — 2026-11-05

Removed the version badge, its build-data script, and the field-worker explanation. Moved WORKERS - CONTRACTORS directly beneath OPEN DASHBOARD with matching dimensions and solid green styling. Worker destination remains https://checkin.northstarenergy.ca/contractor-checkin.html. Authentication and clock JavaScript after the removed version block are byte-for-byte unchanged after newline normalization.

## Verification

- Browser preview visually verified both buttons and absent labels. Separate preview uses an unauthenticated session stub to preserve the user's signed-in production session.
- Public HTTPS response contains the new markup; Cloudflare rewrites support email links as before.
- Inline JavaScript syntax check passed.
- Full pytest: 599 passed, 4 failed, 21 skipped, 8 errors, 347 subtests passed. Failures/errors match the previously recorded baseline: missing data-foundation schema, retired Sites pipeline, and research-access expectations. No auth-suite failures.
- Runtime operator-login.html matches source SHA256 923a7109a2a288a400e39e432fe123003143a3b1baa72343495e48b495d2167c.

## Deployment and recovery

Installed static HTML under the coordinator lock with a preimage hash guard; no restart. Private preimage remains in the runtime outputs/private-preimages/20261105-login-workers-button folder. Native SCADA archives are not included.
