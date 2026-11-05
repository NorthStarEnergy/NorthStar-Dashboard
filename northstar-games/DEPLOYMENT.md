# NorthStar Games deployment

- Public address: https://games.northstarenergy.ca/
- Version: 0.6.5
- Origin: http://127.0.0.1:4185, Waitress 3.0.2, Python 3.13.14.
- Runtime project: `C:\Users\Ryan1\Documents\Codex\2026-09-28\referenced-chatgpt-conversation-this-is-an-2\outputs\poker-study`.
- Windows task: `NorthStar Games Web`, runs `pythonw.exe -m poker_study.web --port 4185` with that project as working directory. Starts at current-user sign-in, no execution time limit, up to three failure restarts at one-minute intervals.
- Existing Cloudflare tunnel: `northstar`, remotely managed. Added a published application route for `games.northstarenergy.ca` to `http://127.0.0.1:4185`. Cloudflare created the games CNAME automatically.
- Existing ops/checkin routes and the apex domain were not modified. Dashboard source and services were not changed.

## Operation

This host computer must stay online, awake and signed in. The Cloudflare tunnel Windows service must be running. User sessions are in memory and expire after two hours of inactivity; a restart clears sessions. Sessions are isolated by unguessable HttpOnly cookies, SameSite Strict, Secure on the public hostname. No uploaded files are written to disk. Only explicit UI files are served; the project folder is not a public file server.

Check origin: `Invoke-RestMethod http://127.0.0.1:4185/api/health`.

Check task: `Get-ScheduledTask -TaskName 'NorthStar Games Web'`.

Restart after Python changes (ends current hands):

```powershell
Stop-ScheduledTask -TaskName 'NorthStar Games Web'
Start-ScheduledTask -TaskName 'NorthStar Games Web'
```

Static CSS/JS/HTML changes are served directly; reload the browser. Do not restart the NorthStar dashboard or tunnel to update this app. Do not move the project without updating the scheduled task's working directory.

## Verification

- 90 unit/API/behavior tests passed for v0.6.5.
- JavaScript syntax check passed.
- Scheduled origin is running and its health endpoint reports version 0.3.0.
- Public HTTPS browser: initial page, deal, flop, turn, river, showdown and correct displayed payout verified. Equity calculator and all 169 range buttons verified. No captured browser console warnings/errors.
- Replay reconstruction and strategy round trips passed API tests. Automated browser replay-file upload was blocked by Chrome extension file-URL access; this browser step remains unverified.
- No mobile-device verification or load testing was performed.
- During initial DNS propagation the Windows shell resolver did not resolve the new hostname; the Chrome HTTPS browser successfully reached and played the public site. DNS caches may differ temporarily.

## Rollback

Stop and disable only the `NorthStar Games Web` task. Remove only the `games.northstarenergy.ca` published application route from the `northstar` tunnel and its games DNS record if retiring the service. Leave ops/checkin routes, authentication policies, the tunnel itself and other NorthStar services unchanged.

## Scope

Play-money study only. Bundled preflop ranges are illustrative, missing strategy spots use selective heuristic opponents, and the CFR example solves Kuhn poker only. No full six-max GTO solution is claimed. This is a basic single-host deployment, not a high-availability service.

Routing reference: [Cloudflare published application routes](https://developers.cloudflare.com/tunnel/concepts/routing/).

Version 0.3.0 adds bot_policy.py mixed ranges, personalities.py, five local SVG portraits, clickable player profiles, named action history, and personality behavior tests. No domain or Cloudflare routing changes are required.


### v0.4.0 cash-table update
Career saves now live in private `data/careers.sqlite3`; preserve this directory across releases and do not publish it in downloads. The public route whitelist does not expose database files. Cookie is retained for one year; active memory sessions still expire after two hours, then career state is restored from disk. Reinstalling/clearing cookies does not migrate a character. Source release excludes the data directory.

### v0.6.5 bot tables and player profiles
Three six-seat bot tables run with two reserve bots. Five roster copies have independent standings. The saved two-table league migrates without clearing its completed hands. Tables exchange players after each completes another 300 hands. A broke bot returns with a full 100 BB stack, and its profile counts the rebuy. Clicking a ranking opens a public performance chart, paginated recorded hand histories, and the ten largest recorded pots. Histories before this version were not stored and cannot be reconstructed. The release ZIP excludes the private database.
