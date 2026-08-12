"""SQLite port of the NorthStar Phase 1 decision/schema addendum.

This module keeps the existing pilot's SQLite store and adds the pieces that
were specified in the SQL Server addendum: signed site QR tokens, optional
phone verification, explicit retention and escalation policy, and read-only
SCADA report ingestion.
"""

from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
TZ = ZoneInfo("America/Toronto")

DEFAULT_SITES = (
    ("APIROQ", "Iroquois Falls"),
    ("M1S", "Island Falls"),
    ("F2B", "Fort Frances"),
    ("K2M CCTS", "Kenora"),
)
SITE_ALIASES = {
    "apiroq": ("APIROQ", "Iroquois Falls"),
    "iroquois falls": ("APIROQ", "Iroquois Falls"),
    "m1s": ("M1S", "Island Falls"),
    "island falls": ("M1S", "Island Falls"),
    "f2b": ("F2B", "Fort Frances"),
    "fort frances": ("F2B", "Fort Frances"),
    "k2m ccts": ("K2M CCTS", "Kenora"),
    "k2m": ("K2M CCTS", "Kenora"),
    "kenora": ("K2M CCTS", "Kenora"),
    "kenora / norman": ("K2M CCTS", "Kenora"),
    "kenora / norman gs": ("K2M CCTS", "Kenora"),
}

PHASE1_SCHEMA = """
CREATE TABLE IF NOT EXISTS site_tokens (
    token_id          TEXT PRIMARY KEY,
    site_code         TEXT NOT NULL,
    site              TEXT NOT NULL,
    signing_key_id    TEXT NOT NULL,
    issued_at         TEXT NOT NULL,
    expires_at        TEXT,
    revoked_at        TEXT,
    revoked_reason    TEXT,
    placard_location  TEXT,
    token_hash        TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_site_tokens_active ON site_tokens(site_code, revoked_at);

CREATE TABLE IF NOT EXISTS phone_verifications (
    verification_id   TEXT PRIMARY KEY,
    phone_e164        TEXT NOT NULL,
    code_salt         BLOB NOT NULL,
    code_hash         BLOB NOT NULL,
    site_token_id     TEXT,
    checkin_id        TEXT,
    issued_at         TEXT NOT NULL,
    expires_at        TEXT NOT NULL,
    attempt_count     INTEGER NOT NULL DEFAULT 0,
    verified_at       TEXT,
    request_ip_hash   BLOB
);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_phone
    ON phone_verifications(phone_e164, issued_at DESC);

CREATE TABLE IF NOT EXISTS checkin_security (
    checkin_id             TEXT PRIMARY KEY,
    site_token_id          TEXT,
    contact_phone          TEXT,
    phone_verified_at      TEXT,
    verification_method    TEXT NOT NULL DEFAULT 'operator-entered',
    accepted_by            TEXT,
    accepted_at            TEXT,
    rejected_by            TEXT,
    rejected_at            TEXT,
    coordinates_purged_at  TEXT
);

CREATE TABLE IF NOT EXISTS checkin_location_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    checkin_id     TEXT NOT NULL,
    recorded_at    TEXT NOT NULL,
    latitude       REAL,
    longitude      REAL
);
CREATE INDEX IF NOT EXISTS idx_checkin_location_events_time
    ON checkin_location_events(checkin_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS retention_policies (
    data_category   TEXT PRIMARY KEY,
    retention_days  INTEGER,
    rationale       TEXT NOT NULL,
    approved_by     TEXT,
    approved_at     TEXT,
    review_due_at   TEXT NOT NULL,
    is_enforced     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS site_policies (
    site_code             TEXT PRIMARY KEY,
    site                  TEXT NOT NULL,
    is_pilot              INTEGER NOT NULL DEFAULT 1,
    escalation_mode       TEXT NOT NULL DEFAULT 'Shadow',
    escalation_enabled_at TEXT,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scada_feeds (
    feed_id                   TEXT PRIMARY KEY,
    feed_code                 TEXT NOT NULL UNIQUE,
    description               TEXT NOT NULL,
    share_path                TEXT NOT NULL,
    file_pattern              TEXT NOT NULL,
    expected_interval_minutes INTEGER NOT NULL DEFAULT 15,
    completion_signal         TEXT NOT NULL DEFAULT 'SizeStable',
    timestamp_column          TEXT NOT NULL DEFAULT 'Timestamp',
    timestamp_is_utc          INTEGER NOT NULL DEFAULT 0,
    stale_after_minutes       INTEGER NOT NULL DEFAULT 30,
    is_enabled                INTEGER NOT NULL DEFAULT 1,
    created_at                TEXT NOT NULL,
    updated_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scada_import_batches (
    batch_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id           TEXT NOT NULL,
    file_name         TEXT NOT NULL,
    file_written_at   TEXT,
    file_size_bytes   INTEGER,
    content_sha256    TEXT NOT NULL,
    discovered_at     TEXT NOT NULL,
    processed_at      TEXT,
    status            TEXT NOT NULL DEFAULT 'Discovered',
    min_observed_at   TEXT,
    max_observed_at   TEXT,
    imported_count    INTEGER NOT NULL DEFAULT 0,
    rejected_count    INTEGER NOT NULL DEFAULT 0,
    failure_reason    TEXT,
    UNIQUE(feed_id, content_sha256)
);
CREATE INDEX IF NOT EXISTS idx_scada_batches_pending
    ON scada_import_batches(feed_id, discovered_at, status);

CREATE TABLE IF NOT EXISTS scada_tags (
    tag_id        TEXT PRIMARY KEY,
    tag_name      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    site_code     TEXT,
    equipment_tag TEXT,
    unit          TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS scada_readings (
    reading_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id             TEXT NOT NULL,
    observed_at        TEXT NOT NULL,
    numeric_value      REAL,
    text_value         TEXT,
    source_quality     TEXT,
    scada_batch_id     INTEGER NOT NULL,
    ingested_at        TEXT NOT NULL,
    UNIQUE(tag_id, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_scada_readings_tag_time
    ON scada_readings(tag_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS scada_import_rejects (
    reject_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    scada_batch_id INTEGER NOT NULL,
    line_number    INTEGER,
    raw_line       TEXT,
    reason         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scada_rejects_batch ON scada_import_rejects(scada_batch_id);

CREATE TABLE IF NOT EXISTS scada_feed_watermarks (
    feed_id                TEXT PRIMARY KEY,
    last_observed_at       TEXT,
    last_imported_at       TEXT,
    last_batch_id          INTEGER,
    consecutive_failures   INTEGER NOT NULL DEFAULT 0
);
"""

