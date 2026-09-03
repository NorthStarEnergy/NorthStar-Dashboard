"""Persistent check-in store for Northstar field-staff safety.

Check-ins and their status changes survive a backend restart. Operational
records are never overwritten or deleted: a checkout marks the record closed
and every change appends a row to ``checkin_events``.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import northstar_events as events

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("NORTHSTAR_DB", ROOT / "data" / "northstar.db"))
BACKUP_DIR = DB_PATH.parent / "backups"
BACKUP_KEEP = 14
# One file per day, refreshed on this interval so a crash loses at most an
# hour rather than everything since the backend started.
BACKUP_REFRESH_SECONDS = int(os.environ.get("NORTHSTAR_BACKUP_REFRESH", "3600"))
# Optional second copy of each daily backup on other storage (another disk,
# a synced folder). A mirror failure never blocks the primary backup.
BACKUP_MIRROR = os.environ.get("NORTHSTAR_BACKUP_MIRROR", "").strip() or None
TZ = ZoneInfo("America/Toronto")

# A worker who is alone must be heard from every hour; a crew has a longer
# grace period. Both are overridable per check-in.
OVERDUE_MINUTES_ALONE = int(os.environ.get("NORTHSTAR_OVERDUE_ALONE", "60"))
OVERDUE_MINUTES_CREW = int(os.environ.get("NORTHSTAR_OVERDUE_CREW", "240"))

STATUS_ON_SITE = "on-site"
STATUS_OVERDUE = "overdue"
STATUS_PROVISIONAL = "provisional"
STATUS_CHECKED_OUT = "checked-out"
OPEN_STATUSES = (STATUS_ON_SITE, STATUS_OVERDUE, STATUS_PROVISIONAL)

ALERT_ACTIVE = "active"
ALERT_ACKNOWLEDGED = "acknowledged"
ALERT_RESOLVED = "resolved"
ALERT_OPEN_STATES = (ALERT_ACTIVE, ALERT_ACKNOWLEDGED)

SWITCHING_DRAFT = "DRAFT"
SWITCHING_READY = "READY FOR QUALIFIED REVIEW"
SWITCHING_REVIEWED = "REVIEW RECORDED · NOT RELEASE"
SWITCHING_REVIEW_CHECKS = (
    "identity",
    "source",
    "field",
    "isolation",
    "protection",
    "communications",
    "changes",
    "release",
)

FIELD_REPORT_STATES = (
    "DRAFT", "SUBMITTED", "ACKNOWLEDGED", "ASSIGNED", "IN PROGRESS",
    "RESOLVED", "VERIFIED", "CLOSED",
)
ACTION_ITEM_STATES = ("OPEN", "ASSIGNED", "IN PROGRESS", "RESOLVED", "VERIFIED", "CLOSED")


class SwitchingConflict(ValueError):
    """Raised when an operator submits an older copy of a switching draft."""


class SchematicConflict(ValueError):
    """Raised when an operator submits an older copy of a one-line record."""

# A price sitting exactly on a threshold would otherwise raise and resolve on
# every refresh. An alert only clears once the price is back inside the band by
# this margin, so a hovering price produces one alarm, not a stream of them.
ALERT_RECOVERY_MARGIN = float(os.environ.get("NORTHSTAR_ALERT_RECOVERY_MARGIN", "2.0"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS checkins (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    site                  TEXT NOT NULL,
    kind                  TEXT NOT NULL,
    company               TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL,
    alone                 INTEGER NOT NULL DEFAULT 0,
    checked_in            TEXT NOT NULL,
    last_heard            TEXT NOT NULL,
    checked_out_at        TEXT,
    overdue_after_minutes INTEGER NOT NULL,
    expected_minutes      INTEGER,
    notes                 TEXT NOT NULL DEFAULT '',
    latitude              REAL,
    longitude             REAL,
    help_state            TEXT NOT NULL DEFAULT 'none',
    help_requested_at     TEXT,
    help_acknowledged_at  TEXT,
    help_acknowledged_by  TEXT,
    help_resolved_at      TEXT,
    help_resolved_by      TEXT
);

CREATE TABLE IF NOT EXISTS checkin_events (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    checkin_id   TEXT NOT NULL,
    at           TEXT NOT NULL,
    actor        TEXT NOT NULL,
    event        TEXT NOT NULL,
    site         TEXT NOT NULL,
    worker       TEXT NOT NULL,
    prior_status TEXT,
    new_status   TEXT,
    prior_help_state TEXT,
    new_help_state   TEXT,
    details      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_checkins_status ON checkins(status);
CREATE INDEX IF NOT EXISTS idx_events_checkin ON checkin_events(checkin_id, seq);

CREATE TABLE IF NOT EXISTS logbook (
    id         TEXT PRIMARY KEY,
    at         TEXT NOT NULL,
    type       TEXT NOT NULL,
    subject    TEXT NOT NULL,
    details    TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT 'operator',
    -- Tamper evidence: each row hashes its predecessor's digest with its own
    -- stored fields, so an edit or deletion breaks every digest after it.
    -- Databases created before 2026-08-14 gain these by migration instead.
    prev_hash  TEXT,
    entry_hash TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
    seq            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id       TEXT NOT NULL UNIQUE,
    event_type     TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    occurred_at    TEXT NOT NULL,
    recorded_at    TEXT NOT NULL,
    actor_id       TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id   TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    causation_id   TEXT,
    source          TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'info',
    summary         TEXT NOT NULL DEFAULT '',
    payload         TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id TEXT PRIMARY KEY,
    applied_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred
    ON audit_events(occurred_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_aggregate
    ON audit_events(aggregate_type, aggregate_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_correlation
    ON audit_events(correlation_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_type
    ON audit_events(event_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS outages (
    id        TEXT PRIMARY KEY,
    title     TEXT NOT NULL,
    asset     TEXT NOT NULL DEFAULT '',
    site      TEXT NOT NULL,
    severity  TEXT NOT NULL,
    outage_type TEXT NOT NULL DEFAULT 'Unplanned',
    details   TEXT NOT NULL DEFAULT '',
    status    TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    opened_by TEXT NOT NULL DEFAULT 'operator',
    closed_at TEXT,
    closed_by TEXT
);

CREATE TABLE IF NOT EXISTS outage_events (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    outage_id    TEXT NOT NULL,
    at           TEXT NOT NULL,
    actor        TEXT NOT NULL,
    event        TEXT NOT NULL,
    site         TEXT NOT NULL,
    prior_status TEXT,
    new_status   TEXT,
    details      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS alert_settings (
    node       TEXT PRIMARY KEY,
    low        REAL,
    high       REAL,
    actions    TEXT NOT NULL DEFAULT '[]',
    enabled    INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id              TEXT PRIMARY KEY,
    node            TEXT NOT NULL,
    kind            TEXT NOT NULL,
    threshold       REAL NOT NULL,
    state           TEXT NOT NULL,
    opened_at       TEXT NOT NULL,
    opening_price   REAL NOT NULL,
    last_price      REAL NOT NULL,
    last_seen       TEXT NOT NULL,
    peak_price      REAL NOT NULL,
    acknowledged_at TEXT,
    acknowledged_by TEXT,
    resolved_at     TEXT,
    resolved_price  REAL,
    actions         TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS alert_events (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id    TEXT NOT NULL,
    at          TEXT NOT NULL,
    actor       TEXT NOT NULL,
    event       TEXT NOT NULL,
    node        TEXT NOT NULL,
    prior_state TEXT,
    new_state   TEXT,
    price       REAL,
    details     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_alerts_state ON alerts(state, node);
CREATE INDEX IF NOT EXISTS idx_alert_events_alert ON alert_events(alert_id, seq);
CREATE INDEX IF NOT EXISTS idx_outage_events_outage ON outage_events(outage_id, seq);

CREATE TABLE IF NOT EXISTS switching_drafts (
    id              TEXT PRIMARY KEY,
    package_name    TEXT NOT NULL DEFAULT '',
    site            TEXT NOT NULL DEFAULT '',
    asset           TEXT NOT NULL DEFAULT '',
    outage_id       TEXT NOT NULL DEFAULT '',
    schematic_id    TEXT NOT NULL DEFAULT '',
    diagram_revision TEXT NOT NULL DEFAULT '',
    rule_set        TEXT NOT NULL DEFAULT '',
    work_scope      TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL,
    record_version  INTEGER NOT NULL DEFAULT 1,
    payload         TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL DEFAULT '',
    reviewer_name   TEXT NOT NULL DEFAULT '',
    reviewer_role   TEXT NOT NULL DEFAULT '',
    review_comments TEXT NOT NULL DEFAULT '',
    reviewed_at     TEXT,
    reviewed_by     TEXT
);

CREATE TABLE IF NOT EXISTS switching_draft_events (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id     TEXT NOT NULL,
    at           TEXT NOT NULL,
    actor        TEXT NOT NULL,
    event        TEXT NOT NULL,
    prior_status TEXT,
    new_status   TEXT,
    details      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_switching_drafts_status ON switching_drafts(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_switching_draft_events_draft ON switching_draft_events(draft_id, seq);

CREATE TABLE IF NOT EXISTS switching_attachments (
    id           TEXT PRIMARY KEY,
    draft_id     TEXT NOT NULL REFERENCES switching_drafts(id),
    kind         TEXT NOT NULL CHECK (kind IN ('diagram', 'source')),
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL,
    sha256       TEXT NOT NULL,
    content      BLOB NOT NULL,
    uploaded_at  TEXT NOT NULL,
    uploaded_by  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_switching_attachment_dedup
    ON switching_attachments(draft_id, kind, filename, sha256);
CREATE INDEX IF NOT EXISTS idx_switching_attachments_draft
    ON switching_attachments(draft_id, kind, uploaded_at);

CREATE TABLE IF NOT EXISTS one_line_documents (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    outage_id             TEXT NOT NULL DEFAULT '',
    standard_approval_ref TEXT NOT NULL DEFAULT '',
    current_revision      INTEGER NOT NULL,
    current_payload       TEXT NOT NULL,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    created_by            TEXT NOT NULL,
    updated_by            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS one_line_revisions (
    document_id TEXT NOT NULL REFERENCES one_line_documents(id),
    revision    INTEGER NOT NULL,
    payload     TEXT NOT NULL,
    sha256      TEXT NOT NULL,
    at          TEXT NOT NULL,
    actor       TEXT NOT NULL,
    PRIMARY KEY (document_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_one_line_documents_updated
    ON one_line_documents(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_one_line_documents_outage
    ON one_line_documents(outage_id, updated_at);

-- Packet 16 test fixture metadata. These tables intentionally contain no source bytes.
-- retention_days = NULL means indefinite for this non-production test dataset.
CREATE TABLE IF NOT EXISTS repository_policies (
    repository_id       TEXT PRIMARY KEY,
    repository_name     TEXT NOT NULL,
    policy_id           TEXT NOT NULL,
    policy_revision     TEXT NOT NULL CHECK (length(trim(policy_revision)) > 0),
    retention_days      INTEGER,
    access_roles        TEXT NOT NULL DEFAULT '[]',
    versioning_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (versioning_enabled IN (0, 1)),
    immutable_records   INTEGER NOT NULL DEFAULT 1 CHECK (immutable_records IN (0, 1)),
    legal_hold_supported INTEGER NOT NULL DEFAULT 1 CHECK (legal_hold_supported IN (0, 1)),
    backup_policy       TEXT NOT NULL DEFAULT '',
    deletion_policy     TEXT NOT NULL DEFAULT '',
    data_owner          TEXT NOT NULL,
    environment         TEXT NOT NULL DEFAULT 'TEST_ONLY',
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_repository_refs (
    artifact_class     TEXT PRIMARY KEY,
    repository_id      TEXT NOT NULL REFERENCES repository_policies(repository_id),
    object_prefix      TEXT NOT NULL,
    object_revision    TEXT NOT NULL,
    owner              TEXT NOT NULL,
    access_rule        TEXT NOT NULL,
    retention_rule     TEXT NOT NULL,
    source_bytes_stored INTEGER NOT NULL DEFAULT 0 CHECK (source_bytes_stored = 0),
    environment        TEXT NOT NULL DEFAULT 'TEST_ONLY'
);

CREATE INDEX IF NOT EXISTS idx_artifact_repository_refs_repository
    ON artifact_repository_refs(repository_id);

CREATE TABLE IF NOT EXISTS field_reports (
    id TEXT PRIMARY KEY,
    station TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    priority TEXT NOT NULL,
    title TEXT NOT NULL,
    conditions TEXT NOT NULL,
    immediate_actions TEXT NOT NULL DEFAULT '',
    outstanding_work TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    assigned_to TEXT NOT NULL DEFAULT '',
    outage_id TEXT NOT NULL DEFAULT '',
    record_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_report_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id TEXT NOT NULL REFERENCES field_reports(id),
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    event TEXT NOT NULL,
    prior_status TEXT,
    new_status TEXT,
    details TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS field_report_attachments (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL REFERENCES field_reports(id),
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    content BLOB NOT NULL,
    uploaded_at TEXT NOT NULL,
    uploaded_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_items (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL DEFAULT '',
    station TEXT NOT NULL,
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    assigned_to TEXT NOT NULL DEFAULT '',
    due_at TEXT,
    record_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_item_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id TEXT NOT NULL REFERENCES action_items(id),
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    event TEXT NOT NULL,
    prior_status TEXT,
    new_status TEXT,
    details TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_field_reports_status ON field_reports(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_reports_station ON field_reports(station, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_report_events_report ON field_report_events(report_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_field_report_attachments_report ON field_report_attachments(report_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_items_report ON action_items(report_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_item_events_action ON action_item_events(action_id, seq DESC);

CREATE TABLE IF NOT EXISTS controlled_sources (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    title TEXT NOT NULL,
    revision TEXT NOT NULL,
    document_owner TEXT NOT NULL DEFAULT '',
    effective_at TEXT,
    reference_uri TEXT NOT NULL DEFAULT '',
    sha256 TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PROPOSED',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_registry (
    id TEXT PRIMARY KEY,
    station TEXT NOT NULL,
    designation TEXT NOT NULL,
    asset_type TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    topology_revision TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    UNIQUE(station, designation)
);

CREATE TABLE IF NOT EXISTS governance_decisions (
    id TEXT PRIMARY KEY,
    decision_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'OPEN',
    decision TEXT NOT NULL DEFAULT '',
    evidence_ref TEXT NOT NULL DEFAULT '',
    review_due_at TEXT,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_controlled_sources_type ON controlled_sources(source_type,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_registry_station ON asset_registry(station,designation);
CREATE INDEX IF NOT EXISTS idx_governance_decisions_status ON governance_decisions(status,updated_at DESC);
"""

_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(TZ).isoformat()


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


@contextmanager
def _session() -> Iterator[sqlite3.Connection]:
    """One transaction: commits on success, rolls back on error, always closes.

    ``with sqlite3.connect(...) as connection`` commits but does not close, so
    using it directly leaks a handle per call — one per HTTP request here.
    """
    connection = _connect()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK, _session() as connection:
        connection.executescript(SCHEMA)
        _migrate_schema(connection)
        from northstar_phase1 import init_schema as init_phase1_schema

        init_phase1_schema(connection)
        from northstar_voice import init_schema as init_voice_schema

        init_voice_schema(connection)
        from northstar_chat import init_schema as init_chat_schema

        init_chat_schema(connection)
        _migrate_unified_events(connection)
        _seed_readiness_registry(connection)
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_checkins_help_state"
            " ON checkins(help_state) WHERE help_state IN ('requested','acknowledged')"
        )
        connection.execute("PRAGMA optimize")


def _seed_readiness_registry(connection: sqlite3.Connection) -> None:
    timestamp = now_iso()
    defaults = (
        ("procedure_owner", "Authoritative UWPC/EUSR procedure owner"),
        ("authority_matrix", "Draft, review, approve, issue, execute and close authority matrix"),
        ("electronic_signature", "Electronic acknowledgement and signature acceptance"),
        ("identity_provider", "Production per-person identity provider and role claims"),
        ("device_credentials", "Revocable field-device credential and recovery policy"),
        ("tag_templates", "Approved tag types, fields, formats and reprint rules"),
        ("notification_channel", "Approved notification channel and escalation rules"),
        ("pilot_station", "Controlled pilot station and operating group"),
    )
    for key, title in defaults:
        connection.execute(
            "INSERT OR IGNORE INTO governance_decisions"
            " (id,decision_key,title,status,updated_at,updated_by) VALUES (?,?,?,?,?,?)",
            (f"decision-{key}", key, title, "OPEN", timestamp, "system seed"),
        )


