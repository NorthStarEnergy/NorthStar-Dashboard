# Solo worker check-ins

## Request
Fix automatic heartbeat resets, add manual check-in, 55/60-minute reminders and operator emergency calling. Leave the phone destination dummy/unconfigured; defer GPS and shake controls.

## Changes
The legacy heartbeat endpoint records connectivity only and cannot clear overdue. A distinct explicit safety-checkin endpoint resets the server deadline and records a safety event. Worker and operator buttons use it. Worker reminders use server deadlines, catch up on resume and deduplicate across reloads. The due reminder uses stronger audio/vibration and a persistent notification where supported. Help is independent of the timer. CALL OPERATOR is disabled until a valid configured number exists, then opens the phone dialer while independently requesting help; no call connection is claimed.

## Verification
Final Python suite: 525 passed, 21 skipped, 347 passing subtests; four failures and eight errors match the prior baseline (missing foundation schema, missing legacy server source and two Research expectations). Focused safety/API/host/QR tests: 56 passed and 161 subtests passed. Fresh-database and migration checks pass. Browser checks passed for 55/60 notifications, failed/successful confirmation, resume/reload, dummy/configured phone handoff, help failures/persistence and checkout races. Twenty operator compatibility cases pass. No real workers, calls, or production records were used.

## Runtime
Source installed; activation blocked by Windows Access denied stopping PID 42156. Restarting the scheduled task left the same process running. The local and public read-only probes lack the upgraded protocol header. Run Activate-Solo-Checkins.ps1 in administrator PowerShell. The new worker app sends no automatic confirmations and disables manual safety confirmation until the upgraded protocol is returned. Existing cached apps require the upgraded backend to stop their old heartbeat requests from extending deadlines. Explicit operator actions try the new route first and fall back on 404 only, keeping them usable before restart.

## Recovery
Private originals are in the task workspace under private-preimages/20261027-solo-worker-checkins. Restore only this packet under a fresh coordination lock after checking for later changes. Python modules and worker/operator endpoint changes must move together. Keep operational databases and history; the additive last_device_seen column may remain on rollback.

## Delivery
Source cd240f3876bf8ecdba1603b2fcdde4308cb4c1fa; tag packet-20261027-solo-worker-checkins. [Source-only Drive archive verified](https://drive.google.com/file/d/1uR9fR9NGhdZytL-YqwTQtZSFGasyVI7y/view?usp=drivesdk). Runtime and archived source hashes match. No GitHub remote is configured; the existing Sites remote is not a GitHub publication destination.

## Limits
Web reminders require the page to execute; locked-phone notification delivery and native background operation are not implemented. The server overdue monitor continues independently. Calling is deliberately unconfigured and remains a phone-dialer handoff, not an automatic telephony service. GPS/shake controls and existing ADR-015 identity limitations remain outside this release.
