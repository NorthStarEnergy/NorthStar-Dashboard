"""Unified, append-only event envelope for NorthStar operational history.

Domain tables remain the authoritative workflow histories during migration.
This module dual-writes a common envelope in the same SQLite transaction so
the dashboard can reconstruct one timeline without timestamp-joining several
incompatible table shapes.
"""

from __future__ import annotations

import json
import re
import uuid
from contextvars import ContextVar
from datetime import datetime
from typing import Any


SCHEMA_VERSION = 1
_CORRELATION_ID: ContextVar[str] = ContextVar("northstar_correlation_id", default="")
_SAFE_CORRELATION = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def new_id(prefix: str = "evt") -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def set_correlation_id(value: str | None = None) -> str:
    candidate = str(value or "").strip()
    correlation_id = candidate if _SAFE_CORRELATION.fullmatch(candidate) else new_id("corr")
    _CORRELATION_ID.set(correlation_id)
    return correlation_id


def current_correlation_id() -> str:
    return _CORRELATION_ID.get() or new_id("corr")


def event_type(domain: str, event: Any) -> str:
    slug = re.sub(r"[^a-z0-9]+", ".", str(event or "event").strip().lower()).strip(".")
    return f"{domain}.{slug or 'event'}"


def append_event(
    connection: Any,
    *,
    event_id: str | None = None,
    event_type: str,
    occurred_at: str,
    actor_id: str,
    aggregate_type: str,
    aggregate_id: str,
    source: str,
    summary: str,
    payload: dict[str, Any] | None = None,
    severity: str = "info",
    correlation_id: str | None = None,
    causation_id: str | None = None,
) -> str:
    """Append one normalized event using the caller's active transaction."""
    event_id = event_id or new_id()
    recorded_at = datetime.now().astimezone().isoformat()
    connection.execute(
        "INSERT INTO audit_events"
        " (event_id, event_type, schema_version, occurred_at, recorded_at, actor_id,"
        " aggregate_type, aggregate_id, correlation_id, causation_id, source, severity,"
        " summary, payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            event_id,
            str(event_type).strip() or "system.event",
            SCHEMA_VERSION,
            occurred_at,
            recorded_at,
            str(actor_id or "system").strip() or "system",
            str(aggregate_type or "system").strip() or "system",
            str(aggregate_id or "system").strip() or "system",
            correlation_id or current_correlation_id(),
            causation_id,
            str(source or "northstar").strip() or "northstar",
            str(severity or "info").strip().lower() or "info",
            str(summary or event_type).strip(),
            json.dumps(payload or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str),
        ),
    )
    return event_id


def record(row: Any) -> dict[str, Any]:
    try:
        payload = json.loads(row["payload"] or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        payload = {"unparsed": str(row["payload"] or "")}
    return {
        "eventId": row["event_id"],
        "eventType": row["event_type"],
        "schemaVersion": row["schema_version"],
        "occurredAt": row["occurred_at"],
        "recordedAt": row["recorded_at"],
        "actorId": row["actor_id"],
        "aggregateType": row["aggregate_type"],
        "aggregateId": row["aggregate_id"],
        "correlationId": row["correlation_id"],
        "causationId": row["causation_id"],
        "source": row["source"],
        "severity": row["severity"],
        "summary": row["summary"],
        "payload": payload,
    }