def _migrate_unified_events(connection: sqlite3.Connection) -> None:
    """Backfill the common timeline once, without altering legacy histories."""
    migration_id = "2026-08-27-unified-event-backbone-v1"
    if connection.execute(
        "SELECT 1 FROM schema_migrations WHERE migration_id=?", (migration_id,)
    ).fetchone():
        return

    for row in connection.execute("SELECT * FROM logbook ORDER BY rowid").fetchall():
        events.append_event(
            connection,
            event_id=f"legacy_logbook_{row['id']}",
            event_type="operations.logbook.entry_added",
            occurred_at=row["at"],
            actor_id=row["source"],
            aggregate_type="logbook",
            aggregate_id=row["id"],
            correlation_id=f"legacy:logbook:{row['id']}",
            source="logbook",
            summary=row["subject"],
            payload={"type": row["type"], "details": row["details"], "legacyEntryHash": row["entry_hash"]},
        )

    for row in connection.execute("SELECT * FROM checkin_events ORDER BY seq").fetchall():
        events.append_event(
            connection,
            event_id=f"legacy_checkin_{row['seq']}",
            event_type=events.event_type("workforce", row["event"]),
            occurred_at=row["at"],
            actor_id=row["actor"],
            aggregate_type="checkin",
            aggregate_id=row["checkin_id"],
            correlation_id=f"legacy:checkin:{row['seq']}",
            source="workforce",
            severity="critical" if "help requested" in row["event"].lower() else "info",
            summary=f"{row['worker']}: {row['event']}",
            payload={
                "site": row["site"], "worker": row["worker"],
                "priorStatus": row["prior_status"], "newStatus": row["new_status"],
                "priorHelpState": row["prior_help_state"], "newHelpState": row["new_help_state"],
                "details": row["details"],
            },
        )

    for table, aggregate_type, domain, id_column, detail_column in (
        ("outage_events", "outage", "outage", "outage_id", "details"),
        ("alert_events", "price_alert", "market", "alert_id", "details"),
        ("switching_draft_events", "switching_draft", "switching", "draft_id", "details"),
        ("voice_events", "voice_recording", "voice", "recording_id", "detail"),
    ):
        rows = connection.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
        for row in rows:
            legacy_key = row["seq"] if "seq" in row.keys() else row["event_id"]
            event_name = row["event"]
            actor = row["actor"]
            aggregate_id = row[id_column]
            payload = {"details": row[detail_column]}
            for key in ("site", "node", "prior_status", "new_status", "prior_state", "new_state", "price"):
                if key in row.keys():
                    payload[key] = row[key]
            events.append_event(
                connection,
                event_id=f"legacy_{table}_{legacy_key}",
                event_type=events.event_type(domain, event_name),
                occurred_at=row["at"],
                actor_id=actor,
                aggregate_type=aggregate_type,
                aggregate_id=aggregate_id,
                correlation_id=f"legacy:{table}:{legacy_key}",
                source=domain,
                severity="warning" if any(term in event_name.lower() for term in ("open", "raised", "review")) else "info",
                summary=event_name,
                payload=payload,
            )

    connection.execute(
        "INSERT INTO schema_migrations (migration_id, applied_at) VALUES (?,?)",
        (migration_id, now_iso()),
    )


def _migrate_schema(connection: sqlite3.Connection) -> None:
    """Add fields introduced after the first pilot database was deployed."""
    checkin_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(checkins)").fetchall()
    }
    checkin_additions = {
        "help_state": "TEXT NOT NULL DEFAULT 'none'",
        "help_requested_at": "TEXT",
        "help_acknowledged_at": "TEXT",
        "help_acknowledged_by": "TEXT",
        "help_resolved_at": "TEXT",
        "help_resolved_by": "TEXT",
    }
    for name, definition in checkin_additions.items():
        if name not in checkin_columns:
            connection.execute(f"ALTER TABLE checkins ADD COLUMN {name} {definition}")

    event_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(checkin_events)").fetchall()
    }
    for name in ("prior_help_state", "new_help_state"):
        if name not in event_columns:
            connection.execute(f"ALTER TABLE checkin_events ADD COLUMN {name} TEXT")

    outage_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(outages)").fetchall()
    }
    for name, definition in {
        "asset": "TEXT NOT NULL DEFAULT ''",
        "outage_type": "TEXT NOT NULL DEFAULT 'Unplanned'",
        "opened_by": "TEXT NOT NULL DEFAULT 'operator'",
        "closed_by": "TEXT",
    }.items():
        if name not in outage_columns:
            connection.execute(f"ALTER TABLE outages ADD COLUMN {name} {definition}")

    switching_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(switching_drafts)").fetchall()
    }
    if "record_version" not in switching_columns:
        connection.execute(
            "ALTER TABLE switching_drafts ADD COLUMN record_version INTEGER NOT NULL DEFAULT 1"
        )
    for name, definition in {
        "outage_id": "TEXT NOT NULL DEFAULT ''",
        "schematic_id": "TEXT NOT NULL DEFAULT ''",
    }.items():
        if name not in switching_columns:
            connection.execute(
                f"ALTER TABLE switching_drafts ADD COLUMN {name} {definition}"
            )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_switching_drafts_outage"
        " ON switching_drafts(outage_id, updated_at)"
    )

    logbook_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(logbook)").fetchall()
    }
    chain_added = False
    for name in ("prev_hash", "entry_hash"):
        if name not in logbook_columns:
            connection.execute(f"ALTER TABLE logbook ADD COLUMN {name} TEXT")
            chain_added = True
    if chain_added:
        _rebuild_logbook_chain(connection)

    field_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(field_reports)").fetchall()
    }
    for name, definition in {
        "impact": "TEXT NOT NULL DEFAULT ''",
        "clarification_request": "TEXT NOT NULL DEFAULT ''",
        "escalated_at": "TEXT",
        "escalated_by": "TEXT",
    }.items():
        if name not in field_columns:
            connection.execute(f"ALTER TABLE field_reports ADD COLUMN {name} {definition}")

    action_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(action_items)").fetchall()
    }
    for name, definition in {
        "closure_criteria": "TEXT NOT NULL DEFAULT ''",
        "resolution_evidence": "TEXT NOT NULL DEFAULT ''",
        "verified_by": "TEXT NOT NULL DEFAULT ''",
        "verified_at": "TEXT",
        "escalated_at": "TEXT",
        "escalated_by": "TEXT",
    }.items():
        if name not in action_columns:
            connection.execute(f"ALTER TABLE action_items ADD COLUMN {name} {definition}")
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations (migration_id, applied_at) VALUES (?,?)",
        ("2026-08-27-field-operations-accountability-v2", now_iso()),
    )


def _logbook_hash(
    prev_hash: str, record_id: str, at: str, entry_type: str, subject: str, details: str, source: str
) -> str:
    """Hash one logbook row over its predecessor, making the log tamper-evident.

    The unit separator cannot appear in any of these fields, so no combination of
    field values can be rearranged to produce the same digest as a different row.
    """
    payload = "\x1f".join(
        (prev_hash or "", record_id, at, entry_type, subject, details, source)
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _rebuild_logbook_chain(connection: sqlite3.Connection) -> int:
    """Compute the chain across every existing row, in insertion order.

    Run once when the columns are introduced. This establishes a baseline; it
    does NOT prove anything about rows written before that point, because it
    hashes whatever is in the table now. Integrity is only demonstrable from the
    first entry appended after this runs. Said plainly so nobody later reads a
    complete chain as proof the pilot data was never touched.
    """
    rows = connection.execute(
        "SELECT rowid, id, at, type, subject, details, source FROM logbook ORDER BY rowid"
    ).fetchall()
    previous = ""
    for row in rows:
        digest = _logbook_hash(
            previous, row["id"], row["at"], row["type"], row["subject"], row["details"], row["source"]
        )
        connection.execute(
            "UPDATE logbook SET prev_hash = ?, entry_hash = ? WHERE rowid = ?",
            (previous, digest, row["rowid"]),
        )
        previous = digest
    return len(rows)


def verify_logbook_chain() -> dict[str, Any]:
    """Recompute the chain and report the first row that does not match.

    A break means the row's stored fields are not what were hashed when it was
    written: the entry was edited, deleted, or inserted out of band. Returns the
    offending id rather than raising, so an operator can be shown where the
    record stops being trustworthy.
    """
    with _LOCK, _session() as connection:
        rows = connection.execute(
            "SELECT rowid, id, at, type, subject, details, source, prev_hash, entry_hash"
            " FROM logbook ORDER BY rowid"
        ).fetchall()
    previous = ""
    for index, row in enumerate(rows):
        expected = _logbook_hash(
            previous, row["id"], row["at"], row["type"], row["subject"], row["details"], row["source"]
        )
        if row["prev_hash"] != previous or row["entry_hash"] != expected:
            return {
                "ok": False,
                "checked": index,
                "entries": len(rows),
                "brokenAt": row["id"],
                "brokenTimestamp": row["at"],
            }
        previous = row["entry_hash"]
    return {"ok": True, "checked": len(rows), "entries": len(rows), "brokenAt": None}


def daily_backup(reference: datetime | None = None) -> Path | None:
    """Refresh today's copy of the database at ``backups/northstar-YYYY-MM-DD.db``.

    One file per day, rewritten every ``BACKUP_REFRESH_SECONDS`` so a crash
    loses at most that interval rather than everything recorded since the
    backend started. Uses the sqlite backup API, which copies an in-use WAL
    database consistently. Keeps the newest ``BACKUP_KEEP`` days. Returns the
    path when this call wrote a copy, or None when the current one is still
    fresh or there is no database yet.
    """
    if not DB_PATH.exists():
        return None
    reference = reference or datetime.now(TZ)
    target = BACKUP_DIR / f"northstar-{reference.date().isoformat()}.db"
    if target.exists():
        age = reference.timestamp() - target.stat().st_mtime
        if age < BACKUP_REFRESH_SECONDS:
            return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    # Write beside the target and swap, so an interrupted copy cannot leave a
    # truncated file where a good backup used to be.
    staging = target.with_suffix(".db.partial")
    with _LOCK:
        source = sqlite3.connect(DB_PATH, timeout=10)
        try:
            staging.unlink(missing_ok=True)
            destination = sqlite3.connect(staging)
            try:
                source.backup(destination)
            finally:
                destination.close()
        finally:
            source.close()
    staging.replace(target)
    for stale in sorted(BACKUP_DIR.glob("northstar-*.db"))[:-BACKUP_KEEP]:
        stale.unlink()
    if BACKUP_MIRROR:
        try:
            mirror_dir = Path(BACKUP_MIRROR)
            mirror_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, mirror_dir / target.name)
            for stale in sorted(mirror_dir.glob("northstar-*.db"))[:-BACKUP_KEEP]:
                stale.unlink()
        except OSError as exc:
            print(f"backup mirror to {BACKUP_MIRROR} failed: {exc}")
    return target


def _row_to_record(row: sqlite3.Row, reference: datetime | None = None) -> dict[str, Any]:
    reference = reference or datetime.now(TZ)
    last_heard = datetime.fromisoformat(row["last_heard"])
    return {
        "id": row["id"],
        "name": row["name"],
        "site": row["site"],
        "kind": row["kind"],
        "company": row["company"],
        "status": row["status"],
        "alone": bool(row["alone"]),
        "checkedIn": row["checked_in"],
        "lastHeard": row["last_heard"],
        "checkedOutAt": row["checked_out_at"],
        "overdueAfterMinutes": row["overdue_after_minutes"],
        "expectedMinutes": row["expected_minutes"],
        "notes": row["notes"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "helpState": row["help_state"],
        "needsHelp": row["help_state"] in ("requested", "acknowledged"),
        "helpRequestedAt": row["help_requested_at"],
        "helpAcknowledgedAt": row["help_acknowledged_at"],
        "helpAcknowledgedBy": row["help_acknowledged_by"],
        "helpResolvedAt": row["help_resolved_at"],
        "helpResolvedBy": row["help_resolved_by"],
        "overdue": row["status"] == STATUS_OVERDUE,
        "minutesSinceHeard": int((reference - last_heard).total_seconds() // 60),
    }


def _append_event(
    connection: sqlite3.Connection,
    *,
    checkin_id: str,
    actor: str,
    event: str,
    site: str,
    worker: str,
    prior_status: str | None,
    new_status: str | None,
    prior_help_state: str | None = None,
    new_help_state: str | None = None,
    details: str = "",
    at: str | None = None,
) -> None:
    timestamp = at or now_iso()
    stored_details = details[:2000]
    connection.execute(
        "INSERT INTO checkin_events"
        " (checkin_id, at, actor, event, site, worker, prior_status, new_status,"
        " prior_help_state, new_help_state, details) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            checkin_id,
            timestamp,
            actor,
            event,
            site,
            worker,
            prior_status,
            new_status,
            prior_help_state,
            new_help_state,
            stored_details,
        ),
    )
    severity = "critical" if "help requested" in event.lower() else (
        "warning" if "overdue" in event.lower() else "info"
    )
    events.append_event(
        connection,
        event_type=events.event_type("workforce", event),
        occurred_at=timestamp,
        actor_id=actor,
        aggregate_type="checkin",
        aggregate_id=checkin_id,
        source="workforce",
        severity=severity,
        summary=f"{worker}: {event}",
        payload={
            "site": site,
            "worker": worker,
            "priorStatus": prior_status,
            "newStatus": new_status,
            "priorHelpState": prior_help_state,
            "newHelpState": new_help_state,
            "details": stored_details,
        },
    )


def create_checkin(payload: dict[str, Any], actor: str = "check-in") -> dict[str, Any]:
    """Insert a check-in. Raises ValueError when name or site is missing."""
    name = str(payload.get("name", "")).strip()[:80]
    site = str(payload.get("site", "")).strip()[:60]
    if not name or not site:
        raise ValueError("name and site are required")

    alone = bool(payload.get("alone"))
    timestamp = now_iso()
    overdue_after = payload.get("overdueAfterMinutes")
    try:
        overdue_after = int(overdue_after)
    except (TypeError, ValueError):
        overdue_after = OVERDUE_MINUTES_ALONE if alone else OVERDUE_MINUTES_CREW
    overdue_after = max(5, min(overdue_after, 24 * 60))

    expected = payload.get("expectedMinutes")
    try:
        expected = max(0, min(int(expected), 24 * 60))
    except (TypeError, ValueError):
        expected = None

    status = STATUS_PROVISIONAL if payload.get("provisional") else STATUS_ON_SITE
    record_id = f"checkin-{int(datetime.now(TZ).timestamp() * 1000)}"

    with _LOCK, _session() as connection:
        # Millisecond ids can collide when two workers submit together.
        while connection.execute("SELECT 1 FROM checkins WHERE id=?", (record_id,)).fetchone():
            record_id += "x"
        connection.execute(
            "INSERT INTO checkins (id, name, site, kind, company, status, alone, checked_in,"
            " last_heard, overdue_after_minutes, expected_minutes, notes, latitude, longitude)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                record_id,
                name,
                site,
                str(payload.get("kind", "Northstar")).strip()[:30] or "Northstar",
                str(payload.get("company", "")).strip()[:80],
                status,
                int(alone),
                timestamp,
                timestamp,
                overdue_after,
                expected,
                str(payload.get("notes", "")).strip()[:500],
                payload.get("latitude"),
                payload.get("longitude"),
            ),
        )
        _append_event(
            connection,
            checkin_id=record_id,
            actor=actor,
            event="check-in",
            site=site,
            worker=name,
            prior_status=None,
            new_status=status,
            details=f"alone={alone}; overdue after {overdue_after} min",
            at=timestamp,
        )
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (record_id,)).fetchone()
    return _row_to_record(row)


def list_checkins(include_closed: bool = False) -> list[dict[str, Any]]:
    with _LOCK, _session() as connection:
        if include_closed:
            rows = connection.execute("SELECT * FROM checkins ORDER BY checked_in").fetchall()
        else:
            placeholders = ",".join("?" for _ in OPEN_STATUSES)
            rows = connection.execute(
                f"SELECT * FROM checkins WHERE status IN ({placeholders})"
                " OR help_state IN ('requested','acknowledged') ORDER BY checked_in",
                OPEN_STATUSES,
            ).fetchall()
    reference = datetime.now(TZ)
    return [_row_to_record(row, reference) for row in rows]


def get_checkin(checkin_id: str) -> dict[str, Any] | None:
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
    return _row_to_record(row) if row else None


