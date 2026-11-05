# Packet 22 Acceptance Evidence

**Run time:** 2026-08-13 02:25–02:27 America/New_York  
**Browser:** Codex In-app Browser, authenticated session on `https://ops.northstarenergy.ca/`  
**Local validation:** `python -m pytest tests -q` → **87 passed**

## Acceptance results

| Item | Result | Evidence |
|---|---|---|
| Operator hostname protection | PASS | Unauthenticated `GET https://ops.northstarenergy.ca/` returned Cloudflare Access `302` challenge. |
| Login asks for supplied username/password | NOT VERIFIED | Access challenge was verified from a clean HTTP request, but credentials were not supplied in this packet and no private/incognito login was submitted. |
| Overview loads | PASS in authenticated browser session | Overview rendered market data, Field Tracker, Field Staff Status, and Weather sections. |
| Weather cards and full forecast | PASS | Weather tab rendered 8 station cards; Full Forecast opened and rendered detailed forecast cards. |
| Field Tracker | PASS | Operator view rendered 6 active records, GPS count, help count, overdue count, and location records; no HTTP 403/unavailable/endless connecting state. |
| Field Staff Status | PASS | Operator view rendered 6 active staff records with sites, workers, and statuses. |
| Major module navigation and return to Overview | PASS | Weather opened, then Overview returned successfully. |
| Temporary worker test check-in | NOT VERIFIED | No approved worker token/QR was supplied; no live record was created. Existing local integration coverage remains green. |
| Close/check out temporary record | NOT VERIFIED | Depends on the preceding live test record. |
| Logout and re-authentication | NOT VERIFIED | The rendered operator dashboard did not expose a logout control; direct unauthenticated HTTP access is Access-challenged. |
| Session expiry | NOT VERIFIED | No documented expiry trigger or owner-controlled Access session was available for a safe forced-expiry test. |
| Direct public-host operator-route rejection | PASS | `GET /api/checkins` with forged `Cf-Access-Jwt-Assertion` → `403`; forged `POST /api/checkins/does-not-exist/help/resolve` → `403`. |
| Worker host does not expose operator dashboard | PASS | `GET https://checkin.northstarenergy.ca/northstar-clean.html` → `404`. |
| Rollback | NOT NEEDED | No code or deployment changes were made; acceptance-only validation completed. |

## Boss handoff

- URL: `https://ops.northstarenergy.ca/`
- Username: owner-supplied demo username, proposed as `ron`
- Password: supply separately; do not place it in this evidence file or Drive
- Use a normal or private browser window; do not use `localhost:4180`.

## Release decision

**Conditional / do not release yet.** The deployed protection and dashboard read/navigation surfaces passed. The live worker check-in lifecycle, logout, and expiry items remain owner-controlled checks because the packet did not include the approved worker token/QR or a usable owner credential/session for those actions.

## Recovery classification

No failure requiring rollback was observed. If a live rerun fails: inspect Access hostname routing/backend for login-page failures; inspect session cookie and operator gate for 401/403 module failures; restore worker route configuration without disabling the operator gate; and treat any operator data returned on `checkin.` as a release blocker.
