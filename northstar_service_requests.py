"""Read-only, locally imported service-request snapshot for the control room."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent
TZ = ZoneInfo("America/Toronto")
SNAPSHOT_NAME = "service-requests.json"
PAGE_SIZE = 75
MAX_PAGE_SIZE = 150
MAX_QUERY_LENGTH = 200
TERMINAL_STATUSES = {"CLOSED", "CANCELLED", "CANCELED", "COMPLETE", "COMPLETED", "RESOLVED"}

_CACHE: tuple[tuple[str, int, int] | None, dict[str, Any] | None] | None = None


def snapshot_path() -> Path:
    override = os.environ.get("NORTHSTAR_SERVICE_REQUESTS_SNAPSHOT", "").strip()
    if override:
        return Path(override).expanduser()
    return ROOT / "data" / "service-requests" / SNAPSHOT_NAME


def _fingerprint(path: Path) -> tuple[str, int, int] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return str(path), stat.st_mtime_ns, stat.st_size


def _text(value: Any, limit: int = 2_000) -> str:
    return str(value or "").strip()[:limit]


def _timestamp(value: Any) -> str:
    candidate = _text(value, 80)
    if not candidate:
        return ""
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError:
        return ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TZ)
    return parsed.astimezone(TZ).isoformat()


def _status(value: Any) -> str:
    return _text(value, 120).upper() or "UNSPECIFIED"


def _record(candidate: Any) -> dict[str, str] | None:
    if not isinstance(candidate, dict):
        return None
    service_request = _text(candidate.get("serviceRequest"), 120)
    if not service_request:
        return None
    return {
        "serviceRequest": service_request,
        "summary": _text(candidate.get("summary")),
        "location": _text(candidate.get("location"), 320),
        "reportedBy": _text(candidate.get("reportedBy"), 160),
        "reportedAt": _timestamp(candidate.get("reportedAt")),
        "targetFinish": _timestamp(candidate.get("targetFinish")),
        "priority": _text(candidate.get("priority"), 120),
        "classification": _text(candidate.get("classification"), 320),
        "status": _status(candidate.get("status")),
        "owner": _text(candidate.get("owner"), 160),
        "ownerGroup": _text(candidate.get("ownerGroup"), 160),
    }


def _load_snapshot() -> dict[str, Any] | None:
    global _CACHE
    path = snapshot_path()
    fingerprint = _fingerprint(path)
    if _CACHE and _CACHE[0] == fingerprint:
        return _CACHE[1]
    snapshot: dict[str, Any] | None = None
    if fingerprint:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            raw = {}
        if isinstance(raw, dict) and isinstance(raw.get("requests"), list):
            records = [record for item in raw["requests"] if (record := _record(item)) is not None]
            source = raw.get("source") if isinstance(raw.get("source"), dict) else {}
            snapshot = {
                "records": records,
                "source": {
                    "filename": Path(_text(source.get("filename"), 255)).name,
                    "sha256": _text(source.get("sha256"), 128),
                    "sheetName": _text(source.get("sheetName"), 255),
                    "importedAt": _timestamp(source.get("importedAt")),
                    "recordCount": len(records),
                },
            }
    _CACHE = fingerprint, snapshot
    return snapshot


def _status_counts(records: list[dict[str, str]]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for record in records:
        counts[record["status"]] = counts.get(record["status"], 0) + 1
    return [{"status": status, "count": count} for status, count in sorted(counts.items())]


def _due_state(record: dict[str, str], reference: datetime) -> str:
    if record["status"] in TERMINAL_STATUSES:
        return "CLOSED"
    target = _timestamp(record["targetFinish"])
    if not target:
        return "NO TARGET"
    target_time = datetime.fromisoformat(target)
    if target_time < reference:
        return "OVERDUE"
    if target_time <= reference + timedelta(days=7):
        return "DUE NEXT 7 DAYS"
    return "OPEN"


def catalog() -> dict[str, Any]:
    snapshot = _load_snapshot()
    if not snapshot:
        return {
            "available": False,
            "readOnly": True,
            "state": "No imported service request snapshot",
            "source": {},
            "statuses": [],
            "recordCount": 0,
            "openCount": 0,
        }
    records = snapshot["records"]
    return {
        "available": True,
        "readOnly": True,
        "state": "Loaded local service request snapshot",
        "source": snapshot["source"],
        "statuses": _status_counts(records),
        "recordCount": len(records),
        "openCount": sum(record["status"] not in TERMINAL_STATUSES for record in records),
    }


def _bounded_int(value: Any, *, name: str, default: int, maximum: int) -> int:
    if value in (None, ""):
        return default
    try:
        parsed = int(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a whole number") from exc
    if parsed < 1 or parsed > maximum:
        raise ValueError(f"{name} must be between 1 and {maximum}")
    return parsed


def list_requests(query: str = "", status: str = "", due: str = "", page: Any = 1,
                  limit: Any = PAGE_SIZE) -> dict[str, Any]:
    requested_query = _text(query, MAX_QUERY_LENGTH).casefold()
    requested_status = _status(status) if _text(status) else ""
    requested_due = _text(due, 32).lower()
    if requested_due not in {"", "open", "overdue", "next_7"}:
        raise ValueError("due filter is not supported")
    page_number = _bounded_int(page, name="page", default=1, maximum=1_000_000)
    page_limit = _bounded_int(limit, name="limit", default=PAGE_SIZE, maximum=MAX_PAGE_SIZE)
    snapshot = _load_snapshot()
    base = {
        "available": False,
        "readOnly": True,
        "query": requested_query,
        "status": requested_status,
        "due": requested_due,
        "page": page_number,
        "limit": page_limit,
        "total": 0,
        "pages": 0,
        "records": [],
        "source": {},
    }
    if not snapshot:
        return base
    reference = datetime.now(TZ)
    filtered: list[dict[str, str]] = []
    for record in snapshot["records"]:
        due_state = _due_state(record, reference)
        if requested_status and record["status"] != requested_status:
            continue
        if requested_due == "open" and record["status"] in TERMINAL_STATUSES:
            continue
        if requested_due == "overdue" and due_state != "OVERDUE":
            continue
        if requested_due == "next_7" and due_state != "DUE NEXT 7 DAYS":
            continue
        if requested_query:
            haystack = " ".join(record[key] for key in (
                "serviceRequest", "summary", "location", "status", "priority", "classification", "owner", "ownerGroup"
            )).casefold()
            if requested_query not in haystack:
                continue
        filtered.append({**record, "dueState": due_state})
    filtered.sort(key=lambda record: (
        {"OVERDUE": 0, "DUE NEXT 7 DAYS": 1, "OPEN": 2, "NO TARGET": 3, "CLOSED": 4}.get(record["dueState"], 5),
        record["targetFinish"] or "9999-12-31T23:59:59",
        record["serviceRequest"],
    ))
    total = len(filtered)
    pages = (total + page_limit - 1) // page_limit if total else 0
    if pages and page_number > pages:
        page_number = pages
    first = (page_number - 1) * page_limit if total else 0
    return {
        **base,
        "available": True,
        "page": page_number,
        "total": total,
        "pages": pages,
        "records": filtered[first:first + page_limit],
        "source": snapshot["source"],
    }