def record_heartbeat(
    checkin_id: str,
    latitude: Any = None,
    longitude: Any = None,
    actor: str = "worker",
) -> dict[str, Any] | None:
    """Refresh last-heard. An overdue worker returns to on-site and that is logged."""
    timestamp = now_iso()
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
        if row is None:
            return None
        if row["status"] == STATUS_CHECKED_OUT:
            return _row_to_record(row)

        prior_status = row["status"]
        new_status = STATUS_ON_SITE if prior_status == STATUS_OVERDUE else prior_status
        connection.execute(
            "UPDATE checkins SET last_heard=?, status=?,"
            " latitude=COALESCE(?, latitude), longitude=COALESCE(?, longitude) WHERE id=?",
            (timestamp, new_status, latitude, longitude, checkin_id),
        )
        _append_event(
            connection,
            checkin_id=checkin_id,
            actor=actor,
            event="heartbeat",
            site=row["site"],
            worker=row["name"],
            prior_status=prior_status,
            new_status=new_status,
            details="worker heard from" if prior_status != STATUS_OVERDUE else "overdue cleared by heartbeat",
            at=timestamp,
        )
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
    return _row_to_record(row)


def request_help(checkin_id: str, actor: str = "worker") -> dict[str, Any] | None:
    """Open an urgent help request without relying on a browser staying open."""
    timestamp = now_iso()
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
        if row is None:
            return None
        if row["status"] == STATUS_CHECKED_OUT:
            raise ValueError("cannot request help after checkout")
        if row["help_state"] in ("requested", "acknowledged"):
            return _row_to_record(row)
        prior_help_state = row["help_state"]
        connection.execute(
            "UPDATE checkins SET help_state='requested', help_requested_at=?,"
            " help_acknowledged_at=NULL, help_acknowledged_by=NULL,"
            " help_resolved_at=NULL, help_resolved_by=NULL WHERE id=?",
            (timestamp, checkin_id),
        )
        _append_event(
            connection,
            checkin_id=checkin_id,
            actor=actor[:80],
            event="help requested",
            site=row["site"],
            worker=row["name"],
            prior_status=row["status"],
            new_status=row["status"],
            prior_help_state=prior_help_state,
            new_help_state="requested",
            details="worker requested immediate operator assistance",
            at=timestamp,
        )
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
    return _row_to_record(row)


def acknowledge_help(checkin_id: str, actor: str = "operator") -> dict[str, Any] | None:
    """Record that an operator has seen a request; the request remains open."""
    timestamp = now_iso()
    actor = actor.strip()[:80] or "operator"
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
        if row is None:
            return None
        if row["help_state"] != "requested":
            return _row_to_record(row)
        connection.execute(
            "UPDATE checkins SET help_state='acknowledged', help_acknowledged_at=?,"
            " help_acknowledged_by=? WHERE id=?",
            (timestamp, actor, checkin_id),
        )
        _append_event(
            connection,
            checkin_id=checkin_id,
            actor=actor,
            event="help acknowledged",
            site=row["site"],
            worker=row["name"],
            prior_status=row["status"],
            new_status=row["status"],
            prior_help_state="requested",
            new_help_state="acknowledged",
            details="operator acknowledged the help request; assistance remains open",
            at=timestamp,
        )
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
    return _row_to_record(row)


def resolve_help(checkin_id: str, actor: str = "operator") -> dict[str, Any] | None:
    """Close a help request after the operator confirms the situation is resolved."""
    timestamp = now_iso()
    actor = actor.strip()[:80] or "operator"
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
        if row is None:
            return None
        if row["help_state"] not in ("requested", "acknowledged"):
            return _row_to_record(row)
        prior_help_state = row["help_state"]
        connection.execute(
            "UPDATE checkins SET help_state='resolved', help_resolved_at=?,"
            " help_resolved_by=? WHERE id=?",
            (timestamp, actor, checkin_id),
        )
        _append_event(
            connection,
            checkin_id=checkin_id,
            actor=actor,
            event="help resolved",
            site=row["site"],
            worker=row["name"],
            prior_status=row["status"],
            new_status=row["status"],
            prior_help_state=prior_help_state,
            new_help_state="resolved",
            details="operator marked the help request resolved",
            at=timestamp,
        )
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
    return _row_to_record(row)


def adjust_time(checkin_id: str, field: str, hour: int, minute: int, actor: str = "operator edit") -> dict[str, Any] | None:
    """Correct a check-in or last-seen time. The original value stays in the event log."""
    if field not in ("checkedIn", "lastHeard"):
        raise ValueError("field must be checkedIn or lastHeard")
    column = "checked_in" if field == "checkedIn" else "last_heard"

    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
        if row is None:
            return None
        previous = row[column]
        corrected = datetime.fromisoformat(previous).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
        connection.execute(
            f"UPDATE checkins SET {column}=? WHERE id=?", (corrected.isoformat(), checkin_id)
        )
        _append_event(
            connection,
            checkin_id=checkin_id,
            actor=actor,
            event=f"{field} corrected",
            site=row["site"],
            worker=row["name"],
            prior_status=row["status"],
            new_status=row["status"],
            details=f"{previous} -> {corrected.isoformat()}",
        )
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
    return _row_to_record(row)


def check_out(checkin_id: str, actor: str = "check-in") -> dict[str, Any] | None:
    """Close a check-in. The row is retained; only the status changes."""
    timestamp = now_iso()
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
        if row is None:
            return None
        if row["status"] == STATUS_CHECKED_OUT:
            return _row_to_record(row)
        connection.execute(
            "UPDATE checkins SET status=?, checked_out_at=? WHERE id=?",
            (STATUS_CHECKED_OUT, timestamp, checkin_id),
        )
        _append_event(
            connection,
            checkin_id=checkin_id,
            actor=actor,
            event="check-out",
            site=row["site"],
            worker=row["name"],
            prior_status=row["status"],
            new_status=STATUS_CHECKED_OUT,
            at=timestamp,
        )
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
    return _row_to_record(row)


def resolve_provisional(checkin_id: str, accept: bool, actor: str = "operator") -> dict[str, Any] | None:
    """Confirm or reject a provisional check-in.

    Accepting moves it to on-site. Rejecting closes it like a checkout — the
    row and its history are retained. Anything not currently provisional is
    returned unchanged, so a double-click cannot corrupt state.
    """
    timestamp = now_iso()
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
        if row is None:
            return None
        if row["status"] != STATUS_PROVISIONAL:
            return _row_to_record(row)
        new_status = STATUS_ON_SITE if accept else STATUS_CHECKED_OUT
        if accept:
            connection.execute(
                "UPDATE checkins SET status=? WHERE id=?", (new_status, checkin_id)
            )
        else:
            connection.execute(
                "UPDATE checkins SET status=?, checked_out_at=? WHERE id=?",
                (new_status, timestamp, checkin_id),
            )
        _append_event(
            connection,
            checkin_id=checkin_id,
            actor=actor,
            event="provisional accepted" if accept else "provisional rejected",
            site=row["site"],
            worker=row["name"],
            prior_status=STATUS_PROVISIONAL,
            new_status=new_status,
            details="identity confirmed by operator" if accept else "rejected by operator; record closed",
            at=timestamp,
        )
        row = connection.execute("SELECT * FROM checkins WHERE id=?", (checkin_id,)).fetchone()
    return _row_to_record(row)


def evaluate_overdue(reference: datetime | None = None) -> list[dict[str, Any]]:
    """Move silent workers to overdue. Returns the records that just changed."""
    reference = reference or datetime.now(TZ)
    timestamp = reference.isoformat()
    changed: list[dict[str, Any]] = []

    with _LOCK, _session() as connection:
        rows = connection.execute(
            "SELECT * FROM checkins WHERE status IN (?,?)", (STATUS_ON_SITE, STATUS_PROVISIONAL)
        ).fetchall()
        for row in rows:
            deadline = datetime.fromisoformat(row["last_heard"]) + timedelta(
                minutes=row["overdue_after_minutes"]
            )
            if reference < deadline:
                continue
            connection.execute(
                "UPDATE checkins SET status=? WHERE id=?", (STATUS_OVERDUE, row["id"])
            )
            silent = int((reference - datetime.fromisoformat(row["last_heard"])).total_seconds() // 60)
            _append_event(
                connection,
                checkin_id=row["id"],
                actor="northstar-monitor",
                event="overdue",
                site=row["site"],
                worker=row["name"],
                prior_status=row["status"],
                new_status=STATUS_OVERDUE,
                details=(
                    f"no contact for {silent} min"
                    f" (limit {row['overdue_after_minutes']} min; alone={bool(row['alone'])})"
                ),
                at=timestamp,
            )
            changed.append(_row_to_record(row, reference) | {"status": STATUS_OVERDUE, "overdue": True})
    return changed


def history(checkin_id: str | None = None, limit: int = 250) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 1000))
    with _LOCK, _session() as connection:
        if checkin_id:
            rows = connection.execute(
                "SELECT * FROM checkin_events WHERE checkin_id=? ORDER BY seq DESC LIMIT ?",
                (checkin_id, limit),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM checkin_events ORDER BY seq DESC LIMIT ?", (limit,)
            ).fetchall()
    return [
        {
            "seq": row["seq"],
            "checkinId": row["checkin_id"],
            "at": row["at"],
            "actor": row["actor"],
            "event": row["event"],
            "site": row["site"],
            "worker": row["worker"],
            "priorStatus": row["prior_status"],
            "newStatus": row["new_status"],
            "priorHelpState": row["prior_help_state"],
            "newHelpState": row["new_help_state"],
            "details": row["details"],
        }
        for row in rows
    ]


def operational_summary(reference: datetime | None = None) -> dict[str, Any]:
    """Small, read-only status snapshot for watchdog and support diagnostics."""
    reference = reference or datetime.now(TZ)
    with _LOCK, _session() as connection:
        integrity = connection.execute("PRAGMA quick_check(1)").fetchone()[0]
        counts = connection.execute(
            "SELECT"
            " SUM(CASE WHEN status IN ('on-site','overdue','provisional') THEN 1 ELSE 0 END)"
            " AS active_checkins,"
            " SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END) AS overdue_checkins,"
            " SUM(CASE WHEN help_state IN ('requested','acknowledged') THEN 1 ELSE 0 END)"
            " AS open_help FROM checkins"
        ).fetchone()
        open_outages = connection.execute(
            "SELECT COUNT(*) FROM outages WHERE status='Open'"
        ).fetchone()[0]
        open_alerts = connection.execute(
            "SELECT COUNT(*) FROM alerts WHERE state IN ('active','acknowledged')"
        ).fetchone()[0]

    backups = sorted(BACKUP_DIR.glob("northstar-*.db")) if BACKUP_DIR.exists() else []
    backup_at = None
    backup_age_minutes = None
    if backups:
        modified = datetime.fromtimestamp(backups[-1].stat().st_mtime, TZ)
        backup_at = modified.isoformat()
        backup_age_minutes = max(0, int((reference - modified).total_seconds() // 60))
    return {
        "ok": integrity == "ok",
        "integrity": integrity,
        "activeCheckins": int(counts["active_checkins"] or 0),
        "overdueCheckins": int(counts["overdue_checkins"] or 0),
        "openHelpRequests": int(counts["open_help"] or 0),
        "openOutages": int(open_outages),
        "openPriceAlerts": int(open_alerts),
        "lastBackupAt": backup_at,
        "backupAgeMinutes": backup_age_minutes,
        "backupMirrorConfigured": bool(BACKUP_MIRROR),
    }


def _unique_id(connection: sqlite3.Connection, table: str, prefix: str) -> str:
    record_id = f"{prefix}-{int(datetime.now(TZ).timestamp() * 1000)}"
    while connection.execute(f"SELECT 1 FROM {table} WHERE id=?", (record_id,)).fetchone():
        record_id += "x"
    return record_id


def add_logbook_entry(
    entry_type: str, subject: str, details: str = "", source: str = "operator"
) -> dict[str, Any]:
    """Append a logbook entry. The logbook is append-only; nothing edits or deletes.

    Each row carries a SHA-256 over its predecessor's digest and its own stored
    fields, so editing or removing any earlier entry breaks every digest after
    it. See ``verify_logbook_chain``. The hash covers the values as stored —
    after truncation — so a verified chain reflects the record as kept, not the
    text as typed.
    """
    timestamp = now_iso()
    stored_type = entry_type[:60]
    stored_subject = subject[:160]
    stored_details = details[:4000]
    stored_source = source[:40]
    with _LOCK, _session() as connection:
        record_id = _unique_id(connection, "logbook", "event")
        tail = connection.execute(
            "SELECT entry_hash FROM logbook ORDER BY rowid DESC LIMIT 1"
        ).fetchone()
        previous = (tail["entry_hash"] if tail else "") or ""
        digest = _logbook_hash(
            previous, record_id, timestamp, stored_type, stored_subject, stored_details, stored_source
        )
        connection.execute(
            "INSERT INTO logbook (id, at, type, subject, details, source, prev_hash, entry_hash)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (
                record_id,
                timestamp,
                stored_type,
                stored_subject,
                stored_details,
                stored_source,
                previous,
                digest,
            ),
        )
        events.append_event(
            connection,
            event_type="operations.logbook.entry_added",
            occurred_at=timestamp,
            actor_id=stored_source,
            aggregate_type="logbook",
            aggregate_id=record_id,
            source="logbook",
            severity=(
                "critical" if any(term in stored_type.lower() for term in ("help", "trip", "emergency"))
                else "warning" if any(term in stored_type.lower() for term in ("alarm", "outage", "overdue"))
                else "info"
            ),
            summary=stored_subject,
            payload={
                "type": stored_type,
                "details": stored_details,
                "legacyEntryHash": digest,
            },
        )
    return {
        "id": record_id,
        "type": stored_type,
        "subject": stored_subject,
        "details": stored_details,
        "source": stored_source,
        "timestamp": timestamp,
        "entryHash": digest,
    }


def list_logbook(limit: int = 250) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 1000))
    with _LOCK, _session() as connection:
        rows = connection.execute(
            "SELECT * FROM logbook ORDER BY at DESC, id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [
        {
            "id": row["id"],
            "type": row["type"],
            "subject": row["subject"],
            "details": row["details"],
            "source": row["source"],
            "timestamp": row["at"],
        }
        for row in rows
    ]


def list_audit_events(
    limit: int = 250,
    *,
    query: str = "",
    event_type: str = "",
    aggregate_type: str = "",
    aggregate_id: str = "",
    actor_id: str = "",
    source: str = "",
    severity: str = "",
    correlation_id: str = "",
    occurred_from: str = "",
    occurred_to: str = "",
) -> list[dict[str, Any]]:
    """Query the unified timeline without changing any legacy event reads."""
    limit = max(1, min(int(limit), 1000))
    clauses: list[str] = []
    values: list[Any] = []
    exact = {
        "event_type": event_type,
        "aggregate_type": aggregate_type,
        "aggregate_id": aggregate_id,
        "actor_id": actor_id,
        "source": source,
        "severity": severity,
        "correlation_id": correlation_id,
    }
    for column, value in exact.items():
        if value:
            clauses.append(f"{column}=?")
            values.append(value)
    if occurred_from:
        clauses.append("occurred_at>=?")
        values.append(occurred_from)
    if occurred_to:
        clauses.append("occurred_at<=?")
        values.append(occurred_to)
    if query:
        clauses.append(
            "(summary LIKE ? OR payload LIKE ? OR actor_id LIKE ? OR aggregate_id LIKE ?)"
        )
        pattern = f"%{query}%"
        values.extend([pattern, pattern, pattern, pattern])
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    with _LOCK, _session() as connection:
        rows = connection.execute(
            f"SELECT * FROM audit_events{where} ORDER BY occurred_at DESC, seq DESC LIMIT ?",
            (*values, limit),
        ).fetchall()
    return [events.present(row) for row in rows]


def _switching_clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _bounded_int(value: Any, minimum: int, maximum: int, default: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(parsed, maximum))


def _switching_file_records(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    records: list[dict[str, Any]] = []
    for item in value[:50]:
        if not isinstance(item, dict):
            continue
        try:
            size = max(0, min(int(item.get("size", 0) or 0), 25 * 1024 * 1024))
        except (TypeError, ValueError):
            size = 0
        digest = _switching_clip(item.get("sha256"), 64).lower()
        if digest and (len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest)):
            digest = ""
        records.append({
            "attachmentId": _switching_clip(item.get("attachmentId"), 120),
            "name": _switching_clip(item.get("name"), 255),
            "size": size,
            "type": _switching_clip(item.get("type"), 120),
            "lastModified": _switching_clip(item.get("lastModified"), 80),
            "sha256": digest,
            "storage": "SERVER" if item.get("attachmentId") else "LOCAL",
        })
    return [record for record in records if record["name"]]


