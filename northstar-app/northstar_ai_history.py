"""Durable, account-scoped workspace records for the NorthStar AI surface."""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator
from zoneinfo import ZoneInfo

import northstar_store as store

TZ = ZoneInfo("America/Toronto")
MAX_TITLE_CHARS = 56
MAX_PROJECT_CHARS = 80

AI_HISTORY_SCHEMA = """
CREATE TABLE IF NOT EXISTS ai_projects (
    project_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_id, name)
);
CREATE INDEX IF NOT EXISTS idx_ai_projects_owner ON ai_projects(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_conversations (
    conversation_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    project_id TEXT REFERENCES ai_projects(project_id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'general',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_owner ON ai_conversations(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_project ON ai_conversations(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
    message_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES ai_conversations(conversation_id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id, created_at ASC);
CREATE TABLE IF NOT EXISTS ai_conversation_settings (
    conversation_id TEXT PRIMARY KEY REFERENCES ai_conversations(conversation_id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_message_feedback (
    message_id TEXT PRIMARY KEY REFERENCES ai_messages(message_id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES ai_conversations(conversation_id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    rating TEXT NOT NULL CHECK (rating IN ('helpful','incorrect','missing_source','stale_source','unsafe')),
    correction TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_owner ON ai_message_feedback(owner_id, updated_at DESC);
"""


class AIHistoryError(ValueError):
    """Invalid or inaccessible AI workspace request."""


def init_schema(connection: Any) -> None:
    connection.executescript(AI_HISTORY_SCHEMA)
    columns = {row[1] for row in connection.execute("PRAGMA table_info(ai_conversations)").fetchall()}
    if "archived" not in columns:
        connection.execute("ALTER TABLE ai_conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")


@contextmanager
def _session() -> Iterator[sqlite3.Connection]:
    with store._LOCK, store._session() as connection:
        yield connection


def _now_iso() -> str:
    return datetime.now(TZ).isoformat()


def _owner(value: Any) -> str:
    owner = str(value or "").strip()[:160]
    if not owner:
        raise AIHistoryError("authenticated account is required")
    return owner


def _title(value: Any, fallback: str = "New chat") -> str:
    title = " ".join(str(value or "").split()).strip()
    title = re.split(r"(?<=[.!?])\s+", title, maxsplit=1)[0]
    title = title.rstrip(".")[:MAX_TITLE_CHARS].rstrip()
    return title or fallback


def _project_name(value: Any) -> str:
    name = " ".join(str(value or "").split()).strip()[:MAX_PROJECT_CHARS]
    if not name:
        raise AIHistoryError("project name is required")
    return name


def _summary_title(value: Any) -> str:
    """Produce a short topic label locally, without a second paid AI request."""
    topic = " ".join(str(value or "").split()).strip()
    topic = re.split(r"(?<=[.!?])\s+", topic, maxsplit=1)[0]
    topic = re.sub(r"^(?:(?:please|can you|could you|would you)\s+)+", "", topic, flags=re.I)
    topic = re.sub(r"^(?:check|search|look through)\s+(?:the\s+)?(.+?)\s+for\s+(?:info(?:rmation)?\s+)?(?:about|on)\s+", r"\1: ", topic, flags=re.I)
    topic = re.sub(r"^(?:give me|show me|tell me)\s+(?:a\s+)?(?:summary|overview|list)\s+of\s+", "", topic, flags=re.I)
    topic = re.sub(r"^(?:summari[sz]e|list|explain|describe|find)\s+(?:(?:all|the|available)\s+)*", "", topic, flags=re.I)
    topic = re.sub(r"\bstarting and stopping units\b", "unit start/stop", topic, flags=re.I)
    words = topic.rstrip(".!?").split()
    title = " ".join(words[:8])
    while len(title) > MAX_TITLE_CHARS and " " in title:
        title = title.rsplit(" ", 1)[0]
    title = re.sub(r"\s+(?:and|or|with|for|of|the|a|to|in|about)$", "", title, flags=re.I)
    return (title[:1].upper() + title[1:])[:MAX_TITLE_CHARS] or "New chat"


