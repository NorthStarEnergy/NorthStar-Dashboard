# NorthStar Control Center API v1

All web, desktop, and mobile clients use the Control Center API. Dashboard data routes remain separate from management routes.

## Status

`GET /api/control-center/status`

Requires the normal operator authentication gate. The response identifies the target, API version, health snapshot, available capabilities, and whether the management agent is installed.

The browser client is available at `/control-center.html`. It is installable as a mobile PWA and excludes destructive controls when the management agent reports `not-installed`.

## Management contract

The following routes are reserved for the authenticated management agent and are not enabled by the dashboard server:

- `POST /api/control-center/{target}/launch`
- `POST /api/control-center/{target}/restart`
- `POST /api/control-center/{target}/stop`
- `POST /api/control-center/{target}/backup`
- `POST /api/control-center/{target}/update`
- `POST /api/control-center/{target}/rollback`
- `GET /api/control-center/{target}/logs`

`target` is `local` or `production`. Production mutations require elevated role authorization, explicit confirmation, an idempotency key, and an audit event. Update and rollback responses must include the release ID, backup ID, previous version, resulting version, and verification result.

## Client rules

- Never expose provider credentials or management tokens to the browser UI.
- Mobile defaults to status and read-only actions.
- Desktop may use a local IPC bridge for local process controls, but uses the API for shared status and production actions.
- Web, desktop, and mobile must render unavailable capabilities as disabled rather than guessing.