def _switching_rows(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    rows: list[dict[str, str]] = []
    for item in value[:100]:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "first": _switching_clip(item.get("first"), 240),
                "second": _switching_clip(item.get("second"), 2000),
            }
        )
    return rows


def _normalise_switching_payload(payload: dict[str, Any]) -> dict[str, Any]:
    checks = payload.get("checks", {})
    if not isinstance(checks, dict):
        checks = {}
    source_manifest_digest = _switching_clip(payload.get("sourceManifestDigest"), 64).lower()
    if source_manifest_digest and (
        len(source_manifest_digest) != 64
        or any(character not in "0123456789abcdef" for character in source_manifest_digest)
    ):
        raise ValueError("source manifest digest must be a SHA-256 hex value")
    result = {
        "packageName": _switching_clip(payload.get("packageName"), 160),
        "site": _switching_clip(payload.get("site"), 120),
        "asset": _switching_clip(payload.get("asset"), 160),
        "outageId": _switching_clip(payload.get("outageId"), 120),
        "schematicId": _switching_clip(payload.get("schematicId"), 120),
        "schematicRevision": _bounded_int(payload.get("schematicRevision"), 0, 1000000),
        "symbolProfileApprovalRef": _switching_clip(payload.get("symbolProfileApprovalRef"), 240),
        "canonicalAssetId": _switching_clip(payload.get("canonicalAssetId"), 160),
        "topologySnapshotId": _switching_clip(payload.get("topologySnapshotId"), 160),
        "topologyRevision": _switching_clip(payload.get("topologyRevision"), 160),
        "revision": _switching_clip(payload.get("revision"), 120),
        "ruleSet": _switching_clip(payload.get("ruleSet"), 160),
        "authorityProcedureId": _switching_clip(payload.get("authorityProcedureId"), 160),
        "authorityProcedureRevision": _switching_clip(payload.get("authorityProcedureRevision"), 160),
        "qualificationEvidenceRef": _switching_clip(payload.get("qualificationEvidenceRef"), 240),
        "sourceManifestDigest": source_manifest_digest,
        "scope": _switching_clip(payload.get("scope"), 4000),
        "diagrams": _switching_file_records(payload.get("diagrams")),
        "ruleSources": _switching_file_records(payload.get("ruleSources")),
        "isolation": _switching_rows(payload.get("isolation")),
        "sequence": _switching_rows(payload.get("sequence")),
        "verification": _switching_rows(payload.get("verification")),
        "permission": _switching_rows(payload.get("permission")),
        "restoration": _switching_rows(payload.get("restoration")),
        "reviewerName": _switching_clip(payload.get("reviewerName"), 160),
        "reviewerRole": _switching_clip(payload.get("reviewerRole"), 240),
        "reviewComments": _switching_clip(payload.get("reviewComments"), 4000),
        "checks": {key: bool(checks.get(key)) for key in SWITCHING_REVIEW_CHECKS},
    }
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > 50 * 1024:
        raise ValueError("switching draft metadata exceeds 50 KB")
    return result


def _switching_validation_errors(payload: dict[str, Any]) -> list[str]:
    errors = []
    for key, label in (
        ("packageName", "package name"),
        ("site", "site"),
        ("asset", "circuit or asset"),
        ("canonicalAssetId", "canonical asset ID"),
        ("topologySnapshotId", "topology snapshot ID"),
        ("topologyRevision", "topology revision"),
        ("revision", "diagram revision"),
        ("ruleSet", "UWPC/EUSR rule set"),
        ("authorityProcedureId", "authority procedure ID"),
        ("authorityProcedureRevision", "authority procedure revision"),
        ("qualificationEvidenceRef", "qualification evidence reference"),
        ("scope", "work scope"),
    ):
        if not str(payload.get(key, "")).strip():
            errors.append(label)
    durable_diagrams = [item for item in payload.get("diagrams", []) if item.get("attachmentId")]
    durable_sources = [item for item in payload.get("ruleSources", []) if item.get("attachmentId")]
    if not durable_diagrams and not payload.get("schematicId"):
        errors.append("server-stored circuit diagram source")
    if payload.get("schematicId") and not payload.get("symbolProfileApprovalRef"):
        errors.append("utility symbol-profile approval reference")
    if not durable_sources:
        errors.append("server-stored governing rule/procedure source")
    if not payload.get("sourceManifestDigest"):
        errors.append("source manifest digest")
    for key, label in (
        ("isolation", "isolation review rows"),
        ("sequence", "sequence/checkback rows"),
        ("verification", "verification rows"),
        ("permission", "safe-work permission rows"),
        ("restoration", "restoration/closeout rows"),
    ):
        rows = payload.get(key) or []
        if not rows or any(not row["first"].strip() or not row["second"].strip() for row in rows):
            errors.append(label)
    return errors


def _append_switching_event(
    connection: sqlite3.Connection,
    *,
    draft_id: str,
    actor: str,
    event: str,
    prior_status: str | None,
    new_status: str | None,
    details: str = "",
    at: str | None = None,
) -> None:
    timestamp = at or now_iso()
    stored_actor = _switching_clip(actor, 80) or "operator"
    stored_event = _switching_clip(event, 80)
    stored_details = _switching_clip(details, 4000)
    connection.execute(
        "INSERT INTO switching_draft_events"
        " (draft_id, at, actor, event, prior_status, new_status, details)"
        " VALUES (?,?,?,?,?,?,?)",
        (
            draft_id,
            timestamp,
            stored_actor,
            stored_event,
            prior_status,
            new_status,
            stored_details,
        ),
    )
    events.append_event(
        connection,
        event_type=events.event_type("switching", stored_event),
        occurred_at=timestamp,
        actor_id=stored_actor,
        aggregate_type="switching_draft",
        aggregate_id=draft_id,
        source="switching",
        severity="warning" if "review" in stored_event.lower() else "info",
        summary=stored_event,
        payload={"priorStatus": prior_status, "newStatus": new_status, "details": stored_details},
    )


def _switching_history_from_connection(
    connection: sqlite3.Connection, draft_id: str, limit: int = 250
) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT * FROM switching_draft_events WHERE draft_id=? ORDER BY seq DESC LIMIT ?",
        (draft_id, max(1, min(limit, 1000))),
    ).fetchall()
    return [
        {
            "seq": row["seq"],
            "at": row["at"],
            "actor": row["actor"],
            "event": row["event"],
            "priorStatus": row["prior_status"],
            "newStatus": row["new_status"],
            "details": row["details"],
        }
        for row in rows
    ]


def _switching_record(
    row: sqlite3.Row, audit: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    try:
        payload = json.loads(row["payload"] or "{}")
    except json.JSONDecodeError:
        payload = {}
    record = dict(payload) if isinstance(payload, dict) else {}
    record.update(
        {
            "id": row["id"],
            "packageName": row["package_name"],
            "site": row["site"],
            "asset": row["asset"],
            "outageId": row["outage_id"],
            "schematicId": row["schematic_id"],
            "revision": row["diagram_revision"],
            "ruleSet": row["rule_set"],
            "scope": row["work_scope"],
            "status": row["status"],
            "version": row["record_version"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "createdBy": row["created_by"],
            "reviewerName": row["reviewer_name"],
            "reviewerRole": row["reviewer_role"],
            "reviewComments": row["review_comments"],
            "reviewedAt": row["reviewed_at"],
            "reviewedBy": row["reviewed_by"],
        }
    )
    if audit is not None:
        record["audit"] = audit
    return record


def create_switching_draft(payload: dict[str, Any], actor: str = "operator") -> dict[str, Any]:
    data = _normalise_switching_payload(payload)
    timestamp = now_iso()
    actor = _switching_clip(actor, 80) or "operator"
    with _LOCK, _session() as connection:
        record_id = _unique_id(connection, "switching_drafts", "switching")
        connection.execute(
            "INSERT INTO switching_drafts"
            " (id, package_name, site, asset, outage_id, schematic_id, diagram_revision, rule_set, work_scope, status, record_version, payload, created_at, updated_at, created_by)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                record_id,
                data["packageName"],
                data["site"],
                data["asset"],
                data["outageId"],
                data["schematicId"],
                data["revision"],
                data["ruleSet"],
                data["scope"],
                SWITCHING_DRAFT,
                1,
                json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                timestamp,
                timestamp,
                actor,
            ),
        )
        _append_switching_event(
            connection,
            draft_id=record_id,
            actor=actor,
            event="created",
            prior_status=None,
            new_status=SWITCHING_DRAFT,
            details="draft package created; no operational release",
            at=timestamp,
        )
    return get_switching_draft(record_id)  # type: ignore[return-value]


def _switching_expected_version(payload: dict[str, Any]) -> int | None:
    value = payload.get("version")
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError("draft version must be an integer")
    try:
        version = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("draft version must be an integer") from exc
    if version < 1:
        raise ValueError("draft version must be positive")
    return version


def save_switching_draft(
    draft_id: str, payload: dict[str, Any], actor: str = "operator"
) -> dict[str, Any] | None:
    actor = _switching_clip(actor, 80) or "operator"
    expected_version = _switching_expected_version(payload)
    with _LOCK, _session() as connection:
        row = connection.execute(
            "SELECT * FROM switching_drafts WHERE id=?", (draft_id,)
        ).fetchone()
        if row is None:
            return None
        if row["status"] == SWITCHING_REVIEWED:
            raise ValueError("reviewed packages are immutable; start a new revision")
        if expected_version is not None and expected_version != row["record_version"]:
            raise SwitchingConflict(
                f"stale draft version; server is at version {row['record_version']}"
            )
        try:
            existing = json.loads(row["payload"] or "{}")
        except json.JSONDecodeError:
            existing = {}
        merged = {**(existing if isinstance(existing, dict) else {}), **payload}
        data = _normalise_switching_payload(merged)
        timestamp = now_iso()
        prior_status = row["status"]
        new_status = SWITCHING_DRAFT if prior_status == SWITCHING_READY else prior_status
        new_version = row["record_version"] + 1
        connection.execute(
            "UPDATE switching_drafts SET package_name=?, site=?, asset=?, outage_id=?, schematic_id=?, diagram_revision=?, rule_set=?, work_scope=?, status=?, record_version=?, payload=?, updated_at=? WHERE id=?",
            (
                data["packageName"],
                data["site"],
                data["asset"],
                data["outageId"],
                data["schematicId"],
                data["revision"],
                data["ruleSet"],
                data["scope"],
                new_status,
                new_version,
                json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                timestamp,
                draft_id,
            ),
        )
        _append_switching_event(
            connection,
            draft_id=draft_id,
            actor=actor,
            event="updated",
            prior_status=prior_status,
            new_status=new_status,
            details="draft metadata saved; ready status is cleared when content changes",
            at=timestamp,
        )
    return get_switching_draft(draft_id)


def mark_switching_draft_ready(
    draft_id: str, actor: str = "operator", expected_version: int | str | None = None
) -> dict[str, Any] | None:
    actor = _switching_clip(actor, 80) or "operator"
    if expected_version is not None:
        expected_version = _switching_expected_version({"version": expected_version})
    with _LOCK, _session() as connection:
        row = connection.execute(
            "SELECT * FROM switching_drafts WHERE id=?", (draft_id,)
        ).fetchone()
        if row is None:
            return None
        if expected_version is not None and expected_version != row["record_version"]:
            raise SwitchingConflict(
                f"stale draft version; server is at version {row['record_version']}"
            )
        if row["status"] == SWITCHING_REVIEWED:
            raise ValueError("reviewed packages are immutable")
        if row["status"] == SWITCHING_READY:
            return _switching_record(row, _switching_history_from_connection(connection, draft_id))
        try:
            data = json.loads(row["payload"] or "{}")
        except json.JSONDecodeError:
            data = {}
        errors = _switching_validation_errors(data if isinstance(data, dict) else {})
        if isinstance(data, dict) and data.get("outageId"):
            linked_outage = connection.execute(
                "SELECT 1 FROM outages WHERE id=?", (data["outageId"],)
            ).fetchone()
            if linked_outage is None:
                errors.append("valid linked outage")
        if isinstance(data, dict) and data.get("schematicId"):
            linked_schematic = connection.execute(
                "SELECT current_revision,standard_approval_ref FROM one_line_documents WHERE id=?",
                (data["schematicId"],),
            ).fetchone()
            if linked_schematic is None:
                errors.append("valid server schematic")
            elif int(data.get("schematicRevision", 0) or 0) != linked_schematic["current_revision"]:
                errors.append("current schematic revision")
            elif not linked_schematic["standard_approval_ref"]:
                errors.append("schematic utility symbol-profile approval reference")
            elif data.get("symbolProfileApprovalRef") != linked_schematic["standard_approval_ref"]:
                errors.append("matching schematic symbol-profile approval reference")
        if errors:
            raise ValueError("not ready: " + ", ".join(errors))
        timestamp = now_iso()
        new_version = row["record_version"] + 1
        connection.execute(
            "UPDATE switching_drafts SET status=?, record_version=?, updated_at=? WHERE id=?",
            (SWITCHING_READY, new_version, timestamp, draft_id),
        )
        _append_switching_event(
            connection,
            draft_id=draft_id,
            actor=actor,
            event="ready-for-review",
            prior_status=row["status"],
            new_status=SWITCHING_READY,
            details="all source and draft-form gates passed; qualified review required",
            at=timestamp,
        )
    return get_switching_draft(draft_id)


def record_switching_review(
    draft_id: str, payload: dict[str, Any], actor: str = "operator"
) -> dict[str, Any] | None:
    actor = _switching_clip(actor, 80) or "operator"
    expected_version = _switching_expected_version(payload)
    with _LOCK, _session() as connection:
        row = connection.execute(
            "SELECT * FROM switching_drafts WHERE id=?", (draft_id,)
        ).fetchone()
        if row is None:
            return None
        if expected_version is not None and expected_version != row["record_version"]:
            raise SwitchingConflict(
                f"stale draft version; server is at version {row['record_version']}"
            )
        if row["status"] != SWITCHING_READY:
            raise ValueError("package must be ready for qualified review")
        checks = payload.get("checks", {})
        checks = checks if isinstance(checks, dict) else {}
        if not all(bool(checks.get(key)) for key in SWITCHING_REVIEW_CHECKS):
            raise ValueError("all qualified-person review checks are required")
        reviewer_name = _switching_clip(payload.get("reviewerName"), 160)
        reviewer_role = _switching_clip(payload.get("reviewerRole"), 240)
        review_comments = _switching_clip(payload.get("reviewComments"), 4000)
        if not reviewer_name or not reviewer_role or not review_comments:
            raise ValueError("reviewer name, role/authorization, and comments are required")
        try:
            existing = json.loads(row["payload"] or "{}")
        except json.JSONDecodeError:
            existing = {}
        data = _normalise_switching_payload(
            {
                **(existing if isinstance(existing, dict) else {}),
                "checks": checks,
                "reviewerName": reviewer_name,
                "reviewerRole": reviewer_role,
                "reviewComments": review_comments,
            }
        )
        timestamp = now_iso()
        new_version = row["record_version"] + 1
        connection.execute(
            "UPDATE switching_drafts SET status=?, record_version=?, payload=?, reviewer_name=?, reviewer_role=?, review_comments=?, reviewed_at=?, reviewed_by=?, updated_at=? WHERE id=?",
            (
                SWITCHING_REVIEWED,
                new_version,
                json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                reviewer_name,
                reviewer_role,
                review_comments,
                timestamp,
                actor,
                timestamp,
                draft_id,
            ),
        )
        _append_switching_event(
            connection,
            draft_id=draft_id,
            actor=actor,
            event="review-recorded",
            prior_status=row["status"],
            new_status=SWITCHING_REVIEWED,
            details="review recorded; operational release remains blocked",
            at=timestamp,
        )
    return get_switching_draft(draft_id)


def get_switching_draft(draft_id: str) -> dict[str, Any] | None:
    with _LOCK, _session() as connection:
        row = connection.execute(
            "SELECT * FROM switching_drafts WHERE id=?", (draft_id,)
        ).fetchone()
        if row is None:
            return None
        return _switching_record(row, _switching_history_from_connection(connection, draft_id))


def _switching_review_evidence(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "packet": "13",
        "evidenceType": "UWPC_EUSR_REVIEW_EVIDENCE",
        "draftId": record["id"],
        "outageId": record.get("outageId", ""),
        "schematicId": record.get("schematicId", ""),
        "schematicRevision": record.get("schematicRevision", 0),
        "status": record["status"],
        "terminalNonRelease": record["status"] == SWITCHING_REVIEWED,
        "sourceManifestDigest": record.get("sourceManifestDigest", ""),
        "authorityProcedureId": record.get("authorityProcedureId", ""),
        "authorityProcedureRevision": record.get("authorityProcedureRevision", ""),
        "qualificationEvidenceRef": record.get("qualificationEvidenceRef", ""),
        "canonicalAssetId": record.get("canonicalAssetId", ""),
        "topologySnapshotId": record.get("topologySnapshotId", ""),
        "topologyRevision": record.get("topologyRevision", ""),
        "reviewerName": record.get("reviewerName", ""),
        "reviewerRole": record.get("reviewerRole", ""),
        "reviewComments": record.get("reviewComments", ""),
        "reviewedAt": record.get("reviewedAt"),
        "reviewedBy": record.get("reviewedBy"),
        "audit": record.get("audit", []),
    }


def get_switching_review_evidence(draft_id: str) -> dict[str, Any] | None:
    """Return the dashboard's Packet 13-compatible immutable review projection.

    This is evidence only: it deliberately exposes no approval, certification,
    release, or equipment-command capability.
    """
    with _LOCK, _session() as connection:
        row = connection.execute(
            "SELECT * FROM switching_drafts WHERE id=?", (draft_id,)
        ).fetchone()
        if row is None:
            return None
        record = _switching_record(row, _switching_history_from_connection(connection, draft_id))
    return _switching_review_evidence(record)


def get_switching_bundle(
    draft_id: str, actor: str = "operator"
) -> dict[str, Any] | None:
    """Return one transactionally consistent package/source export snapshot."""
    actor = _switching_clip(actor, 80) or "operator"
    with _LOCK, _session() as connection:
        row = connection.execute(
            "SELECT * FROM switching_drafts WHERE id=?", (draft_id,)
        ).fetchone()
        if row is None:
            return None
        _append_switching_event(
            connection,
            draft_id=draft_id,
            actor=actor,
            event="controlled-bundle-exported",
            prior_status=row["status"],
            new_status=row["status"],
            details="package, evidence, audit, hashes, and stored sources exported; no operational release",
        )
        record = _switching_record(row, _switching_history_from_connection(connection, draft_id))
        attachments = connection.execute(
            "SELECT * FROM switching_attachments WHERE draft_id=?"
            " ORDER BY kind, uploaded_at, id",
            (draft_id,),
        ).fetchall()
        sources = []
        for attachment in attachments:
            source = _attachment_record(attachment)
            source["content"] = bytes(attachment["content"])
            sources.append(source)
    return {
        "package": record,
        "reviewEvidence": _switching_review_evidence(record),
        "attachments": sources,
    }


def clone_switching_draft(
    draft_id: str,
    actor: str = "operator",
    expected_version: int | str | None = None,
) -> dict[str, Any] | None:
    """Create a new draft revision with copied sources and cleared review evidence."""
    actor = _switching_clip(actor, 80) or "operator"
    if expected_version is not None:
        expected_version = _switching_expected_version({"version": expected_version})
    timestamp = now_iso()
    with _LOCK, _session() as connection:
        source = connection.execute(
            "SELECT * FROM switching_drafts WHERE id=?", (draft_id,)
        ).fetchone()
        if source is None:
            return None
        if expected_version is not None and expected_version != source["record_version"]:
            raise SwitchingConflict(
                f"stale draft version; server is at version {source['record_version']}"
            )
        try:
            payload = json.loads(source["payload"] or "{}")
        except json.JSONDecodeError:
            payload = {}
        payload = payload if isinstance(payload, dict) else {}
        new_id = _unique_id(connection, "switching_drafts", "switching")
        base_name = _switching_clip(
            payload.get("packageName") or source["package_name"] or "Switching package", 140
        )
        cloned_payload = {
            **payload,
            "packageName": f"{base_name} - REVISION DRAFT",
            "revision": "",
            "qualificationEvidenceRef": "",
            "reviewerName": "",
            "reviewerRole": "",
            "reviewComments": "",
            "checks": {key: False for key in SWITCHING_REVIEW_CHECKS},
            "diagrams": [],
            "ruleSources": [],
        }
        cloned_payload["sourceManifestDigest"] = _switching_manifest_digest(cloned_payload)
        data = _normalise_switching_payload(cloned_payload)
        connection.execute(
            "INSERT INTO switching_drafts"
            " (id,package_name,site,asset,outage_id,schematic_id,diagram_revision,rule_set,work_scope,status,record_version,payload,created_at,updated_at,created_by)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                new_id,
                data["packageName"],
                data["site"],
                data["asset"],
                data["outageId"],
                data["schematicId"],
                data["revision"],
                data["ruleSet"],
                data["scope"],
                SWITCHING_DRAFT,
                1,
                json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                timestamp,
                timestamp,
                actor,
            ),
        )
        copied_files: dict[str, list[dict[str, Any]]] = {"diagram": [], "source": []}
        attachments = connection.execute(
            "SELECT * FROM switching_attachments WHERE draft_id=?"
            " ORDER BY kind, uploaded_at, id",
            (draft_id,),
        ).fetchall()
        for attachment in attachments:
            attachment_id = _unique_id(connection, "switching_attachments", "attachment")
            connection.execute(
                "INSERT INTO switching_attachments"
                " (id,draft_id,kind,filename,content_type,size_bytes,sha256,content,uploaded_at,uploaded_by)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    attachment_id,
                    new_id,
                    attachment["kind"],
                    attachment["filename"],
                    attachment["content_type"],
                    attachment["size_bytes"],
                    attachment["sha256"],
                    attachment["content"],
                    timestamp,
                    actor,
                ),
            )
            copied = dict(attachment)
            copied.update({"id": attachment_id, "draft_id": new_id, "uploaded_at": timestamp, "uploaded_by": actor})
            copied_files[attachment["kind"]].append(_attachment_record(copied))

        cloned_payload = {
            **data,
            "diagrams": copied_files["diagram"],
            "ruleSources": copied_files["source"],
        }
        cloned_payload["sourceManifestDigest"] = _switching_manifest_digest(cloned_payload)
        data = _normalise_switching_payload(cloned_payload)
        connection.execute(
            "UPDATE switching_drafts SET payload=? WHERE id=?",
            (json.dumps(data, ensure_ascii=False, separators=(",", ":")), new_id),
        )
        _append_switching_event(
            connection,
            draft_id=new_id,
            actor=actor,
            event="revision-created",
            prior_status=None,
            new_status=SWITCHING_DRAFT,
            details=f"cloned from {draft_id}; review evidence cleared; no operational release",
            at=timestamp,
        )
        _append_switching_event(
            connection,
            draft_id=draft_id,
            actor=actor,
            event="revision-cloned",
            prior_status=source["status"],
            new_status=source["status"],
            details=f"new draft revision {new_id} created; source package remains unchanged",
            at=timestamp,
        )
    return get_switching_draft(new_id)


