"""Read-only, cited retrieval over dashboard records and approved references."""
from __future__ import annotations

import csv
import hashlib
import html
import json
import re
import sqlite3
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DB = DATA / "northstar.db"
INDEX_FILE = DATA / "knowledge-index.json"
INDEX_VERSION = 2
TEXT_SUFFIXES = {".csv", ".tsv", ".txt", ".md", ".json", ".log", ".xml"}
REFERENCE_SUFFIXES = TEXT_SUFFIXES | {".pdf", ".docx", ".xlsx", ".xls"}
SECRET_NAMES = {".env", ".env.local", ".northstar-demo-auth.json"}
SYSTEM_FILES = {"northstar-backend.out.log", "northstar-backend.err.log", "knowledge-index.tmp"}
SECRET_KEY = re.compile(r"(api[_-]?key|token|secret|password|credential|authorization)", re.I)
KEY_VALUE = re.compile(
    r"(?im)([\"']?(?:[a-z0-9_-]*?(?:api[_-]?key|token|secret|password|credential|authorization))[\"']?\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,}\]]+)",
)
_LOCK = RLock()
_FILE_CACHE: tuple[str, list[dict[str, str]], str] | None = None
_PUBLIC_CACHE: tuple[float, list[dict[str, str]]] | None = None

# A compact vocabulary bridge makes common operator wording find the terminology
# used in procedures and reliability documents without calling an external service.
SYNONYMS = {
    "alarm": {"event", "incident", "alert"},
    "incident": {"event", "alarm", "alert", "logbook"},
    "outage": {"derating", "curtailment", "availability", "forced"},
    "procedure": {"manual", "sop", "instruction", "process"},
    "protection": {"relay", "prc", "reliability"},
    "relay": {"protection", "prc", "reliability"},
    "reliability": {"nerc", "standard", "protection", "grid"},
    "shift": {"handoff", "logbook", "operator"},
    "standard": {"standards", "nerc", "ieee", "ieso", "requirement"},
    "standards": {"standard", "nerc", "ieee", "ieso", "requirement"},
}
STOP_WORDS = {
    "about", "after", "again", "also", "been", "could", "does", "find", "from", "have",
    "into", "need", "should", "that", "their", "there", "these", "they", "this", "what",
    "when", "which", "with", "would", "your",
}


def _tokens(value: str) -> set[str]:
    return {item.lower() for item in re.findall(r"[A-Za-z0-9]{3,}", value) if item.lower() not in STOP_WORDS}


def _redact(value: str) -> str:
    value = KEY_VALUE.sub(r"\1[REDACTED]", value)
    return re.sub(r"\b(?:sk|rk|sess)_[A-Za-z0-9_-]+\b", "[REDACTED]", value)


def _xml_text(raw: bytes) -> str:
    try:
        return " ".join(html.unescape("".join(node.itertext())) for node in ElementTree.fromstring(raw).iter() if node.tag.endswith("}t"))
    except ElementTree.ParseError:
        return ""


def _zip_text(path: Path, suffix: str) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if suffix == ".xlsx":
                names = [name for name in names if name == "xl/sharedStrings.xml" or name.startswith("xl/worksheets/")]
            else:
                names = [name for name in names if name == "word/document.xml" or name.startswith("word/header")]
            return " ".join(_xml_text(archive.read(name)) for name in names)[:60000]
    except (OSError, zipfile.BadZipFile):
        return ""


def _file_text(path: Path) -> str:
    suffix = path.suffix.lower()
    try:
        if suffix in {".csv", ".tsv"}:
            delimiter = "\t" if suffix == ".tsv" else ","
            with path.open("r", encoding="utf-8", errors="replace", newline="") as stream:
                return "\n".join(" | ".join(row) for _, row in zip(range(500), csv.reader(stream, delimiter=delimiter)))
        if suffix in TEXT_SUFFIXES:
            return path.read_text(encoding="utf-8", errors="replace")[:60000]
        if suffix in {".xlsx", ".docx"}:
            return _zip_text(path, suffix)
        if suffix == ".pdf":
            try:
                from pypdf import PdfReader  # optional runtime dependency
                return "\n".join((page.extract_text() or "") for page in PdfReader(str(path)).pages[:40])[:60000]
            except Exception:
                return path.stem
    except OSError:
        return ""
    return path.stem


def _reference_files() -> list[Path]:
    return sorted(
        (
            path for path in DATA.rglob("*")
            if path.is_file()
            and path != INDEX_FILE
            and path.name not in SECRET_NAMES
            and path.name not in SYSTEM_FILES
            and path.suffix.lower() in REFERENCE_SUFFIXES
        ),
        key=lambda path: path.as_posix().lower(),
    )


def _file_signature(files: list[Path] | None = None) -> str:
    digest = hashlib.sha256()
    for path in files if files is not None else _reference_files():
        stat = path.stat()
        digest.update(f"{path.relative_to(DATA).as_posix()}\0{stat.st_size}\0{stat.st_mtime_ns}\n".encode("utf-8"))
    return digest.hexdigest()


def _file_records(files: list[Path] | None = None) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for path in files if files is not None else _reference_files():
        relative = f"data/{path.relative_to(DATA).as_posix()}"
        text = _file_text(path).strip()
        records.append({"source": f"file:{relative}", "path": relative, "text": _redact((path.name + "\n" + text)[:60000])})
    return records


