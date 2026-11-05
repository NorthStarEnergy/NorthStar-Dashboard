# r013 main integration and source dependency repair

## Result

Restores `northstar_shelf_mobile.py`, omitted from the GitHub snapshot despite
being imported by the backend. The implementation was recovered from the
installed application source, without reading or copying credentials, invitation
hashes, session databases or operational data. Its existing Shelf-only PIN,
invitation, expiry, lockout, operator-host and same-origin checks are retained.
`NORTHSTAR_SHELF_MOBILE_DATA` can select an isolated session-storage root.

## Missing optional components

Shelf web, reminders and printer implementations are not supplied by this
checkout. Requests requiring them return explicit HTTP 503 `unavailable`, rather
than import failures or successful placeholders. No printer, push service or
live Shelf setup is claimed as verified, and no new access is provisioned.

## Additional omissions found by the full suite

The separate data-foundation schema and the retired static-server redirect were
also absent. Both source files were recovered from the existing Shelf source
checkout. Only the SQL schema and seven-line redirect were restored; no database
or captured application data was copied. The existing foundation tests exercise
exclusive creation, referential integrity, provenance and immutable revisions.

## Regression fixture repairs

Three JavaScript fixtures predated current browser APIs, crew-strip behavior and
the station script version. They now supply the actual station catalogue and
browser events, check total on-site counts independently from due/missed state,
retain lone-worker highlighting checks, and verify the script reference without
pinning an obsolete cache version. Runtime dashboard behavior is unchanged.

Research tests now distinguish the site-only role from the newer shared platform
demo: only the latter can load the shared session bootstrap and read report
status. Both retain denial checks for private research files, traversal, library
data and unauthorized writes. The platform entrypoint is checked as the shared
role-filtered shell, with research directly accessible under the existing gate.
The demo-isolation fixture now uses this checkout rather than a hard-coded live
installation path. No authorization allowlist was widened.

## Verification

The initial complete run identified the missing schema/redirect and outdated
research assertions: 616 passed, 21 skipped, 4 failed and 8 setup errors. The
affected dependency and role-policy checks then passed: 24 tests and 70 subtests.
Final full runs:

- `python -m pytest tests -q --tb=short -ra`: **628 passed, 21 skipped,
  347 subtests passed**, no failures (159.15 seconds).
- `node --test tests/*.test.cjs`: **72 passed**, no failures or skips.

Of the 21 Python skips, 19 require the unavailable `psycopg` dependency and a
configured disposable PostgreSQL test database; two are opt-in PostgreSQL browser
integrations. Those integrations remain **unverified**. No skips were added to
make this change pass.

## Merge scope and runtime

Prepared on `codex/r013-island-cts` and integrated into GitHub main only after
verification and a fresh fetch. No shared running checkout, credentials, service
configuration or live process bindings were changed. Production restart and
authenticated live Shelf/browser checks are separate from this source merge.

## r013 acceptance remains pending

`SIM-IS-TW-IR-R013` stays `draft_site_model`. The 600 V step-up routes, auxiliary
wiring, circuit-switcher operating duty, source rating/voltage discrepancies,
and dynamic assumptions remain explicitly marked. Missing connections and their
dependent controls remain blocked. Passing software tests is not as-built or
native ABB acceptance; see `2026-11-05-r013-island-cts.md` for those boundaries.