def list_switching_drafts(
    status: str | None = None,
    limit: int = 100,
    query: str | None = None,
    outage_id: str | None = None,
) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 500))
    query = _switching_clip(query, 160)
    outage_id = _switching_clip(outage_id, 120)
    clauses: list[str] = []
    values: list[Any] = []
    if status in (SWITCHING_DRAFT, SWITCHING_READY, SWITCHING_REVIEWED):
        clauses.append("status=?")
        values.append(status)
    if outage_id:
        clauses.append("outage_id=?")
        values.append(outage_id)
    if query:
        clauses.append("(package_name LIKE ? OR site LIKE ? OR asset LIKE ? OR id LIKE ?)")
        pattern = f"%{query}%"
        values.extend([pattern, pattern, pattern, pattern])
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    with _LOCK, _session() as connection:
        rows = connection.execute(
            f"SELECT * FROM switching_drafts{where} ORDER BY updated_at DESC, id DESC LIMIT ?",
            (*values, limit),
        ).fetchall()
    return [_switching_record(row) for row in rows]


_SWITCHING_ATTACHMENT_TYPES = {
    "diagram": {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".json": "application/json",
    },
    "source": {
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
}
MAX_SWITCHING_ATTACHMENT_BYTES = 25 * 1024 * 1024


def _safe_attachment_name(value: Any) -> str:
    filename = str(value or "").replace("\\", "/").split("/")[-1].strip()
    filename = "".join(character for character in filename if ord(character) >= 32)
    if not filename or filename in {".", ".."}:
        raise ValueError("attachment filename is required")
    return filename[:255]


def _attachment_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "attachmentId": row["id"],
        "name": row["filename"],
        "size": row["size_bytes"],
        "type": row["content_type"],
        "lastModified": row["uploaded_at"],
        "sha256": row["sha256"],
        "storage": "SERVER",
        "kind": row["kind"],
        "uploadedAt": row["uploaded_at"],
        "uploadedBy": row["uploaded_by"],
        "downloadUrl": f"/api/switching/drafts/{row['draft_id']}/attachments/{row['id']}",
    }


def _validate_attachment_content(suffix: str, content: bytes) -> None:
    signatures = {
        ".pdf": lambda value: value.startswith(b"%PDF-"),
        ".png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
        ".jpg": lambda value: value.startswith(b"\xff\xd8\xff"),
        ".jpeg": lambda value: value.startswith(b"\xff\xd8\xff"),
        ".webp": lambda value: len(value) >= 12 and value[:4] == b"RIFF" and value[8:12] == b"WEBP",
        ".doc": lambda value: value.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"),
        ".docx": lambda value: value.startswith(b"PK\x03\x04"),
    }
    if suffix in signatures and not signatures[suffix](content):
        raise ValueError("attachment content does not match its filename")
    if suffix == ".json":
        try:
            parsed = json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("one-line JSON attachment is invalid") from exc
        if not isinstance(parsed, dict):
            raise ValueError("one-line JSON attachment must contain an object")
    if suffix == ".txt":
        try:
            content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("text attachment must be UTF-8") from exc


def _switching_manifest_digest(payload: dict[str, Any]) -> str:
    manifest = {
        "diagrams": sorted(
            [
                {
                    key: item.get(key, "")
                    for key in ("attachmentId", "name", "size", "type", "sha256")
                }
                for item in payload.get("diagrams", [])
                if isinstance(item, dict)
            ],
            key=lambda item: (str(item["name"]), str(item["attachmentId"])),
        ),
        "ruleSources": sorted(
            [
                {
                    key: item.get(key, "")
                    for key in ("attachmentId", "name", "size", "type", "sha256")
                }
                for item in payload.get("ruleSources", [])
                if isinstance(item, dict)
            ],
            key=lambda item: (str(item["name"]), str(item["attachmentId"])),
        ),
        "schematicId": payload.get("schematicId", ""),
        "schematicRevision": payload.get("schematicRevision", 0),
    }
    encoded = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def add_switching_attachment(
    draft_id: str,
    kind: str,
    filename: str,
    content_type: str,
    content: bytes,
    actor: str = "operator",
) -> dict[str, Any] | None:
    if kind not in _SWITCHING_ATTACHMENT_TYPES:
        raise ValueError("attachment kind must be diagram or source")
    filename = _safe_attachment_name(filename)
    suffix = Path(filename).suffix.lower()
    if suffix not in _SWITCHING_ATTACHMENT_TYPES[kind]:
        raise ValueError(f"unsupported {kind} attachment type")
    if not content:
        raise ValueError("attachment is empty")
    if len(content) > MAX_SWITCHING_ATTACHMENT_BYTES:
        raise ValueError("attachment exceeds 25 MB")
    _validate_attachment_content(suffix, content)
    expected_type = _SWITCHING_ATTACHMENT_TYPES[kind][suffix]
    supplied_type = _switching_clip(content_type, 120).split(";", 1)[0].lower()
    if supplied_type not in {"", "application/octet-stream", expected_type}:
        raise ValueError("attachment content type does not match its filename")
    content_type = expected_type
    digest = hashlib.sha256(content).hexdigest()
    timestamp = now_iso()
    actor = _switching_clip(actor, 80) or "operator"
    with _LOCK, _session() as connection:
        draft = connection.execute(
            "SELECT * FROM switching_drafts WHERE id=?", (draft_id,)
        ).fetchone()
        if draft is None:
            return None
        if draft["status"] == SWITCHING_REVIEWED:
            raise ValueError("reviewed packages are immutable; start a new revision")
        row = connection.execute(
            "SELECT * FROM switching_attachments"
            " WHERE draft_id=? AND kind=? AND filename=? AND sha256=?",
            (draft_id, kind, filename, digest),
        ).fetchone()
        if row is None:
            attachment_id = _unique_id(connection, "switching_attachments", "attachment")
            connection.execute(
                "INSERT INTO switching_attachments"
                " (id,draft_id,kind,filename,content_type,size_bytes,sha256,content,uploaded_at,uploaded_by)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    attachment_id,
                    draft_id,
                    kind,
                    filename,
                    content_type,
                    len(content),
                    digest,
                    sqlite3.Binary(content),
                    timestamp,
                    actor,
                ),
            )
            row = connection.execute(
                "SELECT * FROM switching_attachments WHERE id=?", (attachment_id,)
            ).fetchone()
        try:
            payload = json.loads(draft["payload"] or "{}")
        except json.JSONDecodeError:
            payload = {}
        payload = payload if isinstance(payload, dict) else {}
        key = "diagrams" if kind == "diagram" else "ruleSources"
        files = [
            item for item in payload.get(key, [])
            if isinstance(item, dict)
            and item.get("attachmentId") != row["id"]
            and not (
                not item.get("attachmentId")
                and item.get("name") == filename
                and int(item.get("size", 0) or 0) == len(content)
            )
        ]
        files.append(_attachment_record(row))
        payload[key] = files
        payload["sourceManifestDigest"] = _switching_manifest_digest(payload)
        data = _normalise_switching_payload(payload)
        prior_status = draft["status"]
        new_status = SWITCHING_DRAFT if prior_status == SWITCHING_READY else prior_status
        connection.execute(
            "UPDATE switching_drafts SET payload=?, status=?, record_version=record_version+1, updated_at=? WHERE id=?",
            (json.dumps(data, ensure_ascii=False, separators=(",", ":")), new_status, timestamp, draft_id),
        )
        _append_switching_event(
            connection,
            draft_id=draft_id,
            actor=actor,
            event="attachment-stored",
            prior_status=prior_status,
            new_status=new_status,
            details=f"{kind} source stored: {filename} ({digest[:12]})",
            at=timestamp,
        )
    return get_switching_draft(draft_id)


def get_switching_attachment(draft_id: str, attachment_id: str) -> dict[str, Any] | None:
    with _LOCK, _session() as connection:
        row = connection.execute(
            "SELECT * FROM switching_attachments WHERE draft_id=? AND id=?",
            (draft_id, attachment_id),
        ).fetchone()
        if row is None:
            return None
        record = _attachment_record(row)
        record["content"] = bytes(row["content"])
        return record


def remove_switching_attachment(
    draft_id: str, attachment_id: str, actor: str = "operator"
) -> dict[str, Any] | None:
    actor = _switching_clip(actor, 80) or "operator"
    with _LOCK, _session() as connection:
        draft = connection.execute(
            "SELECT * FROM switching_drafts WHERE id=?", (draft_id,)
        ).fetchone()
        if draft is None:
            return None
        if draft["status"] == SWITCHING_REVIEWED:
            raise ValueError("reviewed packages are immutable; start a new revision")
        row = connection.execute(
            "SELECT * FROM switching_attachments WHERE draft_id=? AND id=?",
            (draft_id, attachment_id),
        ).fetchone()
        if row is None:
            raise ValueError("attachment not found")
        connection.execute("DELETE FROM switching_attachments WHERE id=?", (attachment_id,))
        try:
            payload = json.loads(draft["payload"] or "{}")
        except json.JSONDecodeError:
            payload = {}
        payload = payload if isinstance(payload, dict) else {}
        for key in ("diagrams", "ruleSources"):
            payload[key] = [
                item for item in payload.get(key, [])
                if isinstance(item, dict) and item.get("attachmentId") != attachment_id
            ]
        payload["sourceManifestDigest"] = _switching_manifest_digest(payload)
        data = _normalise_switching_payload(payload)
        timestamp = now_iso()
        prior_status = draft["status"]
        new_status = SWITCHING_DRAFT if prior_status == SWITCHING_READY else prior_status
        connection.execute(
            "UPDATE switching_drafts SET payload=?, status=?, record_version=record_version+1, updated_at=? WHERE id=?",
            (json.dumps(data, ensure_ascii=False, separators=(",", ":")), new_status, timestamp, draft_id),
        )
        _append_switching_event(
            connection,
            draft_id=draft_id,
            actor=actor,
            event="attachment-removed",
            prior_status=prior_status,
            new_status=new_status,
            details=f"stored source removed: {row['filename']}",
            at=timestamp,
        )
    return get_switching_draft(draft_id)