_STABILITY: dict[str, tuple[int, int, int]] = {}


def _store() -> Any:
    import northstar_store

    return northstar_store


@contextmanager
def _db() -> Iterator[Any]:
    store = _store()
    with store._LOCK, store._session() as connection:
        yield connection


def now_iso() -> str:
    return datetime.now(TZ).isoformat()


def _default_scada_path() -> str:
    return str(Path(os.environ.get("NORTHSTAR_SCADA_PATH", ROOT / "data" / "scada")))


def init_schema(connection: Any) -> None:
    connection.executescript(PHASE1_SCHEMA)
    timestamp = now_iso()
    for code, site in DEFAULT_SITES:
        connection.execute(
            "INSERT OR IGNORE INTO site_policies"
            " (site_code, site, is_pilot, escalation_mode, updated_at) VALUES (?,?,?,?,?)",
            (code, site, 1, "Shadow", timestamp),
        )
    retention_defaults = (
        ("field-check-in", None, "Operational safety record; no operational case for expiry."),
        ("field-location", 90, "Movement coordinates are useful for current safety response, not indefinitely."),
        ("operator-log", None, "Operational record of shift activity; retained indefinitely by pilot decision."),
        ("scada-reading", None, "SCADA readings remain available for operational history and reporting."),
    )
    review_due = (datetime.now(TZ) + timedelta(days=365)).isoformat()
    for category, days, rationale in retention_defaults:
        connection.execute(
            "INSERT OR IGNORE INTO retention_policies"
            " (data_category, retention_days, rationale, review_due_at, is_enforced)"
            " VALUES (?,?,?,?,?)",
            (category, days, rationale, review_due, 0),
        )
    connection.execute(
        "INSERT OR IGNORE INTO scada_feeds"
        " (feed_id, feed_code, description, share_path, file_pattern,"
        " expected_interval_minutes, completion_signal, timestamp_column,"
        " timestamp_is_utc, stale_after_minutes, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "scada-default",
            "default",
            "Read-only SCADA report drop",
            _default_scada_path(),
            "*.csv",
            15,
            "SizeStable",
            "Timestamp",
            0,
            30,
            timestamp,
            timestamp,
        ),
    )
    connection.execute(
        "INSERT OR IGNORE INTO scada_feed_watermarks (feed_id) VALUES ('scada-default')"
    )


def _site_parts(value: Any) -> tuple[str, str] | None:
    key = str(value or "").strip()
    if not key:
        return None
    return SITE_ALIASES.get(key.casefold())


def site_catalog() -> list[dict[str, str]]:
    return [{"code": code, "site": site} for code, site in DEFAULT_SITES]


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _qr_secret() -> bytes:
    configured = os.environ.get("NORTHSTAR_QR_SECRET", "").strip()
    if configured:
        return configured.encode("utf-8")
    path = _store().DB_PATH.parent / ".northstar-qr-secret"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(secrets.token_urlsafe(32), encoding="utf-8")
    return path.read_text(encoding="utf-8").strip().encode("utf-8")


def _key_id() -> str:
    return os.environ.get("NORTHSTAR_QR_KEY_ID", "local-1").strip() or "local-1"


def _token_text(
    token_id: str,
    site_code: str,
    site: str,
    key_id: str,
    expires_at: str | None,
) -> str:
    payload = {
        "v": 1,
        "id": token_id,
        "code": site_code,
        "site": site,
        "kid": key_id,
        "exp": int(datetime.fromisoformat(expires_at).timestamp()) if expires_at else None,
    }
    encoded = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _b64(hmac.new(_qr_secret(), encoded.encode("ascii"), hashlib.sha256).digest())
    return f"n1.{encoded}.{signature}"


