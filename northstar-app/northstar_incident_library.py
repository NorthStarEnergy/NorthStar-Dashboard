"""Read-only index of the legacy incident-report archive."""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any


from northstar_paths import app_root

ROOT = app_root(__file__)
SNAPSHOT_NAME = "incident-index.json"
PAGE_SIZE = 60
MAX_PAGE_SIZE = 150
MAX_QUERY_LENGTH = 200
YEAR_RE = re.compile(r"^\d{4}$")
_CACHE: tuple[tuple[str, int, int] | None, dict[str, Any] | None] | None = None


def snapshot_path() -> Path:
    override = os.environ.get("NORTHSTAR_INCIDENT_LIBRARY_SNAPSHOT", "").strip()
    if override:
        return Path(override).expanduser()
    return ROOT / "data" / "incident-library" / SNAPSHOT_NAME


def _fingerprint(path: Path) -> tuple[str, int, int] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return str(path), stat.st_mtime_ns, stat.st_size


def _text(value: Any, limit: int = 1_000) -> str:
    return str(value or "").strip()[:limit]


def _nonnegative_int(value: Any, maximum: int = 1_000_000) -> int:
    try:
        return max(0, min(int(value), maximum))
    except (TypeError, ValueError):
        return 0


def _record(candidate: Any) -> dict[str, Any] | None:
    if not isinstance(candidate, dict):
        return None
    record_id = _text(candidate.get("recordId"), 80)
    incident_id = _text(candidate.get("incidentId"), 120)
    occurred_on = _text(candidate.get("occurredOn"), 10)
    if not record_id or not incident_id:
        return None
    try:
        date.fromisoformat(occurred_on)
    except ValueError:
        return None
    formats = sorted({
        _text(item, 16).lower() for item in (candidate.get("formats") or [])
        if _text(item, 16).startswith(".")
    })[:12]
    return {
        "recordId": record_id,
        "incidentId": incident_id,
        "occurredOn": occurred_on,
        "title": _text(candidate.get("title"), 500) or "Untitled incident report",
        "category": _text(candidate.get("category"), 120) or "Other or Unknown",
        "reportCount": _nonnegative_int(candidate.get("reportCount"), 10_000),
        "evidenceFileCount": _nonnegative_int(candidate.get("evidenceFileCount"), 100_000),
        "formats": formats,
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
        if isinstance(raw, dict) and isinstance(raw.get("incidents"), list):
            records = [record for item in raw["incidents"] if (record := _record(item)) is not None]
            source = raw.get("source") if isinstance(raw.get("source"), dict) else {}
            snapshot = {
                "records": records,
                "source": {
                    "filename": Path(_text(source.get("filename"), 255)).name,
                    "sha256": _text(source.get("sha256"), 128),
                    "indexedAt": _text(source.get("indexedAt"), 80),
                    "fileCount": _nonnegative_int(source.get("fileCount"), 1_000_000),
                    "caseCount": len(records),
                },
            }
    _CACHE = fingerprint, snapshot
    return snapshot


def _catalog_items(records: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for record in records:
        value = str(record[field])
        counts[value] = counts.get(value, 0) + 1
    return [{field: value, "count": count} for value, count in sorted(counts.items())]


def _year_counts(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for record in records:
        year = record["occurredOn"][:4]
        counts[year] = counts.get(year, 0) + 1
    return [{"year": year, "count": count} for year, count in sorted(counts.items(), reverse=True)]


def catalog() -> dict[str, Any]:
    snapshot = _load_snapshot()
    if not snapshot:
        return {
            "available": False,
            "readOnly": True,
            "state": "No indexed incident archive",
            "source": {},
            "caseCount": 0,
            "categories": [],
            "years": [],
        }
    records = snapshot["records"]
    return {
        "available": True,
        "readOnly": True,
        "state": "Loaded local incident archive index",
        "source": snapshot["source"],
        "caseCount": len(records),
        "categories": _catalog_items(records, "category"),
        "years": _year_counts(records),
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


def list_incidents(query: str = "", category: str = "", year: str = "", page: Any = 1,
                   limit: Any = PAGE_SIZE) -> dict[str, Any]:
    requested_query = _text(query, MAX_QUERY_LENGTH).casefold()
    requested_category = _text(category, 120)
    requested_year = _text(year, 4)
    if requested_year and not YEAR_RE.fullmatch(requested_year):
        raise ValueError("year must be a four-digit value")
    page_number = _bounded_int(page, name="page", default=1, maximum=1_000_000)
    page_limit = _bounded_int(limit, name="limit", default=PAGE_SIZE, maximum=MAX_PAGE_SIZE)
    snapshot = _load_snapshot()
    base = {
        "available": False,
        "readOnly": True,
        "query": requested_query,
        "category": requested_category,
        "year": requested_year,
        "page": page_number,
        "limit": page_limit,
        "total": 0,
        "pages": 0,
        "records": [],
        "source": {},
    }
    if not snapshot:
        return base
    filtered: list[dict[str, Any]] = []
    for record in snapshot["records"]:
        if requested_category and record["category"] != requested_category:
            continue
        if requested_year and not record["occurredOn"].startswith(requested_year + "-"):
            continue
        if requested_query:
            haystack = " ".join((
                record["incidentId"], record["title"], record["category"], " ".join(record["formats"]),
            )).casefold()
            if requested_query not in haystack:
                continue
        filtered.append(record)
    filtered.sort(key=lambda record: (record["occurredOn"], record["incidentId"], record["recordId"]), reverse=True)
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
