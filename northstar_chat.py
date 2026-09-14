"""Operator live chat: room messages with source tags and optional Teams bridge.

The overview chat box is operator-console only. Messages are stored in SQLite and
always carry an explicit source tag (``northstar``, ``teams``, or ``system``).

Teams integration is intentionally fail-closed:

1. **Nothing is invented.** With ``NORTHSTAR_TEAMS_MODE=off`` (default) or
   ``shadow``, the bridge records intent and status only. It never fabricates
   inbound Teams traffic.
2. **Live mode is opt-in.** ``NORTHSTAR_TEAMS_MODE=live`` plus a webhook /
   Graph-compatible pull URL is required before any external call.
3. **Operator surface only.** Chat routes belong in ``OPERATOR_ROUTES`` and must
   never join ``CHECKIN_PUBLIC_*``.
"""

from __future__ import annotations

import json
import os
import sqlite3
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator
from zoneinfo import ZoneInfo

import northstar_events as events
import northstar_store as store

TZ = ZoneInfo("America/Toronto")

ROOMS = (
    {"id": "general", "label": "General"},
    {"id": "operations", "label": "Operations"},
    {"id": "field", "label": "Field"},
    {"id": "contractors", "label": "Contractors"},
    {"id": "management", "label": "Management"},
)
ROOM_IDS = frozenset(room["id"] for room in ROOMS)
SOURCES = frozenset({"northstar", "teams", "system"})
MAX_BODY_CHARS = 4000