ONE_LINE_SYMBOL_TYPES = {
    "source", "bus", "line", "junction", "terminal", "ground", "disconnect",
    "breaker", "fuse", "transformer", "generator", "motor", "capacitor", "reactor",
    "battery", "surge-arrester", "load", "ct", "vt", "relay", "lockout",
}


def _normalise_one_line_record(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("schematic record must be a JSON object")
    raw_symbols = value.get("symbols", [])
    raw_edges = value.get("edges", [])
    if not isinstance(raw_symbols, list) or not isinstance(raw_edges, list):
        raise ValueError("schematic symbols and edges must be arrays")
    symbols: list[dict[str, Any]] = []
    used: set[str] = set()
    for index, item in enumerate(raw_symbols[:500], 1):
        if not isinstance(item, dict) or item.get("type") not in ONE_LINE_SYMBOL_TYPES:
            continue
        raw_id = _switching_clip(item.get("id"), 80)
        symbol_id = "".join(c for c in raw_id if c.isalnum() or c in "-_.") or f"S-{index:03d}"
        if symbol_id in used:
            symbol_id = f"S-{index:03d}"
        used.add(symbol_id)
        symbols.append({
            "id": symbol_id,
            "type": item["type"],
            "x": _bounded_int(item.get("x"), 0, 1000, 100),
            "y": _bounded_int(item.get("y"), 0, 560, 100),
            "rotation": _bounded_int(item.get("rotation"), 0, 270, 0) // 90 * 90,
            "label": _switching_clip(item.get("label"), 160),
            "deviceFunction": _switching_clip(item.get("deviceFunction"), 80),
        })
    edges: list[dict[str, str]] = []
    pairs: set[tuple[str, str]] = set()
    for index, item in enumerate(raw_edges[:1000], 1):
        if not isinstance(item, dict):
            continue
        start = _switching_clip(item.get("from"), 80)
        end = _switching_clip(item.get("to"), 80)
        pair = tuple(sorted((start, end)))
        if start not in used or end not in used or start == end or pair in pairs:
            continue
        pairs.add(pair)
        edges.append({"id": f"E-{index:03d}", "from": start, "to": end})
    record = {
        "version": 2,
        "state": "draft",
        "symbolLibraryProfile": "NorthStar IEEE compatibility profile v2",
        "graphicalStandard": "IEEE/ANSI 315-1975 convention (inactive-reserved)",
        "designationStandard": "IEEE C37.2-2022",
        "symbols": symbols,
        "edges": edges,
        "provenanceLabel": "SERVER DRAFT · NOT OPERATIONAL RELEASE",
    }
    encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > 512 * 1024:
        raise ValueError("schematic record exceeds 512 KB")
    return record


def _schematic_document_record(
    row: sqlite3.Row, include_record: bool = True, history: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": row["id"],
        "name": row["name"],
        "outageId": row["outage_id"],
        "standardApprovalRef": row["standard_approval_ref"],
        "revision": row["current_revision"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "createdBy": row["created_by"],
        "updatedBy": row["updated_by"],
    }
    try:
        payload = json.loads(row["current_payload"] or "{}")
    except json.JSONDecodeError:
        payload = {}
    record["symbolCount"] = len(payload.get("symbols", [])) if isinstance(payload, dict) else 0
    record["connectionCount"] = len(payload.get("edges", [])) if isinstance(payload, dict) else 0
    if include_record:
        record["record"] = payload
    if history is not None:
        record["history"] = history
    return record


def _validate_schematic_outage(connection: sqlite3.Connection, outage_id: str) -> None:
    if outage_id and connection.execute("SELECT 1 FROM outages WHERE id=?", (outage_id,)).fetchone() is None:
        raise ValueError("linked outage not found")


def create_one_line_document(payload: dict[str, Any], actor: str = "operator") -> dict[str, Any]:
    name = _switching_clip(payload.get("name"), 160) or "Untitled one-line"
    outage_id = _switching_clip(payload.get("outageId"), 120)
    approval_ref = _switching_clip(payload.get("standardApprovalRef"), 240)
    record = _normalise_one_line_record(payload.get("record"))
    encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    timestamp = now_iso()
    actor = _switching_clip(actor, 80) or "operator"
    with _LOCK, _session() as connection:
        _validate_schematic_outage(connection, outage_id)
        document_id = _unique_id(connection, "one_line_documents", "schematic")
        connection.execute(
            "INSERT INTO one_line_documents"
            " (id,name,outage_id,standard_approval_ref,current_revision,current_payload,created_at,updated_at,created_by,updated_by)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (document_id, name, outage_id, approval_ref, 1, encoded, timestamp, timestamp, actor, actor),
        )
        connection.execute(
            "INSERT INTO one_line_revisions(document_id,revision,payload,sha256,at,actor) VALUES (?,?,?,?,?,?)",
            (document_id, 1, encoded, digest, timestamp, actor),
        )
    return get_one_line_document(document_id)  # type: ignore[return-value]


def save_one_line_document(
    document_id: str, payload: dict[str, Any], actor: str = "operator"
) -> dict[str, Any] | None:
    actor = _switching_clip(actor, 80) or "operator"
    expected = _bounded_int(payload.get("revision"), 0, 1000000)
    name = _switching_clip(payload.get("name"), 160) or "Untitled one-line"
    outage_id = _switching_clip(payload.get("outageId"), 120)
    approval_ref = _switching_clip(payload.get("standardApprovalRef"), 240)
    record = _normalise_one_line_record(payload.get("record"))
    encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    with _LOCK, _session() as connection:
        row = connection.execute(
            "SELECT * FROM one_line_documents WHERE id=?", (document_id,)
        ).fetchone()
        if row is None:
            return None
        if expected and expected != row["current_revision"]:
            raise SchematicConflict(
                f"stale schematic revision; server is at revision {row['current_revision']}"
            )
        _validate_schematic_outage(connection, outage_id)
        revision = row["current_revision"] + 1
        timestamp = now_iso()
        connection.execute(
            "UPDATE one_line_documents SET name=?,outage_id=?,standard_approval_ref=?,current_revision=?,current_payload=?,updated_at=?,updated_by=? WHERE id=?",
            (name, outage_id, approval_ref, revision, encoded, timestamp, actor, document_id),
        )
        connection.execute(
            "INSERT INTO one_line_revisions(document_id,revision,payload,sha256,at,actor) VALUES (?,?,?,?,?,?)",
            (document_id, revision, encoded, digest, timestamp, actor),
        )
    return get_one_line_document(document_id)


def get_one_line_document(document_id: str, revision: int | None = None) -> dict[str, Any] | None:
    with _LOCK, _session() as connection:
        row = connection.execute(
            "SELECT * FROM one_line_documents WHERE id=?", (document_id,)
        ).fetchone()
        if row is None:
            return None
        history_rows = connection.execute(
            "SELECT revision,sha256,at,actor FROM one_line_revisions WHERE document_id=? ORDER BY revision DESC",
            (document_id,),
        ).fetchall()
        record = _schematic_document_record(
            row,
            True,
            [dict(item) for item in history_rows],
        )
        if revision is not None and revision != row["current_revision"]:
            revision_row = connection.execute(
                "SELECT payload FROM one_line_revisions WHERE document_id=? AND revision=?",
                (document_id, revision),
            ).fetchone()
            if revision_row is None:
                return None
            record["record"] = json.loads(revision_row["payload"])
            record["revision"] = revision
        return record


def list_one_line_documents(
    query: str | None = None, outage_id: str | None = None, limit: int = 100
) -> list[dict[str, Any]]:
    query = _switching_clip(query, 160)
    outage_id = _switching_clip(outage_id, 120)
    limit = max(1, min(limit, 500))
    clauses: list[str] = []
    values: list[Any] = []
    if query:
        clauses.append("(name LIKE ? OR id LIKE ? OR standard_approval_ref LIKE ?)")
        pattern = f"%{query}%"
        values.extend([pattern, pattern, pattern])
    if outage_id:
        clauses.append("outage_id=?")
        values.append(outage_id)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    with _LOCK, _session() as connection:
        rows = connection.execute(
            f"SELECT * FROM one_line_documents{where} ORDER BY updated_at DESC,id DESC LIMIT ?",
            (*values, limit),
        ).fetchall()
    return [_schematic_document_record(row, False) for row in rows]


def _append_outage_event(
    connection: sqlite3.Connection,
    *,
    outage_id: str,
    actor: str,
    event: str,
    site: str,
    prior_status: str | None,
    new_status: str | None,
    details: str = "",
    at: str | None = None,
) -> None:
    timestamp = at or now_iso()
    stored_actor = actor[:80]
    stored_event = event[:60]
    stored_site = site[:80]
    stored_details = details[:2000]
    connection.execute(
        "INSERT INTO outage_events"
        " (outage_id, at, actor, event, site, prior_status, new_status, details)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (
            outage_id,
            timestamp,
            stored_actor,
            stored_event,
            stored_site,
            prior_status,
            new_status,
            stored_details,
        ),
    )
    events.append_event(
        connection,
        event_type=events.event_type("outage", stored_event),
        occurred_at=timestamp,
        actor_id=stored_actor,
        aggregate_type="outage",
        aggregate_id=outage_id,
        source="outages",
        severity="warning" if new_status == "Open" else "info",
        summary=f"{stored_site}: {stored_event}",
        payload={
            "site": stored_site,
            "priorStatus": prior_status,
            "newStatus": new_status,
            "details": stored_details,
        },
    )


def create_outage(payload: dict[str, Any], actor: str = "operator") -> dict[str, Any]:
    """Open an outage record. Raises ValueError when the title is missing."""
    title = str(payload.get("title", "")).strip()[:160]
    if not title:
        raise ValueError("title is required")
    outage_type = str(payload.get("type", "Unplanned")).strip().title()
    if outage_type not in {"Planned", "Unplanned"}:
        outage_type = "Unplanned"
    asset = str(payload.get("asset", "")).strip()[:160]
    timestamp = now_iso()
    actor = actor.strip()[:80] or "operator"
    with _LOCK, _session() as connection:
        record_id = _unique_id(connection, "outages", "outage")
        connection.execute(
            "INSERT INTO outages"
            " (id, title, asset, site, severity, outage_type, details, status, opened_at, opened_by)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                record_id,
                title,
                asset,
                str(payload.get("site", "System / transmission")).strip()[:80],
                str(payload.get("severity", "Monitor")).strip()[:30],
                outage_type,
                str(payload.get("details", "")).strip()[:4000],
                "Open",
                timestamp,
                actor,
            ),
        )
        _append_outage_event(
            connection,
            outage_id=record_id,
            actor=actor,
            event="opened",
            site=str(payload.get("site", "System / transmission")).strip()[:80],
            prior_status=None,
            new_status="Open",
            details=str(payload.get("details", "")).strip(),
            at=timestamp,
        )
        row = connection.execute("SELECT * FROM outages WHERE id=?", (record_id,)).fetchone()
    return _outage_record(row)


def _outage_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "asset": row["asset"],
        "site": row["site"],
        "severity": row["severity"],
        "type": row["outage_type"],
        "details": row["details"],
        "status": row["status"],
        "openedAt": row["opened_at"],
        "openedBy": row["opened_by"],
        "closedAt": row["closed_at"],
        "closedBy": row["closed_by"],
    }


def list_outages() -> list[dict[str, Any]]:
    with _LOCK, _session() as connection:
        rows = connection.execute("SELECT * FROM outages ORDER BY opened_at DESC, id DESC").fetchall()
    return [_outage_record(row) for row in rows]


def get_outage(outage_id: str) -> dict[str, Any] | None:
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM outages WHERE id=?", (outage_id,)).fetchone()
    return _outage_record(row) if row else None


def close_outage(
    outage_id: str, actor: str = "operator", details: str = ""
) -> dict[str, Any] | None:
    """Close an outage. The record is retained; closing twice is a no-op."""
    actor = actor.strip()[:80] or "operator"
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM outages WHERE id=?", (outage_id,)).fetchone()
        if row is None:
            return None
        if row["status"] != "Closed":
            timestamp = now_iso()
            connection.execute(
                "UPDATE outages SET status='Closed', closed_at=?, closed_by=? WHERE id=?",
                (timestamp, actor, outage_id),
            )
            _append_outage_event(
                connection,
                outage_id=outage_id,
                actor=actor,
                event="closed",
                site=row["site"],
                prior_status=row["status"],
                new_status="Closed",
                details=details or "outage marked closed",
                at=timestamp,
            )
            row = connection.execute("SELECT * FROM outages WHERE id=?", (outage_id,)).fetchone()
    return _outage_record(row)


def outage_history(outage_id: str | None = None, limit: int = 250) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 1000))
    with _LOCK, _session() as connection:
        if outage_id:
            rows = connection.execute(
                "SELECT * FROM outage_events WHERE outage_id=? ORDER BY seq DESC LIMIT ?",
                (outage_id, limit),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM outage_events ORDER BY seq DESC LIMIT ?", (limit,)
            ).fetchall()
    return [
        {
            "seq": row["seq"],
            "outageId": row["outage_id"],
            "at": row["at"],
            "actor": row["actor"],
            "event": row["event"],
            "site": row["site"],
            "priorStatus": row["prior_status"],
            "newStatus": row["new_status"],
            "details": row["details"],
        }
        for row in rows
    ]


def set_alert_setting(payload: dict[str, Any]) -> dict[str, Any]:
    """Upsert one node's alert thresholds. Raises ValueError on an unusable setting."""
    node = str(payload.get("node", "")).strip()[:40]
    if not node:
        raise ValueError("node is required")

    def limit(key: str) -> float | None:
        value = payload.get(key)
        if value is None or value == "":
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{key} must be a number or empty") from None

    low, high = limit("low"), limit("high")
    # Overlapping limits would leave the node permanently in alarm on both
    # sides, so the setting is rejected rather than saved and left to misfire.
    if low is not None and high is not None and low >= high:
        raise ValueError("low must be below high")

    record = {
        "node": node,
        "low": low,
        "high": high,
        "actions": payload.get("actions", []),
        "enabled": bool(payload.get("enabled", True)),
        "updatedAt": now_iso(),
    }
    with _LOCK, _session() as connection:
        connection.execute(
            "INSERT INTO alert_settings (node, low, high, actions, enabled, updated_at)"
            " VALUES (?,?,?,?,?,?) ON CONFLICT(node) DO UPDATE SET"
            " low=excluded.low, high=excluded.high, actions=excluded.actions,"
            " enabled=excluded.enabled, updated_at=excluded.updated_at",
            (
                node,
                record["low"],
                record["high"],
                json.dumps(record["actions"]),
                int(record["enabled"]),
                record["updatedAt"],
            ),
        )
    return record


def _alert_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "node": row["node"],
        "kind": row["kind"],
        "threshold": row["threshold"],
        "state": row["state"],
        "openedAt": row["opened_at"],
        "openingPrice": row["opening_price"],
        # The dashboard banner reads `price`; it is the latest observed value,
        # not the value at the moment the alarm was raised.
        "price": row["last_price"],
        "lastSeen": row["last_seen"],
        "peakPrice": row["peak_price"],
        "acknowledgedAt": row["acknowledged_at"],
        "acknowledgedBy": row["acknowledged_by"],
        "resolvedAt": row["resolved_at"],
        "resolvedPrice": row["resolved_price"],
        "actions": json.loads(row["actions"]),
    }


def _append_alert_event(
    connection: sqlite3.Connection,
    *,
    alert_id: str,
    actor: str,
    event: str,
    node: str,
    prior_state: str | None,
    new_state: str | None,
    price: float | None = None,
    details: str = "",
    at: str | None = None,
) -> None:
    timestamp = at or now_iso()
    stored_details = details[:2000]
    connection.execute(
        "INSERT INTO alert_events"
        " (alert_id, at, actor, event, node, prior_state, new_state, price, details)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (alert_id, timestamp, actor, event, node, prior_state, new_state, price, stored_details),
    )
    events.append_event(
        connection,
        event_type=events.event_type("market", event),
        occurred_at=timestamp,
        actor_id=actor,
        aggregate_type="price_alert",
        aggregate_id=alert_id,
        source="market",
        severity="warning" if new_state in ALERT_OPEN_STATES else "info",
        summary=f"{node}: {event}",
        payload={
            "node": node,
            "priorState": prior_state,
            "newState": new_state,
            "price": price,
            "details": stored_details,
        },
    )


