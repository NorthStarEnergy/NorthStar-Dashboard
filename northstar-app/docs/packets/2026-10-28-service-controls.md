# NorthStar service controls

Open Tools → Service controls in either dashboard shell, or `/service-controls.html` for the full page. The page embeds the existing provider configuration pages without replacing their validation or schedules.

## Controls

Sixteen service groups cover every existing backend background loop and the on-demand external API groups: inflow, market/price alerts, IESO advisories, worker overdue/backup/retention, SCADA, legacy public flows, durable water collection, daily report preparation, dispatch simulation, voice, console tasks, weather API, water-elevation API, IESO reports/history API, AI and chat.

Background services have start/stop and check intervals. Inflow separately exposes the weather/LWCB interval. Weather exposes its cache lifetime. Provider settings retain their own enable switches, intervals, lookbacks, stations and daily-report timing. A master service must be enabled before its provider schedule can run. The page describes these distinctions.

Stops are cooperative: new iterations and applicable manual collection requests are blocked; work already executing may finish. Starting resumes work on its normal scheduling rules. An enabled badge does not assert provider health or the presence of credentials. Controls are saved across backend restarts, use version checking to reject concurrent stale writes, and record actor/change audit entries in private data storage.

The overdue service has a prominent warning and explicit UI confirmation before stopping because it also runs daily backups and coordinate retention. The backend, authentication, database and tunnel remain running so the control page is reachable. Operating-system services, credentials and the separate Codex automation are not controlled by this HTTP interface. No arbitrary shell execution or process-kill API is exposed.

## Initial state

Inflow processing is stopped, including its separately launched worker guard. The Codex daily inflow-monitor automation is paused. Other service enable states and existing provider schedules are preserved. Saved forecasts and all operational records remain intact. The inflow page explicitly identifies the pause.

## Storage and recovery

`data/.northstar-services.json` stores versioned master settings; its sibling `.audit.jsonl` records changes. Inflow changes also update the worker's private `data/.northstar-inflow.json`. Files are protected by the existing private-data routing boundary. The API requires an authenticated operator, rejects the public worker host, follows existing cross-origin write checks, and is unavailable to restricted platform-demo sessions.

Source preimages are in the workspace's `private-preimages/20261028-service-controls`. Restore only the packet's changed files after checking for later edits, and restart the existing backend task if reverting Python changes. Do not restore operational databases or forecasts. To keep the requested inflow pause during rollback, retain `enabled: false` and the worker guard.

## Verification

Tests exercise persistent start/stop, interval validation, unknown settings, optimistic concurrency, inflow config synchronization, cooperative wait/resume, manual collection blocking and audit attribution. HTTP tests exercise authenticated access, unauthenticated/public-host denial and cross-origin write rejection. Browser tests use an isolated local fixture and verify stop, interval save, persistence after reload, restart and filtering; production services are not toggled as test fixtures.

Activation succeeded on October 28, 2026. Production health is healthy; unauthenticated operator API returns 401 and public-host API returns 403. Inflow is stopped in both master and worker configuration. Full suite: 538 passed, 21 skipped, 347 passing subtests; four failures and eight errors match the existing baseline (foundation schema, legacy server source and Research expectations). Thirteen focused tests pass. The live browser is at sign-in; authenticated production UI verification requires the user session.
