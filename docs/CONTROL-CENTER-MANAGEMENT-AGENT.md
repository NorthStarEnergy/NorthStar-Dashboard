# Management Agent Contract

The management agent is a separate service from `ieso_backend.py`. It runs on the machine it controls and accepts requests only from the Control Center API over authenticated HTTPS.

## Required operations

`GET /v1/status` returns service state, version, uptime, database readiness, and supported capabilities.

`POST /v1/actions/{launch|restart|stop|backup|update|rollback}` requires:

- an authenticated operator identity;
- an idempotency key;
- a reason and confirmation record;
- an allowed action for the operator role.

The agent must return an operation ID immediately for long-running actions. `GET /v1/operations/{id}` returns queued, running, succeeded, failed, or rolled-back state.

## Update safety

An update must verify the release signature, create a backup, stage the release, restart the service, check health plus an authenticated protected route, and roll back automatically if verification fails.

## Network boundary

The agent must not be directly exposed to the public internet. The Control Center API is the only caller. The existing dashboard API must never forward arbitrary process, shell, or update commands.
