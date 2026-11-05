# Demo company-data isolation

## Request
Prevent demo users from seeing actual company data, spreadsheets or SOPs. Preserve the previously requested real site names and synthetic staffing distribution.

## Implementation
The platform_demo role now has a server-side allowlist: session, logout, canonical site id/name, and synthetic workers only. All other APIs and static files are denied, including new routes, AI/search, document viewers, exports and direct downloads. GET and HEAD both enforce the boundary. The older site_viewer role also enforces static restrictions for HEAD. Signed-out sessions cannot bypass the rules by fetching company assets or unregistered APIs; public mobile worker routes retain their existing access controls.

## User experience
Demo entrypoints load a separate self-contained read-only page. It does not load operational scripts, saved operator preferences, spreadsheets, SOPs or operational feeds. Cards and list use one synthetic dataset: 20 real site names, 10 occupied sites, 33 synthetic workers, and 4 sites with 2–5 contractors. Worker name colors match their company. Ryan and other operator-role users retain the full dashboard, including prior quick-add improvements.

## Verification
76 focused security/regression tests covered demo authorization, worker data, sign-in, hostname separation and API workflows. The combined run passed 75/76; the sole failure was a new test incorrectly expecting 200 for an anonymous session endpoint whose established contract is 401. Corrected that assertion and reran all 7 isolation tests successfully; backend code was unchanged after the combined run. Playwright against a temporary actual backend with an isolated database passed demo login, canonical site names, matching cards/list, filtering, safe network calls, blocked APIs/files and logout. No production check-ins or company records were changed. The full pytest command could not run because this Python environment has no pytest installed.

## Runtime and activation
Source is installed in C:/Users/User/NorthStar/northstar-local. The current running process has not reloaded it. A live read-only probe still returned 200 for anonymous operator-session.js (the new code returns 404). Windows previously denied stopping this process from the current session. The user has been asked to run Restart-NorthStar-Secure.ps1 from an Administrator PowerShell window. The script validates the scheduled task and backend process before restarting and verifies the new static boundary. Demo protection must not be represented as live until that succeeds. A browser refresh alone is insufficient.

## Recovery and source
Private original backend preimage is in private-preimages/demo-isolation; do not publish it. Compare current hashes before restoring because other tasks share this runtime. The workspace packet contains allowlisted source, regression test, browser harness, restart script and this report. Runtime has no Git metadata; commit and annotated tag are recorded in the workspace repository. There is no configured github remote or verified Drive upload destination, so no GitHub push or Drive upload was performed.

## Remaining work
Administrator backend restart, then verify production demo sign-in and direct company-data refusals. Existing browser history or files previously downloaded by an authorized operator cannot be retroactively removed by server access controls. No credentials or role configuration were changed.