def _token_record(row: Any, include_token: bool = True) -> dict[str, Any]:
    token = _token_text(
        row["token_id"],
        row["site_code"],
        row["site"],
        row["signing_key_id"],
        row["expires_at"],
    )
    record = {
        "tokenId": row["token_id"],
        "siteCode": row["site_code"],
        "site": row["site"],
        "signingKeyId": row["signing_key_id"],
        "issuedAt": row["issued_at"],
        "expiresAt": row["expires_at"],
        "revokedAt": row["revoked_at"],
        "placardLocation": row["placard_location"],
    }
    if include_token:
        record["token"] = token
    return record


def issue_site_token(value: Any, rotate: bool = False, placard_location: str = "") -> dict[str, Any]:
    parts = _site_parts(value)
    if parts is None:
        raise ValueError("site must be one of the configured NorthStar sites")
    site_code, site = parts
    timestamp = now_iso()
    with _db() as connection:
        row = connection.execute(
            "SELECT * FROM site_tokens WHERE site_code=? AND revoked_at IS NULL"
            " AND (expires_at IS NULL OR expires_at>?) ORDER BY issued_at DESC LIMIT 1",
            (site_code, timestamp),
        ).fetchone()
        if row is not None and not rotate:
            return _token_record(row)
        if rotate:
            connection.execute(
                "UPDATE site_tokens SET revoked_at=?, revoked_reason='rotated'"
                " WHERE site_code=? AND revoked_at IS NULL",
                (timestamp, site_code),
            )
        token_id = secrets.token_hex(16)
        expires_at = (datetime.now(TZ) + timedelta(days=max(1, int(os.environ.get("NORTHSTAR_QR_TOKEN_DAYS", "365"))))).isoformat()
        token = _token_text(token_id, site_code, site, _key_id(), expires_at)
        connection.execute(
            "INSERT INTO site_tokens"
            " (token_id, site_code, site, signing_key_id, issued_at, expires_at,"
            " placard_location, token_hash) VALUES (?,?,?,?,?,?,?,?)",
            (
                token_id,
                site_code,
                site,
                _key_id(),
                timestamp,
                expires_at,
                str(placard_location or "").strip()[:200] or None,
                hashlib.sha256(token.encode("utf-8")).hexdigest(),
            ),
        )
        row = connection.execute("SELECT * FROM site_tokens WHERE token_id=?", (token_id,)).fetchone()
    return _token_record(row)


def list_site_tokens() -> list[dict[str, Any]]:
    return [issue_site_token(code) for code, _ in DEFAULT_SITES]