def _breach_threshold(setting: dict[str, Any], kind: str) -> float | None:
    """The configured limit for one side, or None when that side is not set."""
    if not setting or not setting.get("enabled"):
        return None
    value = setting.get("high") if kind == "high" else setting.get("low")
    return None if value is None else float(value)


def _still_breaching(kind: str, price: float, threshold: float) -> bool:
    """True while the excursion continues, using the recovery margin as hysteresis."""
    if kind == "high":
        return price > threshold - ALERT_RECOVERY_MARGIN
    return price < threshold + ALERT_RECOVERY_MARGIN


def evaluate_price_alerts(
    prices: dict[str, float | None], reference: datetime | None = None
) -> dict[str, list[dict[str, Any]]]:
    """Compare live prices against the stored thresholds and move alert state.

    Runs on the server against every market refresh, so an excursion is caught
    and recorded whether or not anyone has the dashboard open. Returns the
    alerts that changed state on this pass: ``{"raised": [...], "resolved": [...]}``.

    An alert is raised the moment the price touches the limit and only resolves
    once it is back inside by ``ALERT_RECOVERY_MARGIN``. Acknowledging does not
    resolve — the operator confirms they have seen it, the data decides when the
    condition is over. Nothing is ever deleted; each transition appends an event.
    """
    reference = reference or datetime.now(TZ)
    timestamp = reference.isoformat()
    raised: list[dict[str, Any]] = []
    resolved: list[dict[str, Any]] = []

    with _LOCK, _session() as connection:
        settings = {
            row["node"]: {
                "low": row["low"],
                "high": row["high"],
                "actions": json.loads(row["actions"]),
                "enabled": bool(row["enabled"]),
            }
            for row in connection.execute("SELECT * FROM alert_settings").fetchall()
        }
        placeholders = ",".join("?" for _ in ALERT_OPEN_STATES)
        open_rows = connection.execute(
            f"SELECT * FROM alerts WHERE state IN ({placeholders})", ALERT_OPEN_STATES
        ).fetchall()

        # Close first, so a threshold edited mid-excursion can re-raise against
        # the new limit on this same pass rather than waiting for the next one.
        still_open: set[tuple[str, str]] = set()
        for row in open_rows:
            node, kind = row["node"], row["kind"]
            price = prices.get(node)
            threshold = _breach_threshold(settings.get(node, {}), kind)

            if threshold is None:
                reason = "alerting disabled or threshold cleared for this node"
            elif threshold != row["threshold"]:
                reason = f"threshold changed from {row['threshold']} to {threshold}"
            elif price is None:
                # No price this pass. Hold the alarm rather than clearing it on
                # missing data: a dead feed is not a recovery.
                still_open.add((node, kind))
                continue
            elif _still_breaching(kind, float(price), float(row["threshold"])):
                peak = (
                    max(row["peak_price"], float(price))
                    if kind == "high"
                    else min(row["peak_price"], float(price))
                )
                connection.execute(
                    "UPDATE alerts SET last_price=?, last_seen=?, peak_price=? WHERE id=?",
                    (float(price), timestamp, peak, row["id"]),
                )
                still_open.add((node, kind))
                continue
            else:
                reason = f"price returned inside the limit (margin {ALERT_RECOVERY_MARGIN})"

            connection.execute(
                "UPDATE alerts SET state=?, resolved_at=?, resolved_price=?,"
                " last_price=COALESCE(?, last_price), last_seen=? WHERE id=?",
                (ALERT_RESOLVED, timestamp, price, price, timestamp, row["id"]),
            )
            _append_alert_event(
                connection,
                alert_id=row["id"],
                actor="northstar-monitor",
                event="resolved",
                node=node,
                prior_state=row["state"],
                new_state=ALERT_RESOLVED,
                price=price,
                details=reason,
                at=timestamp,
            )
            closed = connection.execute("SELECT * FROM alerts WHERE id=?", (row["id"],)).fetchone()
            resolved.append(_alert_record(closed))

        for node, price in prices.items():
            if price is None:
                continue
            setting = settings.get(node, {})
            for kind in ("high", "low"):
                threshold = _breach_threshold(setting, kind)
                if threshold is None or (node, kind) in still_open:
                    continue
                breaching = price >= threshold if kind == "high" else price <= threshold
                if not breaching:
                    continue
                alert_id = _unique_id(connection, "alerts", "alert")
                actions = json.dumps(setting.get("actions", []))
                connection.execute(
                    "INSERT INTO alerts (id, node, kind, threshold, state, opened_at,"
                    " opening_price, last_price, last_seen, peak_price, actions)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        alert_id,
                        node,
                        kind,
                        threshold,
                        ALERT_ACTIVE,
                        timestamp,
                        float(price),
                        float(price),
                        timestamp,
                        float(price),
                        actions,
                    ),
                )
                _append_alert_event(
                    connection,
                    alert_id=alert_id,
                    actor="northstar-monitor",
                    event="raised",
                    node=node,
                    prior_state=None,
                    new_state=ALERT_ACTIVE,
                    price=float(price),
                    details=f"{kind} limit {threshold} reached at {price}",
                    at=timestamp,
                )
                still_open.add((node, kind))
                row = connection.execute("SELECT * FROM alerts WHERE id=?", (alert_id,)).fetchone()
                raised.append(_alert_record(row))

    return {"raised": raised, "resolved": resolved}


def acknowledge_alert(alert_id: str, actor: str = "operator") -> dict[str, Any] | None:
    """Record that an operator has seen an alarm.

    Silences it without ending it: the record stays open until the price
    recovers. Acknowledging anything not currently active is a no-op, so a
    double-click cannot rewrite the first acknowledgement.
    """
    timestamp = now_iso()
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM alerts WHERE id=?", (alert_id,)).fetchone()
        if row is None:
            return None
        if row["state"] != ALERT_ACTIVE:
            return _alert_record(row)
        connection.execute(
            "UPDATE alerts SET state=?, acknowledged_at=?, acknowledged_by=? WHERE id=?",
            (ALERT_ACKNOWLEDGED, timestamp, actor[:80], alert_id),
        )
        _append_alert_event(
            connection,
            alert_id=alert_id,
            actor=actor[:80],
            event="acknowledged",
            node=row["node"],
            prior_state=ALERT_ACTIVE,
            new_state=ALERT_ACKNOWLEDGED,
            price=row["last_price"],
            details="operator acknowledged; condition still active",
            at=timestamp,
        )
        row = connection.execute("SELECT * FROM alerts WHERE id=?", (alert_id,)).fetchone()
    return _alert_record(row)


def list_alerts(include_resolved: bool = False, limit: int = 250) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 1000))
    with _LOCK, _session() as connection:
        if include_resolved:
            rows = connection.execute(
                "SELECT * FROM alerts ORDER BY opened_at DESC, id DESC LIMIT ?", (limit,)
            ).fetchall()
        else:
            placeholders = ",".join("?" for _ in ALERT_OPEN_STATES)
            rows = connection.execute(
                f"SELECT * FROM alerts WHERE state IN ({placeholders})"
                " ORDER BY opened_at DESC, id DESC LIMIT ?",
                (*ALERT_OPEN_STATES, limit),
            ).fetchall()
    return [_alert_record(row) for row in rows]


def alert_history(alert_id: str | None = None, limit: int = 250) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 1000))
    with _LOCK, _session() as connection:
        if alert_id:
            rows = connection.execute(
                "SELECT * FROM alert_events WHERE alert_id=? ORDER BY seq DESC LIMIT ?",
                (alert_id, limit),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM alert_events ORDER BY seq DESC LIMIT ?", (limit,)
            ).fetchall()
    return [
        {
            "seq": row["seq"],
            "alertId": row["alert_id"],
            "at": row["at"],
            "actor": row["actor"],
            "event": row["event"],
            "node": row["node"],
            "priorState": row["prior_state"],
            "newState": row["new_state"],
            "price": row["price"],
            "details": row["details"],
        }
        for row in rows
    ]


def list_alert_settings() -> dict[str, dict[str, Any]]:
    with _LOCK, _session() as connection:
        rows = connection.execute("SELECT * FROM alert_settings").fetchall()
    return {
        row["node"]: {
            "node": row["node"],
            "low": row["low"],
            "high": row["high"],
            "actions": json.loads(row["actions"]),
            "enabled": bool(row["enabled"]),
            "updatedAt": row["updated_at"],
        }
        for row in rows
    }


def _field_report_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "station": row["station"], "area": row["area"],
        "category": row["category"], "priority": row["priority"], "title": row["title"],
        "conditions": row["conditions"], "immediateActions": row["immediate_actions"],
        "impact": row["impact"], "clarificationRequest": row["clarification_request"],
        "outstandingWork": row["outstanding_work"], "status": row["status"],
        "assignedTo": row["assigned_to"], "outageId": row["outage_id"],
        "version": row["record_version"], "createdAt": row["created_at"],
        "createdBy": row["created_by"], "updatedAt": row["updated_at"],
        "updatedBy": row["updated_by"],
        "escalatedAt": row["escalated_at"], "escalatedBy": row["escalated_by"],
    }


def _append_field_event(connection: sqlite3.Connection, report_id: str, actor: str,
                        event: str, prior: str | None, new: str | None, details: str = "") -> None:
    timestamp = now_iso()
    stored_details = details.strip()[:4000]
    connection.execute(
        "INSERT INTO field_report_events (report_id,at,actor,event,prior_status,new_status,details)"
        " VALUES (?,?,?,?,?,?,?)",
        (report_id, timestamp, actor, event, prior, new, stored_details),
    )
    events.append_event(
        connection, event_type=events.event_type("field_operations", event), occurred_at=timestamp,
        actor_id=actor, aggregate_type="field_report", aggregate_id=report_id,
        source="field_operations", severity="warning" if event in {"submitted", "reopened"} else "info",
        summary=event.replace("_", " ").title(),
        payload={"priorStatus": prior, "newStatus": new, "details": stored_details},
    )


def create_field_report(payload: dict[str, Any], actor: str) -> dict[str, Any]:
    station = str(payload.get("station", "")).strip()[:120]
    title = str(payload.get("title", "")).strip()[:200]
    conditions = str(payload.get("conditions", "")).strip()[:8000]
    if not station or not title or not conditions:
        raise ValueError("station, title, and conditions are required")
    status = str(payload.get("status", "SUBMITTED")).strip().upper()
    if status not in {"DRAFT", "SUBMITTED"}:
        status = "SUBMITTED"
    priority = str(payload.get("priority", "ROUTINE")).strip().upper()
    if priority not in {"ROUTINE", "PRIORITY", "URGENT"}:
        priority = "ROUTINE"
    category = str(payload.get("category", "FIELD CONDITION")).strip().upper()[:80]
    timestamp = now_iso()
    actor = actor.strip()[:160] or "operator console"
    with _LOCK, _session() as connection:
        report_id = _unique_id(connection, "field_reports", "field")
        connection.execute(
            "INSERT INTO field_reports (id,station,area,category,priority,title,conditions,"
            "immediate_actions,outstanding_work,status,assigned_to,outage_id,created_at,created_by,"
            "updated_at,updated_by,impact) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (report_id, station, str(payload.get("area", "")).strip()[:160], category, priority,
             title, conditions, str(payload.get("immediateActions", "")).strip()[:4000],
             str(payload.get("outstandingWork", "")).strip()[:4000], status,
             str(payload.get("assignedTo", "")).strip()[:160],
             str(payload.get("outageId", "")).strip()[:120], timestamp, actor, timestamp, actor,
             str(payload.get("impact", "")).strip()[:4000]),
        )
        _append_field_event(connection, report_id, actor, "drafted" if status == "DRAFT" else "submitted", None, status, title)
        row = connection.execute("SELECT * FROM field_reports WHERE id=?", (report_id,)).fetchone()
    return _field_report_record(row)


def list_field_reports(status: str | None = None, station: str | None = None,
                       limit: int = 250) -> list[dict[str, Any]]:
    clauses, args = [], []
    if status:
        clauses.append("status=?"); args.append(status.upper())
    if station:
        clauses.append("station=?"); args.append(station)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    args.append(max(1, min(limit, 1000)))
    with _LOCK, _session() as connection:
        rows = connection.execute(
            "SELECT * FROM field_reports" + where + " ORDER BY updated_at DESC,id DESC LIMIT ?", args
        ).fetchall()
    return [_field_report_record(row) for row in rows]


def get_field_report(report_id: str) -> dict[str, Any] | None:
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM field_reports WHERE id=?", (report_id,)).fetchone()
    return _field_report_record(row) if row else None


def transition_field_report(report_id: str, payload: dict[str, Any], actor: str) -> dict[str, Any] | None:
    target = str(payload.get("status", "")).strip().upper()
    if target not in FIELD_REPORT_STATES:
        raise ValueError("invalid field report status")
    actor = actor.strip()[:160] or "operator console"
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM field_reports WHERE id=?", (report_id,)).fetchone()
        if not row:
            return None
        expected = payload.get("version")
        if expected is not None and int(expected) != row["record_version"]:
            raise ValueError("field report changed; refresh and try again")
        timestamp = now_iso()
        assigned = str(payload.get("assignedTo", row["assigned_to"])).strip()[:160]
        clarification = str(payload.get("clarificationRequest", row["clarification_request"])).strip()[:4000]
        escalated = bool(payload.get("escalated"))
        connection.execute(
            "UPDATE field_reports SET status=?,assigned_to=?,clarification_request=?,"
            "escalated_at=CASE WHEN ? THEN ? ELSE escalated_at END,"
            "escalated_by=CASE WHEN ? THEN ? ELSE escalated_by END,record_version=record_version+1,"
            "updated_at=?,updated_by=? WHERE id=?",
            (target, assigned, clarification, escalated, timestamp, escalated, actor,
             timestamp, actor, report_id),
        )
        _append_field_event(connection, report_id, actor, "status_changed", row["status"], target,
                            str(payload.get("details", "")))
        row = connection.execute("SELECT * FROM field_reports WHERE id=?", (report_id,)).fetchone()
    return _field_report_record(row)


def add_field_report_update(report_id: str, payload: dict[str, Any], actor: str) -> dict[str, Any] | None:
    details = str(payload.get("details", "")).strip()[:8000]
    if not details:
        raise ValueError("update details are required")
    actor = actor.strip()[:160] or "operator console"
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM field_reports WHERE id=?", (report_id,)).fetchone()
        if not row:
            return None
        connection.execute("UPDATE field_reports SET record_version=record_version+1,updated_at=?,updated_by=? WHERE id=?",
                           (now_iso(), actor, report_id))
        _append_field_event(connection, report_id, actor, "update_added", row["status"], row["status"], details)
        row = connection.execute("SELECT * FROM field_reports WHERE id=?", (report_id,)).fetchone()
    return _field_report_record(row)


MAX_FIELD_ATTACHMENT_BYTES = 10 * 1024 * 1024


def add_field_report_attachment(report_id: str, filename: str, content_type: str,
                                content: bytes, actor: str) -> dict[str, Any] | None:
    filename = Path(filename).name.strip()[:255]
    if not filename or not content:
        raise ValueError("attachment filename and content are required")
    if len(content) > MAX_FIELD_ATTACHMENT_BYTES:
        raise ValueError("field attachment exceeds 10 MB")
    digest, timestamp = hashlib.sha256(content).hexdigest(), now_iso()
    with _LOCK, _session() as connection:
        report = connection.execute("SELECT * FROM field_reports WHERE id=?", (report_id,)).fetchone()
        if not report:
            return None
        attachment_id = _unique_id(connection, "field_report_attachments", "fieldfile")
        connection.execute("INSERT INTO field_report_attachments (id,report_id,filename,content_type,size_bytes,sha256,content,uploaded_at,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)",
                           (attachment_id, report_id, filename, content_type[:120] or "application/octet-stream", len(content), digest, content, timestamp, actor[:160]))
        _append_field_event(connection, report_id, actor[:160], "attachment_added", report["status"], report["status"], f"{filename} · {digest}")
    return {"attachmentId": attachment_id, "reportId": report_id, "name": filename,
            "type": content_type[:120], "size": len(content), "sha256": digest,
            "uploadedAt": timestamp, "uploadedBy": actor[:160]}


def list_field_report_attachments(report_id: str) -> list[dict[str, Any]]:
    with _LOCK, _session() as connection:
        rows = connection.execute("SELECT id,report_id,filename,content_type,size_bytes,sha256,uploaded_at,uploaded_by FROM field_report_attachments WHERE report_id=? ORDER BY uploaded_at DESC", (report_id,)).fetchall()
    return [{"attachmentId": r["id"], "reportId": r["report_id"], "name": r["filename"],
             "type": r["content_type"], "size": r["size_bytes"], "sha256": r["sha256"],
             "uploadedAt": r["uploaded_at"], "uploadedBy": r["uploaded_by"]} for r in rows]