CHAT_SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_messages (
    message_id      TEXT PRIMARY KEY,
    room_id         TEXT NOT NULL,
    body            TEXT NOT NULL,
    source          TEXT NOT NULL,
    author          TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    teams_post_id   TEXT,
    teams_synced_at TEXT,
    meta_json       TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created
    ON chat_messages(room_id, created_at, message_id);
"""


class ChatError(ValueError):
    """Invalid chat request."""


def _now_iso() -> str:
    return datetime.now(TZ).isoformat()


def teams_mode() -> str:
    mode = os.environ.get("NORTHSTAR_TEAMS_MODE", "off").strip().lower() or "off"
    if mode not in {"off", "shadow", "live"}:
        return "off"
    return mode


def teams_webhook_url() -> str:
    return os.environ.get("NORTHSTAR_TEAMS_WEBHOOK_URL", "").strip()


def teams_pull_url() -> str:
    return os.environ.get("NORTHSTAR_TEAMS_PULL_URL", "").strip()


def init_schema(connection: Any) -> None:
    connection.executescript(CHAT_SCHEMA)


@contextmanager
def _session() -> Iterator[sqlite3.Connection]:
    with store._LOCK, store._session() as connection:
        yield connection


def status() -> dict[str, Any]:
    mode = teams_mode()
    return {
        "rooms": list(ROOMS),
        "sources": sorted(SOURCES),
        "teams": {
            "mode": mode,
            "webhookConfigured": bool(teams_webhook_url()),
            "pullConfigured": bool(teams_pull_url()),
            "canPost": mode == "live" and bool(teams_webhook_url()),
            "canPull": mode == "live" and bool(teams_pull_url()),
        },
    }


def list_rooms() -> list[dict[str, Any]]:
    return list(ROOMS)


def _row_to_message(row: sqlite3.Row) -> dict[str, Any]:
    meta: dict[str, Any]
    try:
        meta = json.loads(row["meta_json"] or "{}")
    except json.JSONDecodeError:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    return {
        "id": row["message_id"],
        "roomId": row["room_id"],
        "body": row["body"],
        "source": row["source"],
        "author": row["author"],
        "createdAt": row["created_at"],
        "teamsPostId": row["teams_post_id"],
        "teamsSyncedAt": row["teams_synced_at"],
        "meta": meta,
    }


def list_messages(
    room_id: str,
    *,
    limit: int = 100,
    since: str | None = None,
) -> list[dict[str, Any]]:
    if room_id not in ROOM_IDS:
        raise ChatError(f"unknown room: {room_id}")
    limit = max(1, min(int(limit), 500))
    with _session() as connection:
        if since:
            rows = connection.execute(
                "SELECT * FROM chat_messages"
                " WHERE room_id=? AND created_at > ?"
                " ORDER BY created_at ASC, message_id ASC LIMIT ?",
                (room_id, since, limit),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM chat_messages WHERE room_id=?"
                " ORDER BY created_at DESC, message_id DESC LIMIT ?",
                (room_id, limit),
            ).fetchall()
            rows = list(reversed(rows))
        return [_row_to_message(row) for row in rows]


def _normalize_body(body: Any) -> str:
    text = str(body or "").strip()
    if not text:
        raise ChatError("message body is required")
    if len(text) > MAX_BODY_CHARS:
        raise ChatError(f"message body exceeds {MAX_BODY_CHARS} characters")
    return text


def _insert_message(
    connection: sqlite3.Connection,
    *,
    room_id: str,
    body: str,
    source: str,
    author: str,
    teams_post_id: str | None = None,
    teams_synced_at: str | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if room_id not in ROOM_IDS:
        raise ChatError(f"unknown room: {room_id}")
    if source not in SOURCES:
        raise ChatError(f"unknown source: {source}")
    message_id = f"chat_{uuid.uuid4().hex}"
    created_at = _now_iso()
    meta_json = json.dumps(meta or {}, ensure_ascii=False, sort_keys=True)
    connection.execute(
        "INSERT INTO chat_messages"
        " (message_id, room_id, body, source, author, created_at,"
        "  teams_post_id, teams_synced_at, meta_json)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (
            message_id,
            room_id,
            body,
            source,
            author.strip() or "operator",
            created_at,
            teams_post_id,
            teams_synced_at,
            meta_json,
        ),
    )
    events.append_event(
        connection,
        event_type="chat.message.posted",
        occurred_at=created_at,
        actor_id=author.strip() or "operator",
        aggregate_type="chat_room",
        aggregate_id=room_id,
        correlation_id=message_id,
        source=source,
        summary=f"{room_id}: {body[:120]}",
        payload={
            "messageId": message_id,
            "roomId": room_id,
            "source": source,
            "author": author.strip() or "operator",
        },
    )
    row = connection.execute(
        "SELECT * FROM chat_messages WHERE message_id=?", (message_id,)
    ).fetchone()
    return _row_to_message(row)


def post_message(
    room_id: str,
    body: Any,
    *,
    author: str,
    post_to_teams: bool = False,
) -> dict[str, Any]:
    text = _normalize_body(body)
    teams_post_id = None
    teams_synced_at = None
    meta: dict[str, Any] = {}
    if post_to_teams:
        bridge = _post_to_teams(room_id, text, author=author)
        meta["teamsBridge"] = bridge
        if bridge.get("status") == "posted":
            teams_post_id = str(bridge.get("teamsPostId") or "")
            teams_synced_at = str(bridge.get("at") or _now_iso())
    with _session() as connection:
        return _insert_message(
            connection,
            room_id=room_id,
            body=text,
            source="northstar",
            author=author,
            teams_post_id=teams_post_id or None,
            teams_synced_at=teams_synced_at,
            meta=meta,
        )


def _post_to_teams(room_id: str, body: str, *, author: str) -> dict[str, Any]:
    mode = teams_mode()
    webhook = teams_webhook_url()
    at = _now_iso()
    if mode == "off":
        return {
            "status": "disabled",
            "at": at,
            "detail": "NORTHSTAR_TEAMS_MODE=off",
        }
    if mode == "shadow":
        return {
            "status": "shadow",
            "at": at,
            "detail": "Teams post recorded locally only; live bridge not enabled",
            "roomId": room_id,
            "author": author,
        }
    if not webhook:
        return {
            "status": "misconfigured",
            "at": at,
            "detail": "NORTHSTAR_TEAMS_WEBHOOK_URL is not set",
        }
    payload = {
        "text": f"[NorthStar · {room_id}] {author}: {body}",
        "roomId": room_id,
        "author": author,
        "source": "northstar",
    }
    request = urllib.request.Request(
        webhook,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return {
                "status": "posted",
                "at": at,
                "teamsPostId": f"teams_{uuid.uuid4().hex[:12]}",
                "httpStatus": getattr(response, "status", 200),
                "detail": raw[:200],
            }
    except urllib.error.HTTPError as exc:
        return {
            "status": "error",
            "at": at,
            "detail": f"Teams webhook HTTP {exc.code}",
        }
    except Exception as exc:  # noqa: BLE001 - bridge must never crash the console
        return {
            "status": "error",
            "at": at,
            "detail": f"{type(exc).__name__}: {exc}",
        }


def pull_teams_messages(*, actor: str = "system") -> dict[str, Any]:
    """Pull inbound Teams traffic into chat rooms when live mode is configured.

    Never invents messages. Off/shadow modes return status only.
    """
    mode = teams_mode()
    at = _now_iso()
    if mode == "off":
        return {"pulled": 0, "status": "disabled", "at": at, "messages": []}
    if mode == "shadow":
        return {
            "pulled": 0,
            "status": "shadow",
            "at": at,
            "detail": "Teams pull is shadow-only; no inbound messages invented",
            "messages": [],
        }
    pull_url = teams_pull_url()
    if not pull_url:
        return {
            "pulled": 0,
            "status": "misconfigured",
            "at": at,
            "detail": "NORTHSTAR_TEAMS_PULL_URL is not set",
            "messages": [],
        }
    request = urllib.request.Request(pull_url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        return {
            "pulled": 0,
            "status": "error",
            "at": at,
            "detail": f"{type(exc).__name__}: {exc}",
            "messages": [],
        }
    items = payload.get("messages") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        return {
            "pulled": 0,
            "status": "error",
            "at": at,
            "detail": "Teams pull payload must be a list or {messages: [...]}",
            "messages": [],
        }
    stored: list[dict[str, Any]] = []
    with _session() as connection:
        for item in items:
            if not isinstance(item, dict):
                continue
            room_id = str(item.get("roomId") or item.get("room") or "general").strip().lower()
            if room_id not in ROOM_IDS:
                room_id = "general"
            body = str(item.get("body") or item.get("text") or "").strip()
            if not body:
                continue
            author = str(item.get("author") or item.get("from") or "Teams").strip() or "Teams"
            external_id = str(item.get("id") or item.get("teamsPostId") or "").strip()
            if external_id:
                existing = connection.execute(
                    "SELECT 1 FROM chat_messages WHERE teams_post_id=?",
                    (external_id,),
                ).fetchone()
                if existing:
                    continue
            message = _insert_message(
                connection,
                room_id=room_id,
                body=body[:MAX_BODY_CHARS],
                source="teams",
                author=author,
                teams_post_id=external_id or None,
                teams_synced_at=at,
                meta={"pulledBy": actor, "inbound": True},
            )
            stored.append(message)
    return {
        "pulled": len(stored),
        "status": "ok",
        "at": at,
        "messages": stored,
    }