def _parse_token(token: str) -> tuple[dict[str, Any], str] | None:
    try:
        prefix, encoded, signature = token.split(".", 2)
        if prefix != "n1":
            return None
        expected = _b64(hmac.new(_qr_secret(), encoded.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(_unb64(encoded).decode("utf-8"))
        if not isinstance(payload, dict) or payload.get("v") != 1:
            return None
        return payload, token
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        return None


def resolve_site_token(token: str) -> dict[str, Any] | None:
    parsed = _parse_token(str(token or "").strip())
    if parsed is None:
        return None
    payload, token_text = parsed
    if payload.get("kid") != _key_id() or not payload.get("id") or not payload.get("code"):
        return None
    if payload.get("exp") is not None:
        try:
            if datetime.now(TZ).timestamp() >= float(payload["exp"]):
                return None
        except (TypeError, ValueError):
            return None
    with _db() as connection:
        row = connection.execute(
            "SELECT * FROM site_tokens WHERE token_id=? AND token_hash=?",
            (str(payload["id"]), hashlib.sha256(token_text.encode("utf-8")).hexdigest()),
        ).fetchone()
    if row is None or row["revoked_at"] is not None:
        return None
    if row["expires_at"] and datetime.fromisoformat(row["expires_at"]) <= datetime.now(TZ):
        return None
    if row["site_code"] != payload.get("code") or row["site"] != payload.get("site"):
        return None
    return {
        "tokenId": row["token_id"],
        "siteCode": row["site_code"],
        "site": row["site"],
        "issuedAt": row["issued_at"],
        "expiresAt": row["expires_at"],
        "verificationMethod": "qr-unverified",
    }


def revoke_site_token(token_id: str, reason: str = "revoked") -> bool:
    with _db() as connection:
        cursor = connection.execute(
            "UPDATE site_tokens SET revoked_at=?, revoked_reason=?"
            " WHERE token_id=? AND revoked_at IS NULL",
            (now_iso(), str(reason or "revoked")[:200], token_id),
        )
    return cursor.rowcount > 0


def normalize_phone(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    digits = re.sub(r"[^0-9]", "", raw)
    if len(digits) == 10:
        digits = "1" + digits
    if len(digits) < 8 or len(digits) > 15:
        raise ValueError("phone must be a valid international number")
    return "+" + digits


def _mask_phone(phone: str | None) -> str | None:
    return f"••••{phone[-4:]}" if phone else None


def _code_hash(code: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", code.encode("ascii"), salt, 120_000)


def request_phone_verification(
    token: str,
    phone: Any,
    request_ip: str = "",
) -> dict[str, Any]:
    resolved = resolve_site_token(token)
    if resolved is None:
        raise ValueError("valid site QR token is required")
    phone_e164 = normalize_phone(phone)
    if phone_e164 is None:
        raise ValueError("phone is required")
    code = f"{secrets.randbelow(1_000_000):06d}"
    salt = secrets.token_bytes(16)
    issued_at = now_iso()
    expires_at = (datetime.now(TZ) + timedelta(minutes=10)).isoformat()
    verification_id = "verify-" + secrets.token_hex(12)
    request_ip_hash = hashlib.sha256(str(request_ip).encode("utf-8")).digest() if request_ip else None
    with _db() as connection:
        connection.execute(
            "INSERT INTO phone_verifications"
            " (verification_id, phone_e164, code_salt, code_hash, site_token_id,"
            " issued_at, expires_at, request_ip_hash) VALUES (?,?,?,?,?,?,?,?)",
            (
                verification_id,
                phone_e164,
                salt,
                _code_hash(code, salt),
                resolved["tokenId"],
                issued_at,
                expires_at,
                request_ip_hash,
            ),
        )
    mode = os.environ.get("NORTHSTAR_PHONE_VERIFICATION_MODE", "shadow").strip().lower()
    response: dict[str, Any] = {
        "verificationId": verification_id,
        "phone": _mask_phone(phone_e164),
        "expiresAt": expires_at,
        "deliveryMode": mode,
        "deliveryStatus": "connector-required" if mode == "live" else "shadow-not-sent",
    }
    if mode == "dev":
        response["debugCode"] = code
        response["deliveryStatus"] = "dev-code"
    return response


def verify_phone_verification(verification_id: str, code: Any) -> dict[str, Any]:
    supplied = str(code or "").strip()
    if not re.fullmatch(r"\d{6}", supplied):
        raise ValueError("verification code must be six digits")
    with _db() as connection:
        row = connection.execute(
            "SELECT * FROM phone_verifications WHERE verification_id=?", (verification_id,)
        ).fetchone()
        if row is None:
            raise ValueError("verification request not found")
        if row["verified_at"]:
            return {
                "verificationId": verification_id,
                "verified": True,
                "verifiedAt": row["verified_at"],
                "phone": _mask_phone(row["phone_e164"]),
            }
        if datetime.fromisoformat(row["expires_at"]) <= datetime.now(TZ):
            raise ValueError("verification code expired")
        if int(row["attempt_count"]) >= 5:
            raise ValueError("verification attempts exhausted")
        connection.execute(
            "UPDATE phone_verifications SET attempt_count=attempt_count+1 WHERE verification_id=?",
            (verification_id,),
        )
        if not hmac.compare_digest(_code_hash(supplied, row["code_salt"]), row["code_hash"]):
            raise ValueError("verification code is incorrect")
        verified_at = now_iso()
        connection.execute(
            "UPDATE phone_verifications SET verified_at=? WHERE verification_id=?",
            (verified_at, verification_id),
        )
    return {
        "verificationId": verification_id,
        "verified": True,
        "verifiedAt": verified_at,
        "phone": _mask_phone(row["phone_e164"]),
    }


def _verified_phone(connection: Any, verification_id: str, token_id: str | None, phone: str | None) -> Any:
    row = connection.execute(
        "SELECT * FROM phone_verifications WHERE verification_id=?", (verification_id,)
    ).fetchone()
    if row is None or not row["verified_at"]:
        raise ValueError("phone verification is required before check-in")
    if row["expires_at"] and datetime.fromisoformat(row["expires_at"]) <= datetime.now(TZ):
        raise ValueError("phone verification expired")
    if token_id and row["site_token_id"] != token_id:
        raise ValueError("phone verification does not match this site QR token")
    if phone and row["phone_e164"] != phone:
        raise ValueError("phone verification does not match the submitted phone")
    return row


def prepare_checkin(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Validate/resolve QR security fields before the core check-in is written."""
    prepared = dict(payload)
    token_text = str(payload.get("qrToken") or payload.get("token") or "").strip()
    resolved = resolve_site_token(token_text) if token_text else None
    if token_text and resolved is None:
        raise ValueError("valid site QR token is required")
    if resolved:
        prepared["site"] = resolved["site"]
    site = str(prepared.get("site", "")).strip()
    if not site:
        raise ValueError("name and site are required")
    phone = normalize_phone(payload.get("phone") or payload.get("contactPhone"))
    verification_id = str(payload.get("phoneVerificationId") or "").strip() or None
    method = "qr-unverified" if resolved else "operator-entered"
    verified_at = None
    if verification_id:
        with _db() as connection:
            verified = _verified_phone(connection, verification_id, resolved["tokenId"] if resolved else None, phone)
        phone = verified["phone_e164"]
        verified_at = verified["verified_at"]
        method = "qr-phone" if resolved else "operator-phone"
    elif payload.get("requirePhoneVerification"):
        raise ValueError("phone verification is required before check-in")
    return prepared, {
        "siteTokenId": resolved["tokenId"] if resolved else None,
        "contactPhone": phone,
        "phoneVerifiedAt": verified_at,
        "verificationMethod": method,
    }


def attach_checkin_security(checkin_id: str, security: dict[str, Any]) -> None:
    with _db() as connection:
        connection.execute(
            "INSERT OR REPLACE INTO checkin_security"
            " (checkin_id, site_token_id, contact_phone, phone_verified_at, verification_method)"
            " VALUES (?,?,?,?,?)",
            (
                checkin_id,
                security.get("siteTokenId"),
                security.get("contactPhone"),
                security.get("phoneVerifiedAt"),
                security.get("verificationMethod") or "operator-entered",
            ),
        )


def enrich_checkin(record: dict[str, Any] | None) -> dict[str, Any] | None:
    if record is None:
        return None
    with _db() as connection:
        row = connection.execute(
            "SELECT * FROM checkin_security WHERE checkin_id=?", (record["id"],)
        ).fetchone()
    if row is None:
        return record
    enriched = dict(record)
    enriched.update(
        {
            "siteTokenId": row["site_token_id"],
            "contactPhone": _mask_phone(row["contact_phone"]),
            "phoneVerifiedAt": row["phone_verified_at"],
            "phoneVerified": bool(row["phone_verified_at"]),
            "verificationMethod": row["verification_method"],
            "acceptedBy": row["accepted_by"],
            "acceptedAt": row["accepted_at"],
            "rejectedBy": row["rejected_by"],
            "rejectedAt": row["rejected_at"],
            "coordinatesPurgedAt": row["coordinates_purged_at"],
        }
    )
    return enriched


def record_acceptance(checkin_id: str, accept: bool, actor: str) -> None:
    timestamp = now_iso()
    actor = str(actor or "operator")[:80]
    with _db() as connection:
        if accept:
            connection.execute(
                "UPDATE checkin_security SET accepted_by=?, accepted_at=? WHERE checkin_id=?",
                (actor, timestamp, checkin_id),
            )
        else:
            connection.execute(
                "UPDATE checkin_security SET rejected_by=?, rejected_at=? WHERE checkin_id=?",
                (actor, timestamp, checkin_id),
            )


def record_location(checkin_id: str, latitude: Any, longitude: Any, recorded_at: str | None = None) -> None:
    if latitude is None or longitude is None:
        return
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError):
        return
    if not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return
    with _db() as connection:
        connection.execute(
            "INSERT INTO checkin_location_events"
            " (checkin_id, recorded_at, latitude, longitude) VALUES (?,?,?,?)",
            (checkin_id, recorded_at or now_iso(), lat, lon),
        )


def purge_expired_coordinates(reference: datetime | None = None) -> int:
    days = max(1, int(os.environ.get("NORTHSTAR_COORDINATE_RETENTION_DAYS", "90")))
    reference = reference or datetime.now(TZ)
    cutoff = (reference - timedelta(days=days)).isoformat()
    timestamp = reference.isoformat()
    with _db() as connection:
        old_events = connection.execute(
            "SELECT COUNT(*) FROM checkin_location_events"
            " WHERE recorded_at<? AND (latitude IS NOT NULL OR longitude IS NOT NULL)",
            (cutoff,),
        ).fetchone()[0]
        connection.execute(
            "UPDATE checkin_location_events SET latitude=NULL, longitude=NULL WHERE recorded_at<?",
            (cutoff,),
        )
        connection.execute(
            "UPDATE checkins SET latitude=NULL, longitude=NULL"
            " WHERE last_heard<? AND (latitude IS NOT NULL OR longitude IS NOT NULL)",
            (cutoff,),
        )
        connection.execute(
            "UPDATE checkin_security SET coordinates_purged_at=?"
            " WHERE coordinates_purged_at IS NULL"
            " AND checkin_id IN (SELECT id FROM checkins WHERE last_heard<?)",
            (timestamp, cutoff),
        )
    return int(old_events)


def list_retention_policies() -> list[dict[str, Any]]:
    with _db() as connection:
        rows = connection.execute("SELECT * FROM retention_policies ORDER BY data_category").fetchall()
    return [
        {
            "dataCategory": row["data_category"],
            "retentionDays": row["retention_days"],
            "rationale": row["rationale"],
            "approvedBy": row["approved_by"],
            "approvedAt": row["approved_at"],
            "reviewDueAt": row["review_due_at"],
            "isEnforced": bool(row["is_enforced"]),
        }
        for row in rows
    ]


def set_retention_policy(payload: dict[str, Any]) -> dict[str, Any]:
    category = str(payload.get("dataCategory") or "").strip()[:80]
    if not category:
        raise ValueError("dataCategory is required")
    days = payload.get("retentionDays")
    if days not in (None, ""):
        try:
            days = max(0, int(days))
        except (TypeError, ValueError) as exc:
            raise ValueError("retentionDays must be a non-negative number or null") from exc
    else:
        days = None
    review_due = str(payload.get("reviewDueAt") or "").strip() or (datetime.now(TZ) + timedelta(days=365)).isoformat()
    with _db() as connection:
        connection.execute(
            "INSERT INTO retention_policies"
            " (data_category, retention_days, rationale, approved_by, approved_at, review_due_at, is_enforced)"
            " VALUES (?,?,?,?,?,?,?)"
            " ON CONFLICT(data_category) DO UPDATE SET retention_days=excluded.retention_days,"
            " rationale=excluded.rationale, approved_by=excluded.approved_by, approved_at=excluded.approved_at,"
            " review_due_at=excluded.review_due_at, is_enforced=excluded.is_enforced",
            (
                category,
                days,
                str(payload.get("rationale") or "").strip()[:400],
                str(payload.get("approvedBy") or "").strip()[:160] or None,
                now_iso(),
                review_due,
                int(bool(payload.get("isEnforced"))),
            ),
        )
        row = connection.execute("SELECT * FROM retention_policies WHERE data_category=?", (category,)).fetchone()
    return {
        "dataCategory": row["data_category"],
        "retentionDays": row["retention_days"],
        "rationale": row["rationale"],
        "approvedBy": row["approved_by"],
        "approvedAt": row["approved_at"],
        "reviewDueAt": row["review_due_at"],
        "isEnforced": bool(row["is_enforced"]),
    }


def list_site_policies() -> list[dict[str, Any]]:
    with _db() as connection:
        rows = connection.execute("SELECT * FROM site_policies ORDER BY site").fetchall()
    return [
        {
            "siteCode": row["site_code"],
            "site": row["site"],
            "isPilot": bool(row["is_pilot"]),
            "escalationMode": row["escalation_mode"],
            "escalationEnabledAt": row["escalation_enabled_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def escalation_mode(site: str) -> str:
    parts = _site_parts(site)
    if parts is None:
        return "Shadow"
    with _db() as connection:
        row = connection.execute(
            "SELECT escalation_mode FROM site_policies WHERE site_code=?", (parts[0],)
        ).fetchone()
    return row["escalation_mode"] if row else "Shadow"


def set_site_policy(payload: dict[str, Any]) -> dict[str, Any]:
    parts = _site_parts(payload.get("siteCode") or payload.get("site"))
    if parts is None:
        raise ValueError("site must be one of the configured NorthStar sites")
    mode = str(payload.get("escalationMode", "Shadow")).strip().title()
    if mode not in {"Off", "Shadow", "Live"}:
        raise ValueError("escalationMode must be Off, Shadow, or Live")
    timestamp = now_iso()
    enabled_at = timestamp if mode == "Live" else None
    with _db() as connection:
        connection.execute(
            "UPDATE site_policies SET is_pilot=?, escalation_mode=?, escalation_enabled_at=?, updated_at=?"
            " WHERE site_code=?",
            (int(bool(payload.get("isPilot", True))), mode, enabled_at, timestamp, parts[0]),
        )
        row = connection.execute("SELECT * FROM site_policies WHERE site_code=?", (parts[0],)).fetchone()
    return {
        "siteCode": row["site_code"],
        "site": row["site"],
        "isPilot": bool(row["is_pilot"]),
        "escalationMode": row["escalation_mode"],
        "escalationEnabledAt": row["escalation_enabled_at"],
        "updatedAt": row["updated_at"],
    }


def _feed_record(row: Any) -> dict[str, Any]:
    return {
        "feedId": row["feed_id"],
        "feedCode": row["feed_code"],
        "description": row["description"],
        "sharePath": row["share_path"],
        "filePattern": row["file_pattern"],
        "expectedIntervalMinutes": row["expected_interval_minutes"],
        "completionSignal": row["completion_signal"],
        "timestampColumn": row["timestamp_column"],
        "timestampIsUtc": bool(row["timestamp_is_utc"]),
        "staleAfterMinutes": row["stale_after_minutes"],
        "enabled": bool(row["is_enabled"]),
    }


def list_scada_feeds() -> list[dict[str, Any]]:
    with _db() as connection:
        rows = connection.execute("SELECT * FROM scada_feeds ORDER BY feed_code").fetchall()
        watermarks = {
            row["feed_id"]: row
            for row in connection.execute("SELECT * FROM scada_feed_watermarks").fetchall()
        }
        latest = {
            row["feed_id"]: row["latest"]
            for row in connection.execute(
                "SELECT b.feed_id, MAX(r.observed_at) AS latest"
                " FROM scada_readings r JOIN scada_import_batches b ON b.batch_id=r.scada_batch_id"
                " GROUP BY b.feed_id"
            ).fetchall()
        }
    now = datetime.now(TZ)
    result = []
    for row in rows:
        record = _feed_record(row)
        watermark = watermarks.get(row["feed_id"])
        last_observed = latest.get(row["feed_id"]) or (watermark["last_observed_at"] if watermark else None)
        status = "Waiting"
        age_minutes = None
        if last_observed:
            try:
                age_minutes = max(0, int((now - datetime.fromisoformat(last_observed)).total_seconds() // 60))
                status = "Stale" if age_minutes > row["stale_after_minutes"] else "Current"
            except ValueError:
                status = "Unknown"
        record.update(
            {
                "status": status,
                "ageMinutes": age_minutes,
                "lastObservedAt": last_observed,
                "lastImportedAt": watermark["last_imported_at"] if watermark else None,
                "consecutiveFailures": watermark["consecutive_failures"] if watermark else 0,
            }
        )
        result.append(record)
    return result


def _normalized_columns(fieldnames: list[str]) -> dict[str, str]:
    return {re.sub(r"[^a-z0-9]", "", name.casefold()): name for name in fieldnames if name}


def _find_column(fieldnames: list[str], candidates: tuple[str, ...]) -> str | None:
    normalized = _normalized_columns(fieldnames)
    for candidate in candidates:
        if candidate in normalized:
            return normalized[candidate]
    for key, original in normalized.items():
        if any(candidate in key for candidate in candidates):
            return original
    return None


def _parse_observed(value: Any, timestamp_is_utc: bool) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    parsed: datetime | None = None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        for pattern in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%m/%d/%Y %H:%M"):
            try:
                parsed = datetime.strptime(raw, pattern)
                break
            except ValueError:
                continue
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo("UTC") if timestamp_is_utc else TZ)
    return parsed.astimezone(TZ).isoformat()


def _numeric(value: Any) -> float | None:
    try:
        text = str(value or "").strip().replace(",", "")
        return float(text) if text else None
    except (TypeError, ValueError):
        return None


def _tag_id(connection: Any, tag_name: str, display_name: str, site_code: str | None, unit: str | None) -> str:
    row = connection.execute("SELECT tag_id FROM scada_tags WHERE tag_name=?", (tag_name,)).fetchone()
    if row:
        return row["tag_id"]
    tag_id = "tag-" + secrets.token_hex(12)
    connection.execute(
        "INSERT INTO scada_tags (tag_id, tag_name, display_name, site_code, unit) VALUES (?,?,?,?,?)",
        (tag_id, tag_name, display_name[:160], site_code, unit),
    )
    return tag_id


def import_scada_content(
    feed_code: str,
    file_name: str,
    content: str | bytes,
    file_written_at: str | None = None,
) -> dict[str, Any]:
    raw = content if isinstance(content, bytes) else content.encode("utf-8")
    text = raw.decode("utf-8-sig")
    digest = hashlib.sha256(raw).hexdigest()
    with _db() as connection:
        feed = connection.execute("SELECT * FROM scada_feeds WHERE feed_code=?", (feed_code,)).fetchone()
        if feed is None:
            raise ValueError("SCADA feed not found")
        duplicate = connection.execute(
            "SELECT * FROM scada_import_batches WHERE feed_id=? AND content_sha256=?",
            (feed["feed_id"], digest),
        ).fetchone()
        if duplicate:
            return {
                "batchId": duplicate["batch_id"],
                "status": "Duplicate",
                "fileName": duplicate["file_name"],
                "imported": 0,
                "rejected": 0,
            }
        discovered_at = now_iso()
        connection.execute(
            "INSERT INTO scada_import_batches"
            " (feed_id, file_name, file_written_at, file_size_bytes, content_sha256, discovered_at, status)"
            " VALUES (?,?,?,?,?,?,?)",
            (
                feed["feed_id"],
                str(file_name or "report.csv")[:260],
                file_written_at,
                len(raw),
                digest,
                discovered_at,
                "Processing",
            ),
        )
        batch_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
        reader = csv.DictReader(io.StringIO(text))
        fieldnames = list(reader.fieldnames or [])
        if not fieldnames:
            connection.execute(
                "UPDATE scada_import_batches SET status='Failed', processed_at=?, failure_reason=? WHERE batch_id=?",
                (now_iso(), "report has no header row", batch_id),
            )
            return {"batchId": batch_id, "status": "Failed", "imported": 0, "rejected": 0}
        timestamp_column = feed["timestamp_column"] if feed["timestamp_column"] in fieldnames else _find_column(
            fieldnames, ("timestamp", "observedat", "observed", "datetime", "date", "time")
        )
        if timestamp_column is None:
            connection.execute(
                "UPDATE scada_import_batches SET status='Failed', processed_at=?, failure_reason=? WHERE batch_id=?",
                (now_iso(), "report has no observation timestamp column", batch_id),
            )
            return {"batchId": batch_id, "status": "Failed", "imported": 0, "rejected": 0}
        tag_column = _find_column(fieldnames, ("tag", "tagname", "point", "signal", "parameter"))
        value_column = _find_column(fieldnames, ("value", "numericvalue", "reading", "numeric"))
        quality_column = _find_column(fieldnames, ("quality", "sourcequality", "status"))
        site_column = _find_column(fieldnames, ("site", "sitecode", "facility"))
        unit_column = _find_column(fieldnames, ("unit", "units"))
        ignored_columns = {timestamp_column, tag_column, value_column, quality_column, site_column, unit_column}
        wide_columns = [column for column in fieldnames if column not in ignored_columns]
        imported = 0
        rejected = 0
        observed_values: list[str] = []
        for line_number, row in enumerate(reader, start=2):
            observed_at = _parse_observed(row.get(timestamp_column), bool(feed["timestamp_is_utc"]))
            if observed_at is None:
                rejected += 1
                connection.execute(
                    "INSERT INTO scada_import_rejects (scada_batch_id, line_number, raw_line, reason) VALUES (?,?,?,?)",
                    (batch_id, line_number, json.dumps(row, separators=(",", ":"))[:2000], "invalid observation timestamp"),
                )
                continue
            if tag_column:
                tag_name = str(row.get(tag_column) or "").strip()
                candidates = [(tag_name, row.get(value_column) if value_column else None)]
            else:
                candidates = [(column, row.get(column)) for column in wide_columns]
            row_imported = 0
            for tag_name, raw_value in candidates:
                if not tag_name:
                    continue
                numeric_value = _numeric(raw_value)
                text_value = None if numeric_value is not None else str(raw_value or "").strip() or None
                if numeric_value is None and text_value is None:
                    continue
                site_code = str(row.get(site_column) or "").strip() or None if site_column else None
                unit = str(row.get(unit_column) or "").strip() or None if unit_column else None
                tag_id = _tag_id(connection, tag_name[:120], tag_name[:160], site_code, unit)
                cursor = connection.execute(
                    "INSERT OR IGNORE INTO scada_readings"
                    " (tag_id, observed_at, numeric_value, text_value, source_quality, scada_batch_id, ingested_at)"
                    " VALUES (?,?,?,?,?,?,?)",
                    (tag_id, observed_at, numeric_value, text_value, str(row.get(quality_column) or "").strip() or None if quality_column else None, batch_id, now_iso()),
                )
                if cursor.rowcount:
                    imported += 1
                    row_imported += 1
                    observed_values.append(observed_at)
            if row_imported == 0:
                rejected += 1
                connection.execute(
                    "INSERT INTO scada_import_rejects (scada_batch_id, line_number, raw_line, reason) VALUES (?,?,?,?)",
                    (batch_id, line_number, json.dumps(row, separators=(",", ":"))[:2000], "no numeric or text reading values"),
                )
        processed_at = now_iso()
        status = "Imported" if imported else "Failed"
        reason = None if imported else "report contained no usable readings"
        minimum = min(observed_values) if observed_values else None
        maximum = max(observed_values) if observed_values else None
        connection.execute(
            "UPDATE scada_import_batches SET status=?, processed_at=?, min_observed_at=?, max_observed_at=?,"
            " imported_count=?, rejected_count=?, failure_reason=? WHERE batch_id=?",
            (status, processed_at, minimum, maximum, imported, rejected, reason, batch_id),
        )
        connection.execute(
            "INSERT INTO scada_feed_watermarks (feed_id, last_observed_at, last_imported_at, last_batch_id, consecutive_failures)"
            " VALUES (?,?,?,?,?) ON CONFLICT(feed_id) DO UPDATE SET last_observed_at=excluded.last_observed_at,"
            " last_imported_at=excluded.last_imported_at, last_batch_id=excluded.last_batch_id,"
            " consecutive_failures=excluded.consecutive_failures",
            (feed["feed_id"], maximum, processed_at if imported else None, batch_id, 0 if imported else 1),
        )
    return {
        "batchId": batch_id,
        "status": status,
        "fileName": str(file_name or "report.csv"),
        "imported": imported,
        "rejected": rejected,
        "minObservedAt": minimum,
        "maxObservedAt": maximum,
    }


def import_scada_file(feed_code: str, path: Path) -> dict[str, Any]:
    stat = path.stat()
    return import_scada_content(
        feed_code,
        path.name,
        path.read_bytes(),
        datetime.fromtimestamp(stat.st_mtime, TZ).isoformat(),
    )


def scan_scada_once() -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    with _db() as connection:
        feeds = connection.execute("SELECT * FROM scada_feeds WHERE is_enabled=1").fetchall()
    for feed in feeds:
        directory = Path(feed["share_path"])
        if not directory.is_absolute():
            directory = ROOT / directory
        if not directory.exists():
            continue
        for path in sorted(directory.glob(feed["file_pattern"])):
            if not path.is_file():
                continue
            try:
                stat = path.stat()
                signature = (int(stat.st_size), int(stat.st_mtime_ns))
                previous = _STABILITY.get(str(path))
                count = previous[2] + 1 if previous and previous[:2] == signature else 1
                _STABILITY[str(path)] = (signature[0], signature[1], count)
                if count < 2:
                    continue
                results.append(import_scada_file(feed["feed_code"], path))
            except (OSError, ValueError) as exc:
                results.append({"feedCode": feed["feed_code"], "status": "Failed", "error": str(exc)})
    return results


def latest_scada_readings(limit: int = 100, feed_code: str | None = None) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 500))
    with _db() as connection:
        query = (
            "SELECT t.tag_name, t.display_name, t.site_code, t.unit, r.observed_at,"
            " r.numeric_value, r.text_value, r.source_quality, b.file_name, f.feed_code"
            " FROM scada_readings r JOIN scada_tags t ON t.tag_id=r.tag_id"
            " JOIN scada_import_batches b ON b.batch_id=r.scada_batch_id"
            " JOIN scada_feeds f ON f.feed_id=b.feed_id"
        )
        params: list[Any] = []
        if feed_code:
            query += " WHERE f.feed_code=?"
            params.append(feed_code)
        query += " ORDER BY t.tag_name, r.observed_at DESC"
        rows = connection.execute(query, params).fetchall()
    seen: set[str] = set()
    result = []
    for row in rows:
        if row["tag_name"] in seen:
            continue
        seen.add(row["tag_name"])
        result.append(
            {
                "tagName": row["tag_name"],
                "displayName": row["display_name"],
                "siteCode": row["site_code"],
                "unit": row["unit"],
                "observedAt": row["observed_at"],
                "numericValue": row["numeric_value"],
                "textValue": row["text_value"],
                "sourceQuality": row["source_quality"],
                "fileName": row["file_name"],
                "feedCode": row["feed_code"],
            }
        )
        if len(result) >= limit:
            break
    return result


def scada_snapshot(limit: int = 100) -> dict[str, Any]:
    return {
        "generatedAt": now_iso(),
        "feeds": list_scada_feeds(),
        "readings": latest_scada_readings(limit),
    }