def get_field_report_attachment(report_id: str, attachment_id: str) -> dict[str, Any] | None:
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM field_report_attachments WHERE report_id=? AND id=?", (report_id, attachment_id)).fetchone()
    if not row: return None
    return {"name": row["filename"], "type": row["content_type"], "size": row["size_bytes"],
            "sha256": row["sha256"], "content": row["content"]}


def field_report_history(report_id: str | None = None, limit: int = 250) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 1000))
    with _LOCK, _session() as connection:
        rows = connection.execute(
            "SELECT * FROM field_report_events" + (" WHERE report_id=?" if report_id else "") +
            " ORDER BY seq DESC LIMIT ?", ((report_id, limit) if report_id else (limit,))
        ).fetchall()
    return [{"seq": r["seq"], "reportId": r["report_id"], "at": r["at"], "actor": r["actor"],
             "event": r["event"], "priorStatus": r["prior_status"], "newStatus": r["new_status"],
             "details": r["details"]} for r in rows]


def _action_record(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "reportId": row["report_id"], "station": row["station"],
            "title": row["title"], "details": row["details"], "priority": row["priority"],
            "status": row["status"], "assignedTo": row["assigned_to"], "dueAt": row["due_at"],
            "version": row["record_version"], "createdAt": row["created_at"],
            "createdBy": row["created_by"], "updatedAt": row["updated_at"], "updatedBy": row["updated_by"],
            "closureCriteria": row["closure_criteria"], "resolutionEvidence": row["resolution_evidence"],
            "verifiedBy": row["verified_by"], "verifiedAt": row["verified_at"],
            "escalatedAt": row["escalated_at"], "escalatedBy": row["escalated_by"]}


def create_action_item(payload: dict[str, Any], actor: str) -> dict[str, Any]:
    station, title = str(payload.get("station", "")).strip()[:120], str(payload.get("title", "")).strip()[:200]
    if not station or not title:
        raise ValueError("station and title are required")
    priority = str(payload.get("priority", "ROUTINE")).strip().upper()
    if priority not in {"ROUTINE", "PRIORITY", "URGENT"}: priority = "ROUTINE"
    actor, timestamp = actor.strip()[:160] or "operator console", now_iso()
    with _LOCK, _session() as connection:
        action_id = _unique_id(connection, "action_items", "action")
        connection.execute(
            "INSERT INTO action_items (id,report_id,station,title,details,priority,status,assigned_to,due_at,"
            "created_at,created_by,updated_at,updated_by,closure_criteria) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (action_id, str(payload.get("reportId", "")).strip()[:120], station, title,
             str(payload.get("details", "")).strip()[:4000], priority, "OPEN",
             str(payload.get("assignedTo", "")).strip()[:160], payload.get("dueAt") or None,
             timestamp, actor, timestamp, actor, str(payload.get("closureCriteria", "")).strip()[:4000]),
        )
        connection.execute("INSERT INTO action_item_events (action_id,at,actor,event,prior_status,new_status,details) VALUES (?,?,?,?,?,?,?)",
                           (action_id, timestamp, actor, "created", None, "OPEN", title))
        events.append_event(connection, event_type="field_operations.action.created", occurred_at=timestamp,
                            actor_id=actor, aggregate_type="action_item", aggregate_id=action_id,
                            source="field_operations", summary=title, payload={"station": station, "reportId": payload.get("reportId", "")})
        row = connection.execute("SELECT * FROM action_items WHERE id=?", (action_id,)).fetchone()
    return _action_record(row)


def list_action_items(include_closed: bool = False, limit: int = 250) -> list[dict[str, Any]]:
    with _LOCK, _session() as connection:
        rows = connection.execute(
            "SELECT * FROM action_items" + ("" if include_closed else " WHERE status!='CLOSED'") +
            " ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'PRIORITY' THEN 1 ELSE 2 END,updated_at DESC LIMIT ?",
            (max(1, min(limit, 1000)),),
        ).fetchall()
    return [_action_record(row) for row in rows]


def transition_action_item(action_id: str, payload: dict[str, Any], actor: str) -> dict[str, Any] | None:
    target = str(payload.get("status", "")).strip().upper()
    if target not in ACTION_ITEM_STATES: raise ValueError("invalid action item status")
    actor = actor.strip()[:160] or "operator console"
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM action_items WHERE id=?", (action_id,)).fetchone()
        if not row: return None
        expected = payload.get("version")
        if expected is not None and int(expected) != row["record_version"]:
            raise ValueError("action item changed; refresh and try again")
        timestamp, assigned = now_iso(), str(payload.get("assignedTo", row["assigned_to"])).strip()[:160]
        evidence = str(payload.get("resolutionEvidence", row["resolution_evidence"])).strip()[:4000]
        if target in {"VERIFIED", "CLOSED"} and not (evidence or row["resolution_evidence"]):
            raise ValueError("resolution evidence is required before verification or closure")
        verified_by = actor if target in {"VERIFIED", "CLOSED"} else row["verified_by"]
        verified_at = timestamp if target in {"VERIFIED", "CLOSED"} else row["verified_at"]
        escalated = bool(payload.get("escalated"))
        due_at = payload.get("dueAt", row["due_at"]) or None
        connection.execute("UPDATE action_items SET status=?,assigned_to=?,due_at=?,resolution_evidence=?,verified_by=?,verified_at=?,"
                           "escalated_at=CASE WHEN ? THEN ? ELSE escalated_at END,escalated_by=CASE WHEN ? THEN ? ELSE escalated_by END,"
                           "record_version=record_version+1,updated_at=?,updated_by=? WHERE id=?",
                           (target, assigned, due_at, evidence, verified_by, verified_at, escalated, timestamp,
                            escalated, actor, timestamp, actor, action_id))
        connection.execute("INSERT INTO action_item_events (action_id,at,actor,event,prior_status,new_status,details) VALUES (?,?,?,?,?,?,?)",
                           (action_id, timestamp, actor, "status_changed", row["status"], target, str(payload.get("details", ""))[:4000]))
        events.append_event(connection, event_type="field_operations.action.status_changed", occurred_at=timestamp,
                            actor_id=actor, aggregate_type="action_item", aggregate_id=action_id,
                            source="field_operations", summary=f"{row['status']} → {target}", payload={"assignedTo": assigned})
        row = connection.execute("SELECT * FROM action_items WHERE id=?", (action_id,)).fetchone()
    return _action_record(row)


def field_operations_summary() -> dict[str, Any]:
    with _LOCK, _session() as connection:
        reports = connection.execute("SELECT * FROM field_reports ORDER BY updated_at DESC").fetchall()
        actions = connection.execute("SELECT * FROM action_items ORDER BY updated_at DESC").fetchall()
    now = datetime.now(TZ)
    report_records, action_records = [_field_report_record(r) for r in reports], [_action_record(r) for r in actions]
    open_reports = [r for r in report_records if r["status"] != "CLOSED"]
    open_actions = [a for a in action_records if a["status"] != "CLOSED"]
    overdue = [a for a in open_actions if a["dueAt"] and datetime.fromisoformat(a["dueAt"]) < now]
    stations = sorted({r["station"] for r in open_reports} | {a["station"] for a in open_actions})
    return {"generatedAt": now.isoformat(), "openReports": len(open_reports),
            "unacknowledged": sum(r["status"] == "SUBMITTED" for r in open_reports),
            "urgent": sum(r["priority"] == "URGENT" for r in open_reports),
            "openActions": len(open_actions), "overdueActions": len(overdue), "stations": stations,
            "reports": open_reports, "actions": open_actions}


def list_controlled_sources() -> list[dict[str, Any]]:
    with _LOCK, _session() as connection:
        rows = connection.execute("SELECT * FROM controlled_sources ORDER BY updated_at DESC").fetchall()
    return [{"id": r["id"], "sourceType": r["source_type"], "title": r["title"],
             "revision": r["revision"], "documentOwner": r["document_owner"],
             "effectiveAt": r["effective_at"], "referenceUri": r["reference_uri"],
             "sha256": r["sha256"], "status": r["status"], "notes": r["notes"],
             "updatedAt": r["updated_at"], "updatedBy": r["updated_by"]} for r in rows]


def save_controlled_source(payload: dict[str, Any], actor: str) -> dict[str, Any]:
    title, revision = str(payload.get("title", "")).strip()[:240], str(payload.get("revision", "")).strip()[:120]
    if not title or not revision: raise ValueError("source title and revision are required")
    status = str(payload.get("status", "PROPOSED")).strip().upper()
    if status not in {"PROPOSED", "CURRENT", "SUPERSEDED", "WITHDRAWN"}: raise ValueError("invalid controlled source status")
    source_type = str(payload.get("sourceType", "PROCEDURE")).strip().upper()[:80]
    if source_type not in {"PROCEDURE", "FORM", "TAG TEMPLATE", "STANDARD"}: raise ValueError("invalid controlled source type")
    document_owner = str(payload.get("documentOwner", "")).strip()[:160]
    effective_at = payload.get("effectiveAt") or None
    reference_uri = str(payload.get("referenceUri", "")).strip()[:1000]
    if status == "CURRENT" and (not document_owner or not effective_at or not reference_uri):
        raise ValueError("current sources require an owner, effective date, and controlled reference")
    source_id, timestamp = str(payload.get("id", "")).strip()[:120], now_iso()
    actor = actor.strip()[:160] or "operator console"
    with _LOCK, _session() as connection:
        if not source_id: source_id = _unique_id(connection, "controlled_sources", "source")
        existing = connection.execute("SELECT id FROM controlled_sources WHERE id=?", (source_id,)).fetchone()
        duplicate = connection.execute("SELECT id FROM controlled_sources WHERE lower(title)=lower(?) AND lower(revision)=lower(?) AND id<>?", (title, revision, source_id)).fetchone()
        if duplicate: raise ValueError("that controlled document revision is already registered")
        values = (source_type, title, revision, document_owner, effective_at,
                  reference_uri, str(payload.get("sha256", "")).strip().lower()[:64],
                  status, str(payload.get("notes", "")).strip()[:4000], timestamp, actor)
        if existing:
            connection.execute("UPDATE controlled_sources SET source_type=?,title=?,revision=?,document_owner=?,effective_at=?,reference_uri=?,sha256=?,status=?,notes=?,updated_at=?,updated_by=? WHERE id=?", (*values, source_id))
        else:
            connection.execute("INSERT INTO controlled_sources (id,source_type,title,revision,document_owner,effective_at,reference_uri,sha256,status,notes,created_at,created_by,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (source_id, *values[:9], timestamp, actor, timestamp, actor))
        events.append_event(connection, event_type="governance.controlled_source.saved", occurred_at=timestamp,
                            actor_id=actor, aggregate_type="controlled_source", aggregate_id=source_id,
                            source="governance", summary=f"{title} · {revision}", payload={"status": status})
    return next(item for item in list_controlled_sources() if item["id"] == source_id)


def list_assets() -> list[dict[str, Any]]:
    with _LOCK, _session() as connection:
        rows = connection.execute("SELECT * FROM asset_registry ORDER BY station,designation").fetchall()
    return [{"id": r["id"], "station": r["station"], "designation": r["designation"],
             "assetType": r["asset_type"], "description": r["description"],
             "topologyRevision": r["topology_revision"], "active": bool(r["active"]),
             "updatedAt": r["updated_at"], "updatedBy": r["updated_by"]} for r in rows]


def save_asset(payload: dict[str, Any], actor: str) -> dict[str, Any]:
    station, designation = str(payload.get("station", "")).strip()[:120], str(payload.get("designation", "")).strip()[:160]
    if not station or not designation: raise ValueError("station and designation are required")
    asset_id, timestamp = str(payload.get("id", "")).strip()[:120], now_iso(); actor = actor.strip()[:160] or "operator console"
    with _LOCK, _session() as connection:
        if not asset_id: asset_id = _unique_id(connection, "asset_registry", "asset")
        existing = connection.execute("SELECT id FROM asset_registry WHERE id=?", (asset_id,)).fetchone()
        duplicate = connection.execute("SELECT id FROM asset_registry WHERE lower(station)=lower(?) AND lower(designation)=lower(?) AND id<>?", (station, designation, asset_id)).fetchone()
        if duplicate: raise ValueError("that station and equipment designation is already registered")
        active_value = payload.get("active", True)
        active = active_value if isinstance(active_value, bool) else str(active_value).strip().lower() not in {"0", "false", "no", "off"}
        values = (station, designation, str(payload.get("assetType", "")).strip()[:80],
                  str(payload.get("description", "")).strip()[:1000], str(payload.get("topologyRevision", "")).strip()[:160],
                  1 if active else 0)
        if existing:
            connection.execute("UPDATE asset_registry SET station=?,designation=?,asset_type=?,description=?,topology_revision=?,active=?,updated_at=?,updated_by=? WHERE id=?", (*values, timestamp, actor, asset_id))
        else:
            connection.execute("INSERT INTO asset_registry (id,station,designation,asset_type,description,topology_revision,active,created_at,created_by,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)", (asset_id, *values, timestamp, actor, timestamp, actor))
        events.append_event(connection, event_type="governance.asset.saved", occurred_at=timestamp, actor_id=actor,
                            aggregate_type="asset", aggregate_id=asset_id, source="governance",
                            summary=f"{station} · {designation}", payload={"topologyRevision": values[4]})
    return next(item for item in list_assets() if item["id"] == asset_id)


def list_governance_decisions() -> list[dict[str, Any]]:
    with _LOCK, _session() as connection:
        rows = connection.execute("SELECT * FROM governance_decisions ORDER BY status,title").fetchall()
    return [{"id": r["id"], "key": r["decision_key"], "title": r["title"], "owner": r["owner"],
             "status": r["status"], "decision": r["decision"], "evidenceRef": r["evidence_ref"],
             "reviewDueAt": r["review_due_at"], "updatedAt": r["updated_at"], "updatedBy": r["updated_by"]} for r in rows]


def save_governance_decision(key: str, payload: dict[str, Any], actor: str) -> dict[str, Any] | None:
    status = str(payload.get("status", "OPEN")).strip().upper()
    if status not in {"OPEN", "IN REVIEW", "APPROVED", "BLOCKED"}: raise ValueError("invalid governance decision status")
    owner = str(payload.get("owner", "")).strip()[:160]
    decision = str(payload.get("decision", "")).strip()[:4000]
    evidence_ref = str(payload.get("evidenceRef", "")).strip()[:1000]
    if status == "APPROVED" and (not owner or not decision or not evidence_ref):
        raise ValueError("approved decisions require an owner, decision record, and evidence reference")
    timestamp, actor = now_iso(), actor.strip()[:160] or "operator console"
    with _LOCK, _session() as connection:
        row = connection.execute("SELECT * FROM governance_decisions WHERE decision_key=?", (key,)).fetchone()
        if not row: return None
        connection.execute("UPDATE governance_decisions SET owner=?,status=?,decision=?,evidence_ref=?,review_due_at=?,updated_at=?,updated_by=? WHERE decision_key=?",
                           (owner, status, decision, evidence_ref,
                            payload.get("reviewDueAt", row["review_due_at"]) or None, timestamp, actor, key))
        events.append_event(connection, event_type="governance.decision.updated", occurred_at=timestamp, actor_id=actor,
                            aggregate_type="governance_decision", aggregate_id=row["id"], source="governance",
                            summary=row["title"], payload={"status": status})
    return next(item for item in list_governance_decisions() if item["key"] == key)


def readiness_summary() -> dict[str, Any]:
    decisions, sources, assets = list_governance_decisions(), list_controlled_sources(), list_assets()
    approved = sum(item["status"] == "APPROVED" for item in decisions)
    current_sources = [item for item in sources if item["status"] == "CURRENT" and item["documentOwner"] and item["effectiveAt"] and item["referenceUri"]]
    active_assets = [item for item in assets if item["active"]]
    topology_missing = [item for item in active_assets if not item["topologyRevision"]]
    return {"decisions": decisions, "sources": sources, "assets": assets,
            "approvedDecisions": approved, "totalDecisions": len(decisions),
            "currentSources": len(current_sources), "registeredAssets": len(active_assets),
            "switchingReleaseEnabled": False,
            "releaseBlockers": [item["title"] for item in decisions if item["status"] != "APPROVED"] +
                               ([] if current_sources else ["No complete current authoritative source registered"]) +
                               ([] if active_assets else ["No active canonical assets registered"]) +
                               ([f"{len(topology_missing)} active asset(s) missing topology revision"] if topology_missing else [])}
