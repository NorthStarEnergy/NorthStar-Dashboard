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


def _detail_text(record: dict[str, Any]) -> str:
    payload = record.get("payload") or {}
    if payload.get("details"):
        return str(payload["details"])
    parts = [
        payload.get("site"),
        payload.get("worker"),
        payload.get("node"),
    ]
    if payload.get("priorStatus") and payload.get("newStatus"):
        parts.append(f"{payload['priorStatus']} → {payload['newStatus']}")
    elif payload.get("priorState") and payload.get("newState"):
        parts.append(f"{payload['priorState']} → {payload['newState']}")
    if payload.get("price") is not None:
        parts.append(f"${float(payload['price']):.2f}")
    joined = " · ".join(str(part) for part in parts if part not in (None, ""))
    if joined:
        return joined
    return f"{record.get('aggregateType', 'record')} · {record.get('aggregateId', '')}"


def _contains_any(text: str, *terms: str) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in terms)


def classify_display(record: dict[str, Any]) -> dict[str, str]:
    """Map a normalized audit event to a control-room log presentation channel."""
    event_type = str(record.get("eventType") or "").lower()
    source = str(record.get("source") or "").lower()
    severity = str(record.get("severity") or "info").lower()
    summary = str(record.get("summary") or "")
    aggregate = str(record.get("aggregateType") or "").lower()
    payload = record.get("payload") or {}
    entry_type = str(payload.get("type") or "").lower()
    text = " ".join(
        part for part in (summary, _detail_text(record), event_type, source, entry_type) if part
    ).lower()

    channel = "operator"
    log_class = "OPERATIONAL"
    filter_group = "operator"

    if event_type.startswith("ai."):
        channel, log_class, filter_group = "ai", "OPERATIONAL", "system"
    elif event_type.startswith("voice.") or source == "voice" or aggregate == "voice_recording":
        channel, log_class, filter_group = "voice", "COMMUNICATION", "comms"
    elif event_type.startswith("switching.") or aggregate == "switching_draft":
        channel, log_class, filter_group = "engineering", "ENGINEERING", "engineering"
    elif event_type.startswith("outage.") or aggregate == "outage":
        channel, log_class, filter_group = "outage", "OPERATIONAL", "dispatch"
    elif event_type.startswith("market.") or aggregate == "price_alert" or "ieso update" in entry_type:
        if aggregate == "price_alert" or _contains_any(text, "alert", "alarm", "limit reached"):
            channel, log_class, filter_group = "alarm", "MARKET", "alarms"
        else:
            channel, log_class, filter_group = "market", "MARKET", "market"
    elif event_type.startswith("field_operations.") or aggregate.startswith("field_"):
        channel, log_class, filter_group = "field", "OPERATIONAL", "dispatch"
    elif (
        event_type.startswith("workforce.")
        or aggregate == "checkin"
        or "staff movement" in entry_type
    ) and _contains_any(text, "help", "distress", "overdue", "mayday", "provisional"):
        channel, log_class, filter_group = "safety", "SAFETY", "safety"
    elif severity in {"critical", "warn", "warning"} and _contains_any(
        text, "help", "alarm", "alert", "distress", "overdue"
    ):
        channel, log_class, filter_group = "alarm", "SAFETY", "alarms"
    elif "outlook" in entry_type or _contains_any(text, "outlook", "email", "e-mail"):
        channel, log_class, filter_group = "email", "COMMUNICATION", "comms"
    elif "teams" in entry_type or _contains_any(text, "teams message", "teams notice"):
        channel, log_class, filter_group = "teams", "COMMUNICATION", "comms"
    elif _contains_any(text, "phone", "voicemail", "call from", "called"):
        channel, log_class, filter_group = "phone", "COMMUNICATION", "comms"
    elif "scada" in entry_type or event_type.startswith("scada.") or source == "scada":
        channel, log_class, filter_group = "scada", "OPERATIONAL", "dispatch"
    elif _contains_any(
        text,
        " unit trip",
        "generator trip",
        "tripped",
        " trip ",
    ):
        channel, log_class, filter_group = "trip", "OPERATIONAL", "dispatch"
    elif _contains_any(text, "generator", "unit", "gen ") and _contains_any(
        text, "start", "started", "online", "synchron"
    ):
        channel, log_class, filter_group = "generator-start", "OPERATIONAL", "dispatch"
    elif _contains_any(text, "generator", "unit", "gen ") and _contains_any(
        text, "stop", "stopped", "shutdown", "offline"
    ):
        channel, log_class, filter_group = "generator-stop", "OPERATIONAL", "dispatch"
    elif _contains_any(text, "dispatch", "mw", "operating reserve", "commit"):
        channel, log_class, filter_group = "dispatch", "OPERATIONAL", "dispatch"
    elif severity in {"critical", "warn", "warning"} or _contains_any(text, "alarm", "alert"):
        channel, log_class, filter_group = "alarm", "SAFETY", "alarms"
    elif _contains_any(text, "retention", "backup", "health", "imported", "purge", "watchdog"):
        channel, log_class, filter_group = "system", "SYSTEM", "system"
    elif source == "logbook":
        channel, log_class, filter_group = "operator", "OPERATIONAL", "operator"

    severity_label = {
        "critical": "CRITICAL",
        "warn": "WARN",
        "warning": "WARN",
        "info": "INFO",
    }.get(severity, severity.upper() or "INFO")

    channel_labels = {
        "alarm": "ALARM",
        "market": "MARKET",
        "dispatch": "DISPATCH",
        "email": "EMAIL",
        "teams": "TEAMS",
        "phone": "PHONE",
        "voice": "VOICE",
        "safety": "SAFETY",
        "outage": "OUTAGE",
        "engineering": "ENGINEERING",
        "operator": "OPERATOR",
        "scada": "SCADA",
        "field": "FIELD OPS",
        "ai": "AI ASSIST",
        "system": "SYSTEM",
        "trip": "UNIT TRIP",
        "generator-start": "UNIT START",
        "generator-stop": "UNIT STOP",
    }

    return {
        "channel": channel,
        "channelLabel": channel_labels.get(channel, channel.upper()),
        "logClass": log_class,
        "filterGroup": filter_group,
        "severityLabel": severity_label,
        "detail": _detail_text(record),
    }


def present(row: Any) -> dict[str, Any]:
    """Return a normalized event with control-room display metadata attached."""
    normalized = record(row)
    normalized["display"] = classify_display(normalized)
    return normalized
