# Packet 28 — Overview live chat with Teams bridge

**Date:** 2026-09-03
**Tag:** `packet-28-overview-live-chat`

## What shipped

Operator live chat on the Overview page with fixed rooms:

- General
- Operations
- Field
- Contractors
- Management

(Operations was listed twice in the request; only one Operations room is present.)

Every message carries an explicit **source** tag: `northstar`, `teams`, or `system`.

### Backend

- `northstar_chat.py` — SQLite messages, room list, Teams bridge
- Operator-gated routes: `/api/chat/rooms`, `/api/chat/messages`, `/api/chat/status`, `/api/chat/teams/pull`
- Teams modes: `NORTHSTAR_TEAMS_MODE=off|shadow|live` (default **off**). Shadow records intent only and never invents inbound Teams traffic. Live needs `NORTHSTAR_TEAMS_WEBHOOK_URL` / `NORTHSTAR_TEAMS_PULL_URL`.

### UI

- Overview module `#overviewChat` (`data-module-id="overview-chat"`)
- `chat-workspace.js` / `chat-workspace.css`
- Poll refresh (~4s), optional “Also post to Teams”, “PULL TEAMS”

## Suite

`198 passed` (`python -m pytest tests -q`)