def _project(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["project_id"],
        "name": row["name"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _conversation(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["conversation_id"],
        "projectId": row["project_id"],
        "title": row["title"],
        "scope": row["scope"],
        "archived": bool(row["archived"]) if "archived" in row.keys() else False,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "preview": row["preview"] if "preview" in row.keys() else "",
    }


def _message(row: sqlite3.Row) -> dict[str, Any]:
    try:
        metadata = json.loads(row["metadata_json"] or "{}")
    except json.JSONDecodeError:
        metadata = {}
    return {
        "id": row["message_id"],
        "role": row["role"],
        "content": row["content"],
        "metadata": metadata if isinstance(metadata, dict) else {},
        "createdAt": row["created_at"],
    }


def list_workspace(owner_id: Any, *, limit: int = 100) -> dict[str, Any]:
    owner = _owner(owner_id)
    limit = max(1, min(int(limit), 250))
    with _session() as connection:
        # Upgrade only titles that still match the old automatic prompt prefix.
        # Keep custom titles, message content and conversation ordering intact.
        legacy = connection.execute(
            "SELECT c.conversation_id,c.title,(SELECT content FROM ai_messages m "
            "WHERE m.conversation_id=c.conversation_id AND m.owner_id=c.owner_id "
            "AND m.role='user' ORDER BY m.created_at ASC LIMIT 1) AS first_prompt "
            "FROM ai_conversations c WHERE c.owner_id=?", (owner,),
        ).fetchall()
        for row in legacy:
            first_sentence = re.split(r"(?<=[.!?])\s+", " ".join((row["first_prompt"] or "").split()), maxsplit=1)[0].rstrip(".")
            old_titles = {_title(row["first_prompt"]), first_sentence[:96].rstrip(), first_sentence}
            if row["first_prompt"] and row["title"] in old_titles:
                connection.execute(
                    "UPDATE ai_conversations SET title=? WHERE conversation_id=? AND owner_id=?",
                    (_summary_title(row["first_prompt"]), row["conversation_id"], owner),
                )
        projects = connection.execute(
            "SELECT * FROM ai_projects WHERE owner_id=? ORDER BY updated_at DESC, name ASC",
            (owner,),
        ).fetchall()
        conversations = connection.execute(
            "SELECT c.*, COALESCE((SELECT content FROM ai_messages m "
            "WHERE m.conversation_id=c.conversation_id ORDER BY m.created_at DESC LIMIT 1), '') AS preview "
            "FROM ai_conversations c WHERE c.owner_id=? ORDER BY c.updated_at DESC LIMIT ?",
            (owner, limit),
        ).fetchall()
    return {
        "account": owner,
        "projects": [_project(row) for row in projects],
        "conversations": [_conversation(row) for row in conversations],
    }


def create_project(owner_id: Any, name: Any) -> dict[str, Any]:
    owner, project_name, timestamp = _owner(owner_id), _project_name(name), _now_iso()
    project_id = f"aip_{uuid.uuid4().hex}"
    with _session() as connection:
        try:
            connection.execute(
                "INSERT INTO ai_projects(project_id,owner_id,name,created_at,updated_at) VALUES(?,?,?,?,?)",
                (project_id, owner, project_name, timestamp, timestamp),
            )
        except sqlite3.IntegrityError as exc:
            raise AIHistoryError("a project with that name already exists") from exc
        row = connection.execute("SELECT * FROM ai_projects WHERE project_id=?", (project_id,)).fetchone()
    return _project(row)


def create_conversation(
    owner_id: Any,
    *,
    title: Any = "New chat",
    project_id: Any = None,
    scope: Any = "general",
) -> dict[str, Any]:
    owner, timestamp = _owner(owner_id), _now_iso()
    project = str(project_id or "").strip() or None
    scope_value = str(scope or "general").strip().lower()[:40] or "general"
    conversation_id = f"aic_{uuid.uuid4().hex}"
    with _session() as connection:
        if project:
            row = connection.execute(
                "SELECT project_id FROM ai_projects WHERE project_id=? AND owner_id=?",
                (project, owner),
            ).fetchone()
            if not row:
                raise AIHistoryError("project not found")
        connection.execute(
            "INSERT INTO ai_conversations(conversation_id,owner_id,project_id,title,scope,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (conversation_id, owner, project, _title(title), scope_value, timestamp, timestamp),
        )
        row = connection.execute(
            "SELECT c.*, '' AS preview FROM ai_conversations c WHERE conversation_id=?",
            (conversation_id,),
        ).fetchone()
    return _conversation(row)


def get_conversation(owner_id: Any, conversation_id: Any) -> dict[str, Any]:
    owner, identity = _owner(owner_id), str(conversation_id or "").strip()
    with _session() as connection:
        row = connection.execute(
            "SELECT c.*, '' AS preview FROM ai_conversations c WHERE conversation_id=? AND owner_id=?",
            (identity, owner),
        ).fetchone()
        if not row:
            raise AIHistoryError("conversation not found")
        messages = connection.execute(
            "SELECT * FROM ai_messages WHERE conversation_id=? AND owner_id=? ORDER BY created_at ASC, message_id ASC",
            (identity, owner),
        ).fetchall()
        settings = connection.execute(
            "SELECT model,reasoning_effort FROM ai_conversation_settings WHERE conversation_id=? AND owner_id=?",
            (identity, owner),
        ).fetchone()
    return {
        **_conversation(row),
        "settings": (
            {"model": settings["model"], "reasoningEffort": settings["reasoning_effort"]}
            if settings else {}
        ),
        "messages": [_message(item) for item in messages],
    }


def relevant_history(owner_id: Any, conversation_id: Any, question: str) -> list[dict[str, str]]:
    """Keep recent turns and a few older, relevant turns within the same account chat."""
    owner, identity = _owner(owner_id), str(conversation_id or "").strip()
    with _session() as connection:
        found = connection.execute(
            "SELECT 1 FROM ai_conversations WHERE conversation_id=? AND owner_id=?",
            (identity, owner),
        ).fetchone()
        if not found:
            raise AIHistoryError("conversation not found")
        rows = connection.execute(
            "SELECT role,content FROM ai_messages WHERE conversation_id=? AND owner_id=? "
            "AND role IN ('user','assistant') ORDER BY created_at DESC,message_id DESC LIMIT 250",
            (identity, owner),
        ).fetchall()
    messages = [dict(row) for row in reversed(rows)]
    recent_start = max(0, len(messages) - 12)
    terms = {term for term in re.findall(r"[a-z0-9]{4,}", question.lower())
             if term not in {"what", "when", "where", "which", "that", "this", "about", "from", "with", "have", "there"}}
    older = []
    for index, item in enumerate(messages[:recent_start]):
        if item["role"] != "user":
            continue
        score = sum(term in item["content"].lower() for term in terms)
        if score:
            older.append((score, index))
    selected = set()
    for _, index in sorted(older, key=lambda value: (-value[0], -value[1]))[:4]:
        selected.add(index)
        if index + 1 < recent_start and messages[index + 1]["role"] == "assistant":
            selected.add(index + 1)
    return [
        {"role": item["role"], "content": item["content"][:1200 if index in selected else 2400]}
        for index, item in enumerate(messages)
        if index in selected or index >= recent_start
    ]


def set_conversation_settings(
    owner_id: Any,
    conversation_id: Any,
    *,
    model: Any,
    reasoning_effort: Any,
) -> dict[str, str]:
    owner, identity = _owner(owner_id), str(conversation_id or "").strip()
    selected_model = str(model or "").strip()
    selected_effort = str(reasoning_effort or "").strip().lower()
    if not selected_model or not selected_effort:
        raise AIHistoryError("model and reasoning depth are required")
    timestamp = _now_iso()
    with _session() as connection:
        if not connection.execute(
            "SELECT 1 FROM ai_conversations WHERE conversation_id=? AND owner_id=?",
            (identity, owner),
        ).fetchone():
            raise AIHistoryError("conversation not found")
        connection.execute(
            "INSERT INTO ai_conversation_settings(conversation_id,owner_id,model,reasoning_effort,updated_at) "
            "VALUES(?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET "
            "owner_id=excluded.owner_id,model=excluded.model,reasoning_effort=excluded.reasoning_effort,updated_at=excluded.updated_at",
            (identity, owner, selected_model, selected_effort, timestamp),
        )
    return {"model": selected_model, "reasoningEffort": selected_effort}


def append_message(
    owner_id: Any,
    conversation_id: Any,
    role: str,
    content: Any,
    *,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    owner, identity = _owner(owner_id), str(conversation_id or "").strip()
    role_value, text, timestamp = str(role or "").strip().lower(), str(content or "").strip(), _now_iso()
    if role_value not in {"user", "assistant", "system"}:
        raise AIHistoryError("invalid message role")
    if not text:
        raise AIHistoryError("message content is required")
    message_id = f"aim_{uuid.uuid4().hex}"
    with _session() as connection:
        row = connection.execute(
            "SELECT title FROM ai_conversations WHERE conversation_id=? AND owner_id=?",
            (identity, owner),
        ).fetchone()
        if not row:
            raise AIHistoryError("conversation not found")
        title = _summary_title(text) if role_value == "user" and row["title"] == "New chat" else row["title"]
        connection.execute(
            "INSERT INTO ai_messages(message_id,conversation_id,owner_id,role,content,metadata_json,created_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (message_id, identity, owner, role_value, text, json.dumps(metadata or {}, ensure_ascii=False), timestamp),
        )
        connection.execute(
            "UPDATE ai_conversations SET title=?,updated_at=? WHERE conversation_id=? AND owner_id=?",
            (title, timestamp, identity, owner),
        )
        row = connection.execute("SELECT * FROM ai_messages WHERE message_id=?", (message_id,)).fetchone()
    return _message(row)


def set_message_feedback(
    owner_id: Any,
    message_id: Any,
    *,
    rating: Any,
    correction: Any = "",
) -> dict[str, Any]:
    owner = _owner(owner_id)
    identity = str(message_id or "").strip()
    rating_value = str(rating or "").strip().lower()
    allowed = {"helpful", "incorrect", "missing_source", "stale_source", "unsafe"}
    if rating_value not in allowed:
        raise AIHistoryError("choose a valid feedback rating")
    correction_value = str(correction or "").strip()[:2000]
    timestamp = _now_iso()
    with _session() as connection:
        message = connection.execute(
            "SELECT message_id,conversation_id FROM ai_messages "
            "WHERE message_id=? AND owner_id=? AND role='assistant'",
            (identity, owner),
        ).fetchone()
        if not message:
            raise AIHistoryError("assistant message not found")
        connection.execute(
            "INSERT INTO ai_message_feedback(message_id,conversation_id,owner_id,rating,correction,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET "
            "rating=excluded.rating,correction=excluded.correction,updated_at=excluded.updated_at",
            (identity, message["conversation_id"], owner, rating_value, correction_value, timestamp, timestamp),
        )
    return {
        "messageId": identity,
        "conversationId": message["conversation_id"],
        "rating": rating_value,
        "correction": correction_value,
        "updatedAt": timestamp,
    }


def assign_project(owner_id: Any, conversation_id: Any, project_id: Any) -> dict[str, Any]:
    owner, identity, project = _owner(owner_id), str(conversation_id or "").strip(), str(project_id or "").strip() or None
    timestamp = _now_iso()
    with _session() as connection:
        if project and not connection.execute(
            "SELECT 1 FROM ai_projects WHERE project_id=? AND owner_id=?", (project, owner)
        ).fetchone():
            raise AIHistoryError("project not found")
        updated = connection.execute(
            "UPDATE ai_conversations SET project_id=?,updated_at=? WHERE conversation_id=? AND owner_id=?",
            (project, timestamp, identity, owner),
        ).rowcount
        if not updated:
            raise AIHistoryError("conversation not found")
        row = connection.execute(
            "SELECT c.*, '' AS preview FROM ai_conversations c WHERE conversation_id=?", (identity,)
        ).fetchone()
    return _conversation(row)


def set_conversation_archived(owner_id: Any, conversation_id: Any, archived: Any) -> dict[str, Any]:
    owner, identity = _owner(owner_id), str(conversation_id or "").strip()
    archived_value = archived if isinstance(archived, bool) else str(archived or "").strip().lower() in {"1", "true", "yes", "on"}
    with _session() as connection:
        updated = connection.execute(
            "UPDATE ai_conversations SET archived=? WHERE conversation_id=? AND owner_id=?",
            (int(archived_value), identity, owner),
        ).rowcount
        if not updated:
            raise AIHistoryError("conversation not found")
        row = connection.execute(
            "SELECT c.*, '' AS preview FROM ai_conversations c WHERE conversation_id=? AND owner_id=?",
            (identity, owner),
        ).fetchone()
    return _conversation(row)