def _database_records() -> list[dict[str, str]]:
    """Read the live dashboard database on every query; it is inexpensive and fresh."""
    if not DB.exists():
        return []
    records: list[dict[str, str]] = []
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        tables = [row[0] for row in connection.execute("select name from sqlite_master where type='table'") if row[0] not in {"schema_migrations"}]
        for table in tables:
            for index, row in enumerate(connection.execute(f'SELECT * FROM "{table}"')):
                safe = {key: value for key, value in dict(row).items() if not SECRET_KEY.search(key)}
                payload = _redact(json.dumps(safe, ensure_ascii=False, default=str))
                records.append({"source": f"database:{table}:{index + 1}", "path": f"database/{table}/{index + 1}", "text": payload[:60000]})
    except sqlite3.Error:
        return records
    finally:
        if connection is not None:
            connection.close()
    return records


def _public_engineering_records() -> list[dict[str, str]]:
    """Expose approved public catalog pages without blocking an operator query."""
    global _PUBLIC_CACHE
    with _LOCK:
        if _PUBLIC_CACHE and time.time() - _PUBLIC_CACHE[0] < 86400:
            return _PUBLIC_CACHE[1]
        source_file = DATA / "engineering-reference-sources.json"
        try:
            sources = json.loads(source_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        records: list[dict[str, str]] = []
        for source in sources:
            title, url = str(source.get("title", "")), str(source.get("url", ""))
            access = str(source.get("access", "public"))
            text = f"{source.get('organization', '')} {title} {url} access {access}"
            records.append({"source": f"public:{source.get('id', title)}", "path": url, "text": _redact(text)})
        _PUBLIC_CACHE = (time.time(), records)
        return records


def _load_file_records() -> tuple[list[dict[str, str]], str]:
    """Load or rebuild the costly document index, isolated from live DB writes."""
    global _FILE_CACHE
    files = _reference_files()
    signature = _file_signature(files)
    with _LOCK:
        if _FILE_CACHE and _FILE_CACHE[0] == signature:
            return _FILE_CACHE[1], _FILE_CACHE[2]
        try:
            saved = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
            if (
                saved.get("version") == INDEX_VERSION
                and saved.get("fileSignature") == signature
                and isinstance(saved.get("records"), list)
            ):
                built_at = str(saved.get("builtAt") or "unknown")
                _FILE_CACHE = (signature, saved["records"], built_at)
                return _FILE_CACHE[1], built_at
        except (OSError, ValueError, TypeError):
            pass
        records = _file_records(files)
        built_at = datetime.now(timezone.utc).isoformat()
        payload = {"version": INDEX_VERSION, "fileSignature": signature, "builtAt": built_at, "records": records}
        temporary = INDEX_FILE.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        temporary.replace(INDEX_FILE)
        _FILE_CACHE = (signature, records, built_at)
        return records, built_at


def _records() -> list[dict[str, str]]:
    file_records, _ = _load_file_records()
    return file_records + _database_records() + _public_engineering_records()


def rebuild() -> int:
    """Rebuild the persisted reference-file index after an approved source import."""
    global _FILE_CACHE
    with _LOCK:
        _FILE_CACHE = None
    return len(_records())


def _expanded_terms(question: str) -> tuple[set[str], set[str]]:
    original = _tokens(question)
    expanded = set(original)
    for token in original:
        expanded.update(SYNONYMS.get(token, set()))
    return original, expanded


def _excerpt(text: str, terms: set[str], size: int = 1600) -> str:
    """Return the relevant portion, rather than always the beginning of a document."""
    lowered = text.lower()
    locations = [lowered.find(term) for term in terms if lowered.find(term) >= 0]
    if not locations:
        return text[:size]
    start = max(0, min(locations) - size // 3)
    end = min(len(text), start + size)
    return ("…" if start else "") + text[start:end] + ("…" if end < len(text) else "")


def search(question: str, limit: int = 30) -> list[dict[str, Any]]:
    original, wanted = _expanded_terms(question)
    if not original:
        return []
    phrase = " ".join(re.findall(r"[a-z0-9]+", question.lower())).strip()
    scored: list[tuple[int, dict[str, str]]] = []
    for record in _records():
        text = record["text"]
        lowered = text.lower()
        source = record["source"].lower()
        words = _tokens(text)
        direct = original & words
        related = (wanted - original) & words
        source_matches = wanted & _tokens(source)
        score = len(direct) * 6 + len(related) * 2 + len(source_matches) * 8
        if phrase and phrase in lowered:
            score += 12
        if score:
            scored.append((score, record))
    return [
        {"source": record["source"], "path": record["path"], "excerpt": _excerpt(record["text"], wanted)}
        for _, record in sorted(scored, key=lambda item: (-item[0], item[1]["path"]))[:max(1, min(limit, 50))]
    ]


def status() -> dict[str, Any]:
    """Safe operational visibility into search coverage; no document contents are returned."""
    file_records, built_at = _load_file_records()
    database_records = _database_records()
    public_records = _public_engineering_records()
    return {
        "fileRecords": len(file_records),
        "databaseRecords": len(database_records),
        "publicSources": len(public_records),
        "totalRecords": len(file_records) + len(database_records) + len(public_records),
        "indexBuiltAt": built_at,
        "indexVersion": INDEX_VERSION,
        "coverage": ["current-dashboard-database", "approved-reference-files", "engineering-catalogs"],
    }
