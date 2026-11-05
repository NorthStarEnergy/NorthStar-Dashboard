"""One authenticated NorthStar avatar preference, shared by dashboard and chat."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import northstar_store as store
from northstar_paths import app_root

DEFAULT_AVATAR = "classic-00"
CATALOG = json.loads((app_root(__file__) / "assets/avatars/classic/catalog.json").read_text(encoding="utf-8"))
AVATAR_IDS = frozenset(item["id"] for item in CATALOG)


def init_schema(connection: Any) -> None:
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS northstar_avatar_profiles (
            actor TEXT PRIMARY KEY,
            avatar_id TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    """)


def avatar(avatar_id: Any) -> dict[str, str]:
    key = avatar_id if isinstance(avatar_id, str) and avatar_id in AVATAR_IDS else DEFAULT_AVATAR
    return {"avatarId": key, "avatarUrl": f"/assets/avatars/classic/{key}.png"}


def profile_in(connection: Any, actor: str) -> dict[str, Any]:
    row = connection.execute("SELECT avatar_id, updated_at FROM northstar_avatar_profiles WHERE actor=?", (actor,)).fetchone()
    return {"actor": actor, **avatar(row["avatar_id"] if row else None), "updatedAt": row["updated_at"] if row else None}


def get_profile(actor: str) -> dict[str, Any]:
    with store._LOCK, store._session() as connection:
        return profile_in(connection, actor)


def save_profile(actor: str, avatar_id: Any) -> dict[str, Any]:
    if not isinstance(avatar_id, str) or avatar_id not in AVATAR_IDS:
        raise ValueError("Choose an avatar from the NorthStar classic set.")
    with store._LOCK, store._session() as connection:
        connection.execute(
            "INSERT INTO northstar_avatar_profiles (actor, avatar_id, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(actor) DO UPDATE SET avatar_id=excluded.avatar_id, updated_at=excluded.updated_at",
            (actor, avatar_id, datetime.now(timezone.utc).isoformat()),
        )
        return profile_in(connection, actor)
