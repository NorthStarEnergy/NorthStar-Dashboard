# Shared research access — 2026-10-23

## Request
Restore unavailable research reports and make every research report available to every user account.

## Implementation
Recovered seven projects and fourteen original files from the migrated Operations Research archive. Every original matches the SHA-256 recorded in its catalog metadata. Regenerated the browser catalog with the installed builder, adding source-hash validation. No application code was restored from the archive. The reader embeds exact downloadable originals, so users do not need Google Drive permissions to read or download reports.

Added an exact server allowlist for the shared research page, session script, reader assets and embedded catalog. All authenticated roles can GET/HEAD those assets. Anonymous sessions and the public check-in hostname remain blocked. Demo workspaces link to Research and retain restrictions on other company records, operational APIs and writes. The standalone reader uses the server session without redirecting demo roles away from Research. Operational daily-report collection remains an operator function. Dashboard and standalone asset versions are updated; build is v0.225.

## Verification
Browser checks passed for operator, platform_demo and site_viewer: all seven projects, all fourteen files, 42 byte-verified downloads, search, category filtering and 1440/390 layouts. Four backend research tests pass, including real HTTP GET/HEAD for all roles, catalog-byte validation, anonymous/expired/public-host denial, traversal refusal and demo navigation. JavaScript syntax and restart-script PowerShell parsing pass.

The required full Python suite ran: 511 passed, 21 skipped, 3 failed, 8 errors and 556 subtests passed. Two failures and eight errors reference pre-existing missing database-foundation/schema.sql and server/index.js. The third failure was the new test's Windows CRLF parsing of catalog.js, corrected in the test. The final focused authentication/research/hostname/isolation run passed all 52 tests and 515 subtests.

## Runtime
Installed in C:/Users/User/NorthStar/northstar-local under the integration lock after baseline-hash comparison. Restored static research files are on disk. A scheduled-task stop/start did not replace the old Python listener (PID 23212); Windows denied stopping that process. Public unauthenticated catalog response is still 404, whereas the updated backend returns 401. Therefore new all-role permissions are NOT yet active. The operator login page still returns 200. No account credentials or roles were modified.

## Recovery
Private preimages are in private-preimages/20261023-shared-research. baseline.json records original hashes. Compare against subsequent changes before restoring. Restored research originals have their independent provenance hashes. Do not publish private preimages, runtime credentials, databases, logs or local test dependencies.

## Delivery
Source, original reviewed research files, generated catalog, regression tests and restart script are preserved in the task repository. The installed runtime has no Git history and the task repository has only the retired Sites origin, not a configured github remote. No push to that retired deployment and no cloud Drive upload. The local Google Drive Backup is a recovery source, not a verified live upload destination.

## Remaining action
Run Restart-NorthStar-Research.ps1 in Administrator PowerShell. It validates the installed task and Python listener before restarting, then verifies the new authentication rule. Sign in again and refresh Research afterward. The all-account feature must not be represented as live until that restart succeeds.
