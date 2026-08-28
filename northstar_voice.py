"""Voice operations: audio file intake, transcription, and content triage.

There is no phone system to connect to. Audio arrives as files — a radio logger
export, a voicemail drop, a handheld recorder — and this module takes it from
"a file appeared" to "an operator can read what was said and act on it".

Three deliberate positions, because this sits next to a life-safety workflow:

1. **Nothing is ever invented.** With no transcription engine configured the
   pipeline still ingests, hashes, dedupes and logs the audio, and the recording
   sits at AWAITING TRANSCRIPTION. It does not emit placeholder text that could
   later be mistaken for something a person actually said.

2. **Triage may demote chatter. It may never suppress a safety signal.** Any
   segment carrying emergency vocabulary is pinned operational and flagged,
   whatever else the classifier thinks. A filter that can hide "man down"
   because it scored the line as small talk is worse than no filter.

3. **Filtered is not deleted.** Non-operational segments are withheld from the
   operational feed, not destroyed. They stay queryable, an operator can
   overturn any call, and every override is an append-only audit event. Audio
   bytes age out on a retention clock; the transcript and the audit trail do not.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator
from zoneinfo import ZoneInfo

import northstar_events as events

ROOT = Path(__file__).resolve().parent
TZ = ZoneInfo("America/Toronto")

AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".ogg", ".oga", ".flac", ".amr", ".aac", ".wma", ".opus"}
MAX_AUDIO_BYTES = 256 * 1024 * 1024

# Two observations of an unchanged (size, mtime) before a file is considered
# finished writing. Same approach the SCADA drop folder uses.
_STABILITY: dict[str, tuple[int, int, int]] = {}

VOICE_SCHEMA = """
CREATE TABLE IF NOT EXISTS voice_recordings (
    recording_id         TEXT PRIMARY KEY,
    original_name        TEXT NOT NULL,
    stored_name          TEXT,
    content_sha256       TEXT NOT NULL UNIQUE,
    byte_size            INTEGER NOT NULL,
    source               TEXT NOT NULL DEFAULT 'inbox',
    received_at          TEXT NOT NULL,
    status               TEXT NOT NULL,
    engine               TEXT,
    transcribed_at       TEXT,
    language             TEXT,
    duration_seconds     REAL,
    error                TEXT,
    audio_retained       INTEGER NOT NULL DEFAULT 1,
    retention_expires_at TEXT
);
CREATE TABLE IF NOT EXISTS voice_segments (
    segment_id     TEXT PRIMARY KEY,
    recording_id   TEXT NOT NULL,
    ordinal        INTEGER NOT NULL,
    started_seconds REAL,
    ended_seconds   REAL,
    text           TEXT NOT NULL,
    classification TEXT NOT NULL,
    reason         TEXT NOT NULL,
    safety_hold    INTEGER NOT NULL DEFAULT 0,
    reviewed_by    TEXT,
    reviewed_at    TEXT,
    review_note    TEXT
);
CREATE TABLE IF NOT EXISTS voice_events (
    event_id     TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    at           TEXT NOT NULL,
    event        TEXT NOT NULL,
    detail       TEXT NOT NULL DEFAULT '',
    actor        TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX IF NOT EXISTS idx_voice_segments_recording ON voice_segments(recording_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_voice_events_recording ON voice_events(recording_id, at);
"""

STATUS_AWAITING = "Awaiting transcription"
STATUS_TRANSCRIBED = "Transcribed"
STATUS_FAILED = "Transcription failed"
STATUS_PURGED = "Audio purged"

# Vocabulary that pins a segment operational no matter what else it looks like.
# Over-inclusive on purpose: a false positive costs an operator three seconds of
# reading, a false negative can cost a life.
SAFETY_TERMS = (
    "help", "mayday", "emergency", "911", "ambulance", "paramedic", "fire",
    "injured", "injury", "hurt", "bleeding", "unconscious", "not breathing",
    "man down", "worker down", "trapped", "pinned", "rescue", "evacuate",
    "evacuation", "arc flash", "electrocuted", "shock", "gas leak", "smoke",
    "accident", "collapsed", "fell", "fall", "drowning", "hypothermia",
    "chest pain", "seizure", "overdose", "urgent", "distress", "sos",
)

# Ordinary operations vocabulary. Anything here keeps the segment in the feed.
OPERATIONAL_TERMS = (
    "breaker", "switch", "switching", "feeder", "outage", "load", "megawatt",
    "mw", "dispatch", "unit", "generator", "genset", "turbine", "transformer",
    "station", "substation", "bus", "line", "circuit", "relay", "trip",
    "lockout", "tagout", "tag", "clearance", "permit", "isolation", "isolate",
    "energize", "de-energize", "deenergize", "ground", "grounded",
    "spill", "spillway", "gate", "headpond", "forebay", "tailrace", "flow",
    "level", "discharge", "inflow", "outflow", "water", "ice", "debris",
    "scada", "alarm", "annunciator", "setpoint", "reading", "meter",
    "crew", "check in", "checked in", "check out", "on site", "site",
    "shift", "handover", "logbook", "work order", "maintenance", "inspection",
    "iroquois falls", "atikokan", "kapuskasing", "fort frances", "kenora",
    "smooth rock falls", "island falls", "dokis", "apiroq",
)

# Markers of purely social content. Only consulted once the two lists above miss.
SOCIAL_TERMS = (
    "weekend", "lunch", "coffee", "dinner", "hockey", "leafs", "birthday",
    "vacation", "holiday", "kids", "wife", "husband", "netflix", "weather was",
    "how are you", "how's it going", "see you later", "have a good one",
    "good morning", "good night", "thanks buddy", "no worries",
)

CLASS_OPERATIONAL = "operational"
CLASS_NON_OPERATIONAL = "non-operational"


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


def init_schema(connection: Any) -> None:
    connection.executescript(VOICE_SCHEMA)


def inbox_path() -> Path:
    return Path(os.environ.get("NORTHSTAR_VOICE_INBOX", ROOT / "data" / "voice-inbox"))


def store_path() -> Path:
    return Path(os.environ.get("NORTHSTAR_VOICE_STORE", ROOT / "data" / "voice-store"))


def retention_days() -> int:
    return max(1, int(os.environ.get("NORTHSTAR_VOICE_RETENTION_DAYS", "30")))


def engine_name() -> str:
    return os.environ.get("NORTHSTAR_VOICE_ENGINE", "none").strip().lower() or "none"


# --------------------------------------------------------------------------- #
# Classification
# --------------------------------------------------------------------------- #

def _contains(haystack: str, terms: tuple[str, ...]) -> str | None:
    for term in terms:
        # Word-boundary match so "fall" does not fire inside "Fort Frances".
        if re.search(rf"(?<![a-z]){re.escape(term)}(?![a-z])", haystack):
            return term
    return None


def classify_segment(text: str) -> dict[str, Any]:
    """Decide whether a line of transcript belongs in the operational feed.

    Deterministic and inspectable on purpose. Every verdict carries the reason
    and, where relevant, the exact term that triggered it, so an operator can
    see why something was filtered rather than trusting a score.
    """
    lowered = " ".join(text.lower().split())
    safety = _contains(lowered, SAFETY_TERMS)
    if safety:
        return {
            "classification": CLASS_OPERATIONAL,
            "reason": f"safety vocabulary '{safety}' — never filtered",
            "safety_hold": True,
        }
    operational = _contains(lowered, OPERATIONAL_TERMS)
    if operational:
        return {
            "classification": CLASS_OPERATIONAL,
            "reason": f"operations vocabulary '{operational}'",
            "safety_hold": False,
        }
    social = _contains(lowered, SOCIAL_TERMS)
    if social:
        return {
            "classification": CLASS_NON_OPERATIONAL,
            "reason": f"social vocabulary '{social}' and no operational terms",
            "safety_hold": False,
        }
    if len(lowered.split()) < 4:
        return {
            "classification": CLASS_NON_OPERATIONAL,
            "reason": "too short to carry operational content",
            "safety_hold": False,
        }
    return {
        "classification": CLASS_NON_OPERATIONAL,
        "reason": "no operational vocabulary detected",
        "safety_hold": False,
    }


def split_segments(text: str) -> list[dict[str, Any]]:
    """Break a plain transcript into reviewable lines."""
    lines: list[str] = []
    for raw_line in text.replace("\r", "").split("\n"):
        for sentence in re.split(r"(?<=[.!?])\s+", raw_line.strip()):
            cleaned = sentence.strip()
            if cleaned:
                lines.append(cleaned)
    return [{"text": line} for line in lines]


# --------------------------------------------------------------------------- #
# Transcription adapters
# --------------------------------------------------------------------------- #

class TranscriptionUnavailable(Exception):
    """No engine is configured. Not an error — the default state."""


def _engine_command(audio: Path) -> dict[str, Any]:
    """Run a configured CLI and read its transcript from stdout.

    Engine-agnostic by design: whisper.cpp, faster-whisper, vosk or anything
    else that can print a transcript works without vendor-specific code here.
    `{file}` in NORTHSTAR_VOICE_COMMAND is replaced with the audio path.

    If stdout parses as JSON with a "segments" list, timings are kept; otherwise
    stdout is treated as plain text.
    """
    template = os.environ.get("NORTHSTAR_VOICE_COMMAND", "").strip()
    if not template:
        raise TranscriptionUnavailable("NORTHSTAR_VOICE_COMMAND is not set")
    timeout = max(10, int(os.environ.get("NORTHSTAR_VOICE_TIMEOUT_SECONDS", "600")))
    command = [part.replace("{file}", str(audio)) for part in _split_command(template)]
    completed = subprocess.run(
        command, capture_output=True, text=True, timeout=timeout, check=False
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"transcription command exited {completed.returncode}: "
            f"{(completed.stderr or '').strip()[:400]}"
        )
    stdout = completed.stdout or ""
    try:
        payload = json.loads(stdout)
    except (json.JSONDecodeError, ValueError):
        return {"text": stdout.strip(), "segments": split_segments(stdout), "language": None}
    if isinstance(payload, dict) and isinstance(payload.get("segments"), list):
        segments = []
        for item in payload["segments"]:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text", "")).strip()
            if not text:
                continue
            segments.append({
                "text": text,
                "started_seconds": _as_float(item.get("start")),
                "ended_seconds": _as_float(item.get("end")),
            })
        text = str(payload.get("text") or " ".join(s["text"] for s in segments)).strip()
        return {"text": text, "segments": segments, "language": payload.get("language")}
    text = str(payload.get("text", "")).strip() if isinstance(payload, dict) else stdout.strip()
    return {"text": text, "segments": split_segments(text), "language": None}


def _split_command(template: str) -> list[str]:
    import shlex

    # posix=False keeps Windows paths like C:\tools\whisper.exe intact.
    return [part.strip('"') for part in shlex.split(template, posix=False)]


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


ENGINES = {"command": _engine_command}


def transcribe_audio(audio: Path) -> dict[str, Any]:
    name = engine_name()
    if name == "none":
        raise TranscriptionUnavailable("no transcription engine configured")
    adapter = ENGINES.get(name)
    if adapter is None:
        raise TranscriptionUnavailable(f"unknown transcription engine '{name}'")
    return adapter(audio)


# --------------------------------------------------------------------------- #
# Intake
# --------------------------------------------------------------------------- #

def _log(connection: Any, recording_id: str, event: str, detail: str = "", actor: str = "system") -> None:
    timestamp = now_iso()
    event_id = uuid.uuid4().hex
    connection.execute(
        "INSERT INTO voice_events (event_id, recording_id, at, event, detail, actor)"
        " VALUES (?,?,?,?,?,?)",
        (event_id, recording_id, timestamp, event, detail, actor),
    )
    events.append_event(
        connection,
        event_type=events.event_type("voice", event),
        occurred_at=timestamp,
        actor_id=actor,
        aggregate_type="voice_recording",
        aggregate_id=recording_id,
        source="voice",
        severity="critical" if "safety" in event.lower() else "info",
        summary=event,
        payload={"detail": detail, "legacyEventId": event_id},
    )


def ingest_audio(
    original_name: str,
    content: bytes,
    source: str = "inbox",
    stored_name: str | None = None,
) -> dict[str, Any]:
    """Register an audio file. Idempotent on content hash."""
    if len(content) > MAX_AUDIO_BYTES:
        raise ValueError(f"audio exceeds {MAX_AUDIO_BYTES} bytes")
    digest = hashlib.sha256(content).hexdigest()
    with _db() as connection:
        existing = connection.execute(
            "SELECT * FROM voice_recordings WHERE content_sha256=?", (digest,)
        ).fetchone()
        if existing is not None:
            record = _recording_row(existing)
            record["duplicate"] = True
            return record
        recording_id = f"voice-{uuid.uuid4().hex[:16]}"
        received = datetime.now(TZ)
        expires = (received + timedelta(days=retention_days())).isoformat()
        connection.execute(
            "INSERT INTO voice_recordings (recording_id, original_name, stored_name,"
            " content_sha256, byte_size, source, received_at, status, audio_retained,"
            " retention_expires_at) VALUES (?,?,?,?,?,?,?,?,1,?)",
            (recording_id, original_name, stored_name, digest, len(content), source,
             received.isoformat(), STATUS_AWAITING, expires),
        )
        _log(connection, recording_id, "received",
             f"{original_name} · {len(content)} bytes · sha256 {digest[:12]}")
        row = connection.execute(
            "SELECT * FROM voice_recordings WHERE recording_id=?", (recording_id,)
        ).fetchone()
    record = _recording_row(row)
    record["duplicate"] = False
    return record


def scan_inbox_once() -> list[dict[str, Any]]:
    """Pick up finished audio files from the drop folder."""
    inbox, store_dir = inbox_path(), store_path()
    if not inbox.is_absolute():
        inbox = ROOT / inbox
    if not inbox.exists():
        return []
    store_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    for path in sorted(inbox.iterdir()):
        if not path.is_file() or path.suffix.lower() not in AUDIO_SUFFIXES:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        signature = (int(stat.st_size), int(stat.st_mtime_ns))
        key = str(path)
        seen = _STABILITY.get(key)
        # Require one unchanged observation so a half-copied file is not ingested.
        if seen is None or (seen[0], seen[1]) != signature:
            _STABILITY[key] = (signature[0], signature[1], 1)
            continue
        try:
            content = path.read_bytes()
            record = ingest_audio(path.name, content, source="inbox")
            if not record.get("duplicate"):
                stored = store_dir / f"{record['contentSha256']}{path.suffix.lower()}"
                shutil.copy2(path, stored)
                with _db() as connection:
                    connection.execute(
                        "UPDATE voice_recordings SET stored_name=? WHERE recording_id=?",
                        (stored.name, record["recordingId"]),
                    )
                record["storedName"] = stored.name
            path.unlink()
            _STABILITY.pop(key, None)
            record["action"] = "Duplicate" if record.get("duplicate") else "Ingested"
            results.append(record)
        except Exception as exc:  # one bad file must not stop the sweep
            _STABILITY.pop(key, None)
            results.append({"originalName": path.name, "action": "Failed", "error": str(exc)})
    return results


def transcribe_pending(limit: int = 5) -> list[dict[str, Any]]:
    """Transcribe and triage recordings that are still awaiting an engine."""
    if engine_name() == "none":
        return []
    with _db() as connection:
        rows = connection.execute(
            "SELECT * FROM voice_recordings WHERE status=? AND audio_retained=1"
            " ORDER BY received_at LIMIT ?",
            (STATUS_AWAITING, max(1, int(limit))),
        ).fetchall()
    results = []
    for row in rows:
        results.append(transcribe_recording(row["recording_id"]))
    return results


def transcribe_recording(recording_id: str) -> dict[str, Any]:
    with _db() as connection:
        row = connection.execute(
            "SELECT * FROM voice_recordings WHERE recording_id=?", (recording_id,)
        ).fetchone()
    if row is None:
        raise ValueError("recording not found")
    if not row["stored_name"]:
        raise ValueError("recording has no stored audio")
    audio = store_path() / row["stored_name"]
    if not audio.exists():
        raise ValueError("stored audio is missing")
    try:
        result = transcribe_audio(audio)
    except TranscriptionUnavailable as exc:
        return {"recordingId": recording_id, "status": STATUS_AWAITING, "detail": str(exc)}
    except Exception as exc:
        with _db() as connection:
            connection.execute(
                "UPDATE voice_recordings SET status=?, error=?, engine=? WHERE recording_id=?",
                (STATUS_FAILED, str(exc)[:500], engine_name(), recording_id),
            )
            _log(connection, recording_id, "transcription failed", str(exc)[:300])
        return {"recordingId": recording_id, "status": STATUS_FAILED, "error": str(exc)}
    return store_transcript(recording_id, result)


def store_transcript(recording_id: str, result: dict[str, Any]) -> dict[str, Any]:
    """Persist a transcript and classify every segment."""
    segments = result.get("segments") or split_segments(result.get("text", ""))
    timestamp = now_iso()
    operational = filtered = safety = 0
    with _db() as connection:
        connection.execute("DELETE FROM voice_segments WHERE recording_id=?", (recording_id,))
        for ordinal, segment in enumerate(segments):
            text = str(segment.get("text", "")).strip()
            if not text:
                continue
            verdict = classify_segment(text)
            if verdict["classification"] == CLASS_OPERATIONAL:
                operational += 1
            else:
                filtered += 1
            if verdict["safety_hold"]:
                safety += 1
            connection.execute(
                "INSERT INTO voice_segments (segment_id, recording_id, ordinal,"
                " started_seconds, ended_seconds, text, classification, reason, safety_hold)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (uuid.uuid4().hex, recording_id, ordinal,
                 segment.get("started_seconds"), segment.get("ended_seconds"), text,
                 verdict["classification"], verdict["reason"], 1 if verdict["safety_hold"] else 0),
            )
        connection.execute(
            "UPDATE voice_recordings SET status=?, engine=?, transcribed_at=?, language=?,"
            " duration_seconds=?, error=NULL WHERE recording_id=?",
            (STATUS_TRANSCRIBED, engine_name(), timestamp, result.get("language"),
             _as_float(result.get("duration_seconds")), recording_id),
        )
        _log(connection, recording_id, "transcribed",
             f"{operational} operational · {filtered} filtered · {safety} safety-held")
        if safety:
            _log(connection, recording_id, "safety content detected",
                 f"{safety} segment(s) pinned operational by safety vocabulary")
    return {
        "recordingId": recording_id,
        "status": STATUS_TRANSCRIBED,
        "operational": operational,
        "filtered": filtered,
        "safetyHeld": safety,
    }


def review_segment(segment_id: str, classification: str, actor: str, note: str = "") -> dict[str, Any]:
    """Operator override of a triage verdict. Append-only; nothing is rewritten."""
    if classification not in (CLASS_OPERATIONAL, CLASS_NON_OPERATIONAL):
        raise ValueError("classification must be operational or non-operational")
    with _db() as connection:
        row = connection.execute(
            "SELECT * FROM voice_segments WHERE segment_id=?", (segment_id,)
        ).fetchone()
        if row is None:
            raise ValueError("segment not found")
        if row["safety_hold"] and classification == CLASS_NON_OPERATIONAL:
            raise ValueError(
                "segment is held by safety vocabulary and cannot be filtered out"
            )
        connection.execute(
            "UPDATE voice_segments SET classification=?, reason=?, reviewed_by=?,"
            " reviewed_at=?, review_note=? WHERE segment_id=?",
            (classification, f"operator review by {actor}", actor, now_iso(), note, segment_id),
        )
        _log(connection, row["recording_id"], "segment reviewed",
             f"{row['classification']} -> {classification}: {note[:160]}", actor)
        updated = connection.execute(
            "SELECT * FROM voice_segments WHERE segment_id=?", (segment_id,)
        ).fetchone()
    return _segment_row(updated)


def purge_expired_audio(reference: datetime | None = None) -> int:
    """Drop audio bytes past retention. Transcript and audit trail are kept."""
    reference = reference or datetime.now(TZ)
    cutoff = reference.isoformat()
    purged = 0
    with _db() as connection:
        rows = connection.execute(
            "SELECT * FROM voice_recordings WHERE audio_retained=1"
            " AND retention_expires_at IS NOT NULL AND retention_expires_at<?",
            (cutoff,),
        ).fetchall()
        for row in rows:
            if row["stored_name"]:
                target = store_path() / row["stored_name"]
                try:
                    target.unlink(missing_ok=True)
                except OSError:
                    pass
            connection.execute(
                "UPDATE voice_recordings SET audio_retained=0, stored_name=NULL,"
                " status=CASE WHEN status=? THEN ? ELSE status END WHERE recording_id=?",
                (STATUS_AWAITING, STATUS_PURGED, row["recording_id"]),
            )
            _log(connection, row["recording_id"], "audio purged",
                 f"retention {retention_days()} days elapsed")
            purged += 1
    return purged


# --------------------------------------------------------------------------- #
# Read models
# --------------------------------------------------------------------------- #

def _recording_row(row: Any) -> dict[str, Any]:
    return {
        "recordingId": row["recording_id"],
        "originalName": row["original_name"],
        "storedName": row["stored_name"],
        "contentSha256": row["content_sha256"],
        "byteSize": row["byte_size"],
        "source": row["source"],
        "receivedAt": row["received_at"],
        "status": row["status"],
        "engine": row["engine"],
        "transcribedAt": row["transcribed_at"],
        "language": row["language"],
        "durationSeconds": row["duration_seconds"],
        "error": row["error"],
        "audioRetained": bool(row["audio_retained"]),
        "retentionExpiresAt": row["retention_expires_at"],
    }


def _segment_row(row: Any) -> dict[str, Any]:
    return {
        "segmentId": row["segment_id"],
        "recordingId": row["recording_id"],
        "ordinal": row["ordinal"],
        "startedSeconds": row["started_seconds"],
        "endedSeconds": row["ended_seconds"],
        "text": row["text"],
        "classification": row["classification"],
        "reason": row["reason"],
        "safetyHold": bool(row["safety_hold"]),
        "reviewedBy": row["reviewed_by"],
        "reviewedAt": row["reviewed_at"],
        "reviewNote": row["review_note"],
    }


def list_recordings(limit: int = 100) -> list[dict[str, Any]]:
    with _db() as connection:
        rows = connection.execute(
            "SELECT * FROM voice_recordings ORDER BY received_at DESC LIMIT ?",
            (max(1, int(limit)),),
        ).fetchall()
        counts = {
            row["recording_id"]: row
            for row in connection.execute(
                "SELECT recording_id,"
                " SUM(CASE WHEN classification='operational' THEN 1 ELSE 0 END) AS operational,"
                " SUM(CASE WHEN classification='non-operational' THEN 1 ELSE 0 END) AS filtered,"
                " SUM(safety_hold) AS safety"
                " FROM voice_segments GROUP BY recording_id"
            ).fetchall()
        }
    result = []
    for row in rows:
        record = _recording_row(row)
        tally = counts.get(row["recording_id"])
        record["operationalSegments"] = int(tally["operational"] or 0) if tally else 0
        record["filteredSegments"] = int(tally["filtered"] or 0) if tally else 0
        record["safetySegments"] = int(tally["safety"] or 0) if tally else 0
        result.append(record)
    return result


def get_recording(recording_id: str, include_filtered: bool = True) -> dict[str, Any] | None:
    with _db() as connection:
        row = connection.execute(
            "SELECT * FROM voice_recordings WHERE recording_id=?", (recording_id,)
        ).fetchone()
        if row is None:
            return None
        if include_filtered:
            segments = connection.execute(
                "SELECT * FROM voice_segments WHERE recording_id=? ORDER BY ordinal",
                (recording_id,),
            ).fetchall()
        else:
            segments = connection.execute(
                "SELECT * FROM voice_segments WHERE recording_id=? AND classification=?"
                " ORDER BY ordinal",
                (recording_id, CLASS_OPERATIONAL),
            ).fetchall()
        events = connection.execute(
            "SELECT * FROM voice_events WHERE recording_id=? ORDER BY at DESC, rowid DESC",
            (recording_id,),
        ).fetchall()
    record = _recording_row(row)
    record["segments"] = [_segment_row(segment) for segment in segments]
    record["events"] = [
        {"at": event["at"], "event": event["event"], "detail": event["detail"], "actor": event["actor"]}
        for event in events
    ]
    return record


def voice_snapshot() -> dict[str, Any]:
    """Header state for the Voice workspace."""
    with _db() as connection:
        totals = connection.execute(
            "SELECT COUNT(*) AS recordings,"
            " SUM(CASE WHEN status=? THEN 1 ELSE 0 END) AS awaiting,"
            " SUM(CASE WHEN status=? THEN 1 ELSE 0 END) AS transcribed,"
            " SUM(CASE WHEN status=? THEN 1 ELSE 0 END) AS failed,"
            " SUM(CASE WHEN audio_retained=0 THEN 1 ELSE 0 END) AS purged"
            " FROM voice_recordings",
            (STATUS_AWAITING, STATUS_TRANSCRIBED, STATUS_FAILED),
        ).fetchone()
        segments = connection.execute(
            "SELECT"
            " SUM(CASE WHEN classification='operational' THEN 1 ELSE 0 END) AS operational,"
            " SUM(CASE WHEN classification='non-operational' THEN 1 ELSE 0 END) AS filtered,"
            " SUM(safety_hold) AS safety FROM voice_segments"
        ).fetchone()
    inbox = inbox_path()
    if not inbox.is_absolute():
        inbox = ROOT / inbox
    engine = engine_name()
    return {
        "engine": engine,
        "engineConfigured": engine != "none",
        # Named so the UI cannot accidentally present "no engine" as "all clear".
        "engineNote": (
            "No transcription engine configured — audio is received, hashed and "
            "logged, but nothing is transcribed and no transcript is invented."
            if engine == "none" else f"Transcribing with '{engine}'."
        ),
        "inbox": str(inbox),
        "inboxExists": inbox.exists(),
        "inboxWaiting": len([
            p for p in inbox.iterdir()
            if p.is_file() and p.suffix.lower() in AUDIO_SUFFIXES
        ]) if inbox.exists() else 0,
        "retentionDays": retention_days(),
        "recordings": int(totals["recordings"] or 0),
        "awaiting": int(totals["awaiting"] or 0),
        "transcribed": int(totals["transcribed"] or 0),
        "failed": int(totals["failed"] or 0),
        "audioPurged": int(totals["purged"] or 0),
        "operationalSegments": int(segments["operational"] or 0),
        "filteredSegments": int(segments["filtered"] or 0),
        "safetySegments": int(segments["safety"] or 0),
    }
