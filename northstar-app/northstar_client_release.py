"""Track the dashboard release applied by an operator client.

The server owns the audit record.  A browser can ask for release status, but it
cannot manufacture a client-update event or choose the version written to the
append-only ledger.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import date, datetime, timezone
from typing import Any

import northstar_events as events
import northstar_store as store
from northstar_paths import app_root


ROOT = app_root(__file__)
BUILD_VERSION_PATH = ROOT / "BUILD-VERSION.txt"
VERSION_PATTERN = re.compile(r"^v\d+\.\d+$")


def _value(name: str, default: str, limit: int = 120) -> str:
    value = str(os.environ.get(name, default)).strip()
    return re.sub(r"[^A-Za-z0-9._:-]+", "-", value)[:limit].strip("-") or default


def dashboard_release() -> dict[str, str]:
    """Read the small, release-controlled dashboard manifest from disk."""
    try:
        version, published, summary, *_ = BUILD_VERSION_PATH.read_text(
            encoding="utf-8"
        ).splitlines()
    except (OSError, ValueError) as exc:
        raise ValueError("dashboard release metadata is unavailable") from exc
    version, published, summary = version.strip(), published.strip(), " ".join(summary.split())
    if not VERSION_PATTERN.fullmatch(version) or not summary or len(summary) > 160:
        raise ValueError("dashboard release metadata is invalid")
    try:
        published = date.fromisoformat(published).isoformat()
    except ValueError as exc:
        raise ValueError("dashboard release metadata is invalid") from exc
    return {"version": version, "published": published, "summary": summary}


def client_identity() -> dict[str, str]:
    """Return the package identity supplied by Electron or a web dashboard."""
    return {
        "kind": _value("NORTHSTAR_CLIENT_KIND", "dashboard"),
        "packageVersion": _value("NORTHSTAR_CLIENT_PACKAGE_VERSION", "web"),
        "sourceStamp": _value("NORTHSTAR_CLIENT_SOURCE_STAMP", "source"),
    }


def current_release() -> dict[str, Any]:
    dashboard = dashboard_release()
    client = client_identity()
    release_key = json.dumps(
        {"dashboard": dashboard["version"], "client": client}, sort_keys=True, separators=(",", ":")
    )
    return {
        "dashboard": dashboard,
        "client": client,
        "releaseId": "client-release-" + hashlib.sha256(release_key.encode("utf-8")).hexdigest()[:24],
    }


def observe_current_release() -> dict[str, Any]:
    """Append one durable update event for this client/build combination."""
    release = current_release()
    event_id = release["releaseId"]
    with store._LOCK, store._session() as connection:
        existing = connection.execute(
            "SELECT event_id FROM audit_events WHERE event_id=?", (event_id,)
        ).fetchone()
        if existing:
            return {**release, "recorded": False}
        client = release["client"]
        dashboard = release["dashboard"]
        events.append_event(
            connection,
            event_id=event_id,
            event_type="system.client_update.applied",
            occurred_at=datetime.now(timezone.utc).isoformat(),
            actor_id="NorthStar desktop update service",
            aggregate_type="system",
            aggregate_id="dashboard-client",
            source="system",
            summary=f"CLIENT UPDATED · {dashboard['version']}",
            payload={
                "recordKind": "client_release",
                "dashboard": dashboard,
                "client": client,
                "status": "applied",
            },
        )
    return {**release, "recorded": True}
